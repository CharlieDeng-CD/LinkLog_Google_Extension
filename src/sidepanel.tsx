import { useEffect, useRef, useState } from "react"
import GraphView from "~components/GraphView"
import Settings from "~components/Settings"
import type { GraphNode, GraphEdge } from "~types"

function SidePanel() {
  const [apiKey, setApiKey] = useState<string>("")
  const [apiBaseUrl, setApiBaseUrl] = useState<string>("")
  const [showSettings, setShowSettings] = useState(false)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [concept, setConcept] = useState<string>("")
  const [pageContent, setPageContent] = useState<string>("")
  const generationIdRef = useRef(0)

  useEffect(() => {
    chrome.storage.local.get(["apiKey", "apiBaseUrl", "_pendingGeneration"], (result) => {
      const key = result.apiKey || ""
      setApiKey(key)
      setApiBaseUrl(result.apiBaseUrl || "https://api.deepseek.com")
      if (!key) {
        setShowSettings(true)
        return
      }
      if (result._pendingGeneration) {
        const data = result._pendingGeneration
        setConcept(data.selectedText)
        setPageContent(data.pageContent)
        triggerGeneration(data)
        chrome.storage.local.remove("_pendingGeneration")
      }
    })
  }, [])

  useEffect(() => {
    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>
    ) {
      if (changes._pendingGeneration) {
        const data = changes._pendingGeneration.newValue
        if (data) {
          setConcept(data.selectedText)
          setPageContent(data.pageContent)
          triggerGeneration(data)
          chrome.storage.local.remove("_pendingGeneration")
        }
      }

      if (changes.streamBuffer) {
        const buf = changes.streamBuffer.newValue
        if (!buf) return
        if (buf.generationId !== undefined && buf.generationId !== generationIdRef.current) return

        const dedupeNodes = (nodes: GraphNode[]) => {
          const seen = new Set<string>()
          return nodes.filter((n) => {
            if (seen.has(n.id)) return false
            seen.add(n.id)
            return true
          })
        }

        if (buf.status === "streaming") {
          setNodes(dedupeNodes([...buf.nodes]))
          setEdges([...buf.edges])
          setLoading(true)
          setError(null)
        } else if (buf.status === "done") {
          setNodes(dedupeNodes([...buf.nodes]))
          setEdges([...buf.edges])
          setLoading(false)
        } else if (buf.status === "error") {
          setNodes(dedupeNodes([...(buf.nodes || [])]))
          setEdges([...(buf.edges || [])])
          setLoading(false)
          setError(buf.error || "Unknown error")
        }
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  async function triggerGeneration(data: {
    selectedText: string
    pageContent: string
    pageTitle: string
    pageUrl: string
  }) {
    generationIdRef.current = Date.now()
    setLoading(true)
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
        generationId: generationIdRef.current
      })
    } catch (err: any) {
      setError(err.message || "Failed to generate graph")
      setLoading(false)
    }
  }

  async function handleExpandNode(nodeLabel: string) {
    setLoading(true)
    try {
      const result = await chrome.runtime.sendMessage({
        action: "expand-node",
        nodeLabel,
        parentConcept: concept,
        pageContent
      })
      if (result?.success) {
        setNodes((prev) => {
          const updated = prev.map((n) =>
            n.label === nodeLabel ? { ...n, expanded: true } : n
          )
          return [...updated, ...result.children]
        })
        setEdges((prev) => [...prev, ...result.edges])
      } else {
        setError(result?.error || "Failed to expand node")
      }
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function handleRefreshNode(nodeLabel: string) {
    setLoading(true)
    try {
      const result = await chrome.runtime.sendMessage({
        action: "refresh-node",
        nodeLabel,
        parentConcept: concept,
        pageContent
      })
      if (result?.success && result.node) {
        setNodes((prev) => {
          const filtered = prev.filter((n) => n.label !== nodeLabel)
          return [...filtered, result.node]
        })
        setEdges((prev) => {
          const oldNode = nodes.find((n) => n.label === nodeLabel)
          const oldId = oldNode?.id
          if (!oldId) return prev
          return prev.map((e) =>
            e.to === oldId ? { ...e, to: result.node.id } : e
          )
        })
      }
    } catch (err: any) {
      setError(err.message)
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
    } else {
      const result = await chrome.storage.local.get("knownNodes")
      const list = result.knownNodes || []
      if (!list.includes(nodeLabel)) list.push(nodeLabel)
      await chrome.storage.local.set({ knownNodes: list })
      setNodes((prev) =>
        prev.map((n) =>
          n.label === nodeLabel ? { ...n, status: "mastered" as const } : n
        )
      )
    }
  }

  if (showSettings) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.logo}>LinkLog</span>
        </div>
        <Settings
          apiKey={apiKey}
          apiBaseUrl={apiBaseUrl}
          onSave={(key, url) => {
            setApiKey(key)
            setApiBaseUrl(url)
            setShowSettings(false)
          }}
          onClose={() => apiKey && setShowSettings(false)}
        />
      </div>
    )
  }

  const hasGraph = nodes.length > 0

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.logo}>LinkLog</span>
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

      <div style={styles.body}>
        {!hasGraph && !loading ? (
          <div style={styles.empty}>
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#52525b"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginBottom: 16 }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: "#a1a1aa", marginBottom: 8 }}>
              Select a concept to explore
            </h3>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "#71717a", maxWidth: 260 }}>
              Highlight any concept on a webpage, then click the LinkLog button
              to generate an interactive knowledge graph.
            </p>
          </div>
        ) : (
          <GraphView
            nodes={nodes}
            edges={edges}
            loading={loading}
            error={error}
            onExpandNode={handleExpandNode}
            onRefreshNode={handleRefreshNode}
            onMarkKnown={handleMarkKnown}
          />
        )}
      </div>
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
    background: "#0f0f13",
    color: "#e4e4e7",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  },
  header: {
    padding: "12px 16px",
    borderBottom: "1px solid #27272a",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0
  },
  logo: {
    fontSize: 16,
    fontWeight: 700,
    background: "linear-gradient(135deg, #6366f1, #a78bfa)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent"
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
  body: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column"
  },
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    textAlign: "center" as const
  }
}

export default SidePanel
