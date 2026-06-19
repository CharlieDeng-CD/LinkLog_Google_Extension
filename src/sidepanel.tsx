import React, { useEffect, useRef, useState } from "react"
import GraphView from "~components/GraphView"
import Settings from "~components/Settings"
import type { GraphNode, GraphEdge, GraphData, LearningSummary, UiLanguage } from "~types"
import { getDefaultUiLanguage, normalizeUiLanguage } from "~utils/language"

const DEFAULT_API_BASE_URL =
  process.env.PLASMO_PUBLIC_LINKLOG_API_BASE_URL ||
  "https://api.deepseek.com"
const HAS_HOSTED_TRIAL = Boolean(process.env.PLASMO_PUBLIC_LINKLOG_API_BASE_URL)

function requiresApiKey(baseUrl: string) {
  return /api\.(deepseek|openai)\.com/.test(baseUrl)
}

function SidePanel() {
  const [apiKey, setApiKey] = useState<string>("")
  const [apiBaseUrl, setApiBaseUrl] = useState<string>("")
  const [showSettings, setShowSettings] = useState(false)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState("Mapping hidden assumptions")
  const [error, setError] = useState<string | null>(null)
  const [concept, setConcept] = useState<string>("")
  const [pageContent, setPageContent] = useState<string>("")
  const [summary, setSummary] = useState<LearningSummary | null>(null)
  const [language, setLanguage] = useState<UiLanguage>(getDefaultUiLanguage)
  const [activeTab, setActiveTab] = useState<"map" | "history">("map")
  const [toast, setToast] = useState<string | null>(null)
  const generationIdRef = useRef(0)

  useEffect(() => {
    chrome.storage.local.get(["apiKey", "apiBaseUrl", "uiLanguage", "_pendingGeneration", "streamBuffer"], (result) => {
      const key = result.apiKey || ""
      const baseUrl = result.apiBaseUrl || DEFAULT_API_BASE_URL
      setApiKey(key)
      setApiBaseUrl(baseUrl)
      setLanguage(normalizeUiLanguage(result.uiLanguage) || getDefaultUiLanguage())
      refreshLearningSummary()
      if (!key && requiresApiKey(baseUrl)) {
        setShowSettings(true)
        return
      }
      if (result._pendingGeneration) {
        consumePendingGeneration(result._pendingGeneration)
        applyStreamBuffer(result.streamBuffer, result._pendingGeneration.generationId)
        chrome.storage.local.remove("_pendingGeneration")
      } else if (result.streamBuffer) {
        applyStreamBuffer(result.streamBuffer)
      }
    })
  }, [])

  async function refreshLearningSummary() {
    try {
      const result = await chrome.runtime.sendMessage({
        action: "get-learning-summary"
      })
      if (result?.success) setSummary(result.summary)
    } catch {
      // Summary is non-critical; graph generation should still work.
    }
  }

  function toggleLanguage() {
    const next = language === "en" ? "zh" : "en"
    setLanguage(next)
    chrome.storage.local.set({ uiLanguage: next })
  }

  function getLoadingText(text: string) {
    if (language === "en") return text
    if (text === "Mapping hidden assumptions") return "正在生成知识地图"
    if (text.startsWith("Finding prerequisites for ")) {
      return `正在寻找 ${text.replace("Finding prerequisites for ", "")} 的前置知识`
    }
    if (text.startsWith("Replacing ")) {
      return `正在替换 ${text.replace("Replacing ", "")}`
    }
    return text
  }

  function getErrorText(text: string) {
    if (language === "en") return text
    if (text === "Failed to generate graph") return "知识地图生成失败"
    if (text === "Failed to expand node") return "前置知识展开失败"
    if (text.includes("API Key not configured")) {
      return "尚未配置 API Key。请在设置中填写，或使用 Hosted Trial。"
    }
    if (text.includes("LLM request failed")) {
      return "模型请求失败。请检查 API 设置或稍后重试。"
    }
    if (text.includes("stream")) {
      return "模型返回异常。请稍后重试。"
    }
    return text
  }

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 1800)
  }

  function getCopy(
    key: "map" | "history" | "emptyHistory" | "copied" | "copyFailed" | "mermaid"
  ) {
    const dictionary = {
      en: {
        map: "Map",
        history: "History",
        emptyHistory: "No history yet. Generate your first map from any article.",
        copied: "Mermaid copied",
        copyFailed: "Could not copy Mermaid",
        mermaid: "Mermaid"
      },
      zh: {
        map: "地图",
        history: "历史",
        emptyHistory: "暂无历史记录。先从任意文章生成一张知识图谱。",
        copied: "Mermaid 已复制",
        copyFailed: "未能复制 Mermaid",
        mermaid: "Mermaid"
      }
    }

    return dictionary[language][key]
  }

  function escapeMermaidLabel(value: string) {
    return value.replace(/"/g, "'").replace(/\n/g, " ")
  }

  function toMermaid(graphNodes = nodes, graphEdges = edges) {
    const lines = ["flowchart TD"]
    for (const node of graphNodes) {
      const shape = node.depth === 0 ? "((\"" : "[\""
      const close = node.depth === 0 ? "\"))" : "\"]"
      lines.push(`  ${node.id}${shape}${escapeMermaidLabel(node.label)}${close}`)
    }

    for (const edge of graphEdges) {
      if (!graphNodes.some((node) => node.id === edge.from)) continue
      if (!graphNodes.some((node) => node.id === edge.to)) continue
      lines.push(
        `  ${edge.from} -->|${escapeMermaidLabel(edge.relation || "requires")}| ${edge.to}`
      )
    }

    return lines.join("\n")
  }

  async function handleExportMermaid() {
    const mermaid = toMermaid()
    try {
      await navigator.clipboard.writeText(mermaid)
      showToast(getCopy("copied"))
    } catch {
      try {
        const textarea = document.createElement("textarea")
        textarea.value = mermaid
        textarea.style.position = "fixed"
        textarea.style.opacity = "0"
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand("copy")
        textarea.remove()
        showToast(getCopy("copied"))
      } catch {
        showToast(getCopy("copyFailed"))
      }
    }
  }

  function restoreGraph(graph: GraphData) {
    generationIdRef.current = 0
    setConcept(graph.concept)
    setPageContent("")
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setLoading(false)
    setError(null)
    setActiveTab("map")
  }

  useEffect(() => {
    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>
    ) {
      if (changes._pendingGeneration) {
        const data = changes._pendingGeneration.newValue
        if (data) {
          consumePendingGeneration(data)
          chrome.storage.local.remove("_pendingGeneration")
        }
      }

      if (changes.streamBuffer) {
        applyStreamBuffer(changes.streamBuffer.newValue)
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  useEffect(() => {
    if (!loading) return

    const timeout = window.setTimeout(() => {
      setLoading(false)
      setError(
        language === "zh"
          ? "生成时间过长。可以重试，或检查 API Key 和网络设置。"
          : "Mapping is taking longer than expected. Try again, or check your API key/network settings."
      )
    }, 45000)

    return () => window.clearTimeout(timeout)
  }, [language, loading])

  function dedupeNodes(items: GraphNode[]) {
    const seen = new Set<string>()
    return items.filter((node) => {
      if (seen.has(node.id)) return false
      seen.add(node.id)
      return true
    })
  }

  function applyStreamBuffer(
    buf?: {
      status: "streaming" | "done" | "error"
      generationId?: number
      nodes?: GraphNode[]
      edges?: GraphEdge[]
      error?: string
    },
    expectedGenerationId = generationIdRef.current
  ) {
    if (!buf) return false
    if (
      buf.generationId !== undefined &&
      expectedGenerationId &&
      buf.generationId !== expectedGenerationId
    ) {
      return false
    }

    if (buf.generationId !== undefined) {
      generationIdRef.current = buf.generationId
    }

    if (buf.status === "streaming") {
      setNodes(dedupeNodes([...(buf.nodes || [])]))
      setEdges([...(buf.edges || [])])
      setLoading(true)
      setError(null)
      return true
    }

    if (buf.status === "done") {
      setNodes(dedupeNodes([...(buf.nodes || [])]))
      setEdges([...(buf.edges || [])])
      setLoading(false)
      setError(null)
      refreshLearningSummary()
      return true
    }

    if (buf.status === "error") {
      setNodes(dedupeNodes([...(buf.nodes || [])]))
      setEdges([...(buf.edges || [])])
      setLoading(false)
      setError(getErrorText(buf.error || (language === "zh" ? "未知错误" : "Unknown error")))
      return true
    }

    return false
  }

  async function triggerGeneration(data: {
    selectedText: string
    pageContent: string
    pageTitle: string
    pageUrl: string
    generationId?: number
  }) {
    generationIdRef.current = data.generationId || Date.now()
    setLoading(true)
    setLoadingLabel("Mapping hidden assumptions")
    setError(null)
    setNodes([])
    setEdges([])
    setConcept(data.selectedText)

    try {
      await chrome.runtime.sendMessage({
        action: "generate-graph",
        selectedText: data.selectedText,
        pageContent: data.pageContent,
        pageTitle: data.pageTitle,
        pageUrl: data.pageUrl,
        language,
        generationId: generationIdRef.current
      })
    } catch (err: any) {
      setError(getErrorText(err.message || "Failed to generate graph"))
      setLoading(false)
    }
  }

  function consumePendingGeneration(data: {
    selectedText: string
    pageContent: string
    pageTitle: string
    pageUrl: string
    generationId?: number
  }) {
    setConcept(data.selectedText)
    setPageContent(data.pageContent)

    if (data.generationId) {
      generationIdRef.current = data.generationId
      setLoading(true)
      setLoadingLabel("Mapping hidden assumptions")
      setError(null)
      setNodes([])
      setEdges([])
      chrome.storage.local.get("streamBuffer", (result) => {
        applyStreamBuffer(result.streamBuffer, data.generationId)
      })
      return
    }

    triggerGeneration(data)
  }

  async function handleExpandNode(nodeId: string, nodeLabel: string) {
    setLoading(true)
    setLoadingLabel(`Finding prerequisites for ${nodeLabel}`)
    setError(null)
    try {
      const result = await chrome.runtime.sendMessage({
        action: "expand-node",
        nodeId,
        nodeLabel,
        parentConcept: concept,
        pageContent,
        language
      })
      if (result?.success) {
        setNodes((prev) => {
          const updated = prev.map((n) =>
            n.id === nodeId ? { ...n, expanded: true } : n
          )
          const existingIds = new Set(updated.map((n) => n.id))
          const newChildren = (result.children || []).filter(
            (child: GraphNode) => !existingIds.has(child.id)
          )
          const expandState = newChildren.length > 0 ? "found" : "none"
          const expandMessage =
            newChildren.length > 0
              ? language === "zh"
                ? "前置知识已显示在下方。"
                : "Prerequisites shown below."
              : language === "zh"
                ? "这个节点暂未找到更深一层的前置知识。"
                : "No deeper prerequisites found for this node."

          return [
            ...updated.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    expanded: true,
                    expandState,
                    expandMessage
                  }
                : n
            ),
            ...newChildren
          ]
        })
        setEdges((prev) => {
          const existing = new Set(prev.map((edge) => `${edge.from}->${edge.to}`))
          const returnedEdges = (result.edges || []) as GraphEdge[]
          const edgesByChild = new Map(
            returnedEdges
              .filter((edge) => edge.from === nodeId)
              .map((edge) => [edge.to, edge])
          )
          const fallbackEdges = ((result.children || []) as GraphNode[]).map(
            (child) =>
              edgesByChild.get(child.id) || {
                from: nodeId,
                to: child.id,
                relation: "requires"
              }
          )
          return [
            ...prev,
            ...fallbackEdges.filter((edge) => !existing.has(`${edge.from}->${edge.to}`))
          ]
        })
      } else {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  expanded: false,
                  expandState: "failed" as const,
                  expandMessage:
                    language === "zh"
                      ? "未能生成更深一层的前置知识。可以重试。"
                      : "Could not generate deeper prerequisites. Try again."
                }
              : n
          )
        )
        setError(getErrorText(result?.error || "Failed to expand node"))
      }
    } catch (err: any) {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                expanded: false,
                expandState: "failed" as const,
                expandMessage:
                  language === "zh"
                    ? "未能生成更深一层的前置知识。可以重试。"
                    : "Could not generate deeper prerequisites. Try again."
              }
            : n
        )
      )
      setError(getErrorText(err.message))
    }
    setLoading(false)
  }

  async function handleRefreshNode(nodeId: string, nodeLabel: string) {
    setLoading(true)
    setLoadingLabel(`Replacing ${nodeLabel}`)
    setError(null)
    try {
      const result = await chrome.runtime.sendMessage({
        action: "refresh-node",
        nodeId,
        nodeLabel,
        parentConcept: concept,
        pageContent,
        language
      })
      if (result?.success && result.node) {
        const oldNode = nodes.find((n) => n.id === nodeId)
        const replacement: GraphNode = {
          ...result.node,
          depth: oldNode?.depth ?? result.node.depth
        }
        setNodes((prev) => {
          const filtered = prev.filter((n) => n.id !== nodeId)
          return [...filtered, replacement]
        })
        setEdges((prev) => {
          const oldId = oldNode?.id || nodeId
          if (!oldId) return prev
          return prev.map((e) =>
            e.to === oldId ? { ...e, to: replacement.id } : e
          )
        })
      }
    } catch (err: any) {
      setError(getErrorText(err.message))
    }
    setLoading(false)
  }

  async function handleMarkKnown(nodeLabel: string) {
    const node = nodes.find((n) => n.label === nodeLabel)
    if (!node) return

    if (node.status === "mastered") {
      await chrome.runtime.sendMessage({
        action: "remove-known",
        label: nodeLabel
      })
      setNodes((prev) =>
        prev.map((n) =>
          n.label === nodeLabel ? { ...n, status: "unexplored" as const } : n
        )
      )
      refreshLearningSummary()
    } else {
      const knownResult = await chrome.runtime.sendMessage({
        action: "add-known",
        label: nodeLabel
      })
      if (!knownResult?.success) return
      setNodes((prev) =>
        prev.map((n) =>
          n.label === nodeLabel ? { ...n, status: "mastered" as const } : n
        )
      )
      refreshLearningSummary()
    }
  }

  if (showSettings) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.logo}>LinkLog</span>
          <button onClick={toggleLanguage} style={styles.langBtn}>
            {language === "en" ? "中文" : "EN"}
          </button>
        </div>
        <Settings
          apiKey={apiKey}
          apiBaseUrl={apiBaseUrl}
          language={language}
          onSave={(key, url) => {
            setApiKey(key)
            setApiBaseUrl(url)
            setShowSettings(false)
          }}
          onClose={() => (apiKey || HAS_HOSTED_TRIAL) && setShowSettings(false)}
        />
      </div>
    )
  }

  const hasGraph = nodes.length > 0
  const recentGraphs = summary?.recentGraphs || []

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <span style={styles.logo}>LinkLog</span>
          {summary && (
            <div style={styles.headerMeta}>
              {language === "zh"
                ? `连续 ${summary.streak} 天 · 已掌握 ${summary.knownCount} 个 · ${summary.exploredCount} 张图`
                : `${summary.streak} day streak · ${summary.knownCount} known · ${summary.exploredCount} maps`}
            </div>
          )}
        </div>
        <div style={styles.headerActions}>
          {hasGraph && (
            <button
              onClick={handleExportMermaid}
              disabled={loading}
              style={{
                ...styles.toolBtn,
                ...(loading ? styles.disabledToolBtn : {})
              }}
              title={language === "zh" ? "复制 Mermaid" : "Copy Mermaid"}
            >
              {getCopy("mermaid")}
            </button>
          )}
          <button onClick={toggleLanguage} style={styles.langBtn}>
            {language === "en" ? "中文" : "EN"}
          </button>
          <button onClick={() => setShowSettings(true)} style={styles.iconBtn}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      <div style={styles.tabs}>
        <button
          onClick={() => setActiveTab("map")}
          style={{
            ...styles.tabBtn,
            ...(activeTab === "map" ? styles.tabBtnActive : {})
          }}
        >
          {getCopy("map")}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          style={{
            ...styles.tabBtn,
            ...(activeTab === "history" ? styles.tabBtnActive : {})
          }}
        >
          {getCopy("history")}
        </button>
      </div>

      <div style={styles.body}>
        {activeTab === "history" ? (
          <div style={styles.historyPanel}>
            {recentGraphs.length === 0 ? (
              <div style={styles.historyEmpty}>{getCopy("emptyHistory")}</div>
            ) : (
              recentGraphs.map((graph) => (
                <button
                  key={`${graph.sourceUrl}:${graph.concept}:${graph.createdAt}`}
                  onClick={() => restoreGraph(graph)}
                  style={styles.historyItem}
                >
                  <div style={styles.historyTitle}>{graph.concept}</div>
                  <div style={styles.historyMeta}>
                    {new Date(graph.createdAt).toLocaleDateString()} · {graph.nodes.length - 1}{" "}
                    {language === "zh" ? "个节点" : "nodes"}
                  </div>
                  <div style={styles.historySource}>
                    {graph.sourceTitle || graph.sourceUrl}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : !hasGraph && !loading ? (
          <div style={styles.empty}>
            <div style={styles.emptyMark}>LL</div>
            <h3 style={styles.emptyTitle}>
              {language === "zh" ? "选择一个概念开始绘制" : "Select a concept to map"}
            </h3>
            <p style={styles.emptyCopy}>
              {language === "zh"
                ? "在任意文章中划选一个短语。LinkLog 会找出理解这个概念所需的隐藏前置知识。"
                : "Highlight a phrase on any article. LinkLog will surface the hidden assumptions that make the idea click."}
            </p>
          </div>
        ) : (
          <GraphView
            nodes={nodes}
            edges={edges}
            loading={loading}
            loadingLabel={getLoadingText(loadingLabel)}
            error={error}
            language={language}
            onExpandNode={handleExpandNode}
            onRefreshNode={handleRefreshNode}
            onMarkKnown={handleMarkKnown}
          />
        )}
      </div>
      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: "100vw",
    height: "100vh",
    margin: 0,
    padding: 0,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    background: "#f7f3ea",
    color: "#25231e",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  },
  header: {
    padding: "12px 16px",
    borderBottom: "1px solid #e1d8c8",
    background: "#fbf8f1",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0
  },
  logo: {
    fontSize: 16,
    fontWeight: 700,
    color: "#1b1813"
  },
  headerMeta: {
    marginTop: 3,
    fontSize: 11,
    color: "#6d6254",
    lineHeight: 1.3
  },
  iconBtn: {
    background: "none",
    border: "none",
    color: "#71717a",
    cursor: "pointer",
    padding: "4px 8px",
    display: "flex",
    alignItems: "center"
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 6
  },
  toolBtn: {
    height: 26,
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "#8a7f70",
    fontSize: 11,
    fontWeight: 750,
    padding: "0 6px",
    cursor: "pointer"
  },
  disabledToolBtn: {
    opacity: 0.45,
    cursor: "not-allowed"
  },
  langBtn: {
    minWidth: 44,
    height: 28,
    border: "1px solid #d2c5b1",
    borderRadius: 7,
    background: "#fffaf0",
    color: "#3a352d",
    fontSize: 12,
    fontWeight: 750,
    cursor: "pointer"
  },
  tabs: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 16px",
    borderBottom: "1px solid #e1d8c8",
    background: "#fbf8f1"
  },
  tabBtn: {
    height: 24,
    border: "none",
    borderRadius: 999,
    background: "transparent",
    color: "#897f71",
    fontSize: 12,
    fontWeight: 750,
    cursor: "pointer",
    padding: "0 10px"
  },
  tabBtnActive: {
    background: "#eee5d6",
    color: "#26392f"
  },
  body: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column"
  },
  historyPanel: {
    flex: 1,
    overflow: "auto",
    padding: "8px 16px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 0
  },
  historyEmpty: {
    padding: "18px 0",
    color: "#746a5b",
    fontSize: 14,
    lineHeight: 1.55
  },
  historyItem: {
    width: "100%",
    display: "block",
    textAlign: "left" as const,
    padding: "11px 0",
    border: "none",
    borderBottom: "1px solid #e3d9ca",
    borderRadius: 0,
    background: "transparent",
    color: "#25231e",
    cursor: "pointer"
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: 780,
    color: "#1d1a15",
    overflowWrap: "anywhere" as const
  },
  historyMeta: {
    marginTop: 5,
    color: "#7b6f60",
    fontSize: 11
  },
  historySource: {
    marginTop: 6,
    color: "#665f53",
    fontSize: 12,
    lineHeight: 1.4,
    overflowWrap: "anywhere" as const
  },
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    zIndex: 30,
    padding: "10px 12px",
    borderRadius: 8,
    background: "#26392f",
    color: "#fffaf0",
    fontSize: 13,
    fontWeight: 700,
    textAlign: "center" as const,
    boxShadow: "0 12px 28px rgba(38,57,47,0.22)"
  },
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    textAlign: "center" as const
  },
  emptyMark: {
    width: 42,
    height: 42,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    background: "#26392f",
    color: "#fffaf0",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 0
  },
  emptyTitle: {
    margin: "0 0 8px",
    fontSize: 17,
    fontWeight: 760,
    color: "#1d1a15"
  },
  emptyCopy: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.6,
    color: "#665f53",
    maxWidth: 285
  }
}

export default SidePanel
