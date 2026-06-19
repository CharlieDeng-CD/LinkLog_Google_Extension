import React, { useEffect, useMemo, useState } from "react"
import type { GraphNode, GraphEdge, UiLanguage } from "~types"

interface GraphViewProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  loading: boolean
  loadingLabel: string
  error: string | null
  language: UiLanguage
  onExpandNode: (id: string, label: string) => void
  onRefreshNode: (id: string, label: string) => void
  onMarkKnown: (label: string) => void
}

const COPY = {
  en: {
    selectedConcept: "Selected concept",
    readyToMap: "Ready to map",
    conceptCopyKnown: "Map the hidden assumptions before you keep reading.",
    conceptCopyEmpty: "Highlight a concept on any page to reveal what the article expects you to already know.",
    unknowns: "unknowns",
    known: "known",
    toUnlock: "to unlock",
    compass: "Knowledge compass",
    tapNode: "tap a node",
    currentTarget: "current reading target",
    hiddenAssumptions: "Hidden assumptions",
    highLeverage: "high leverage first",
    empty: "Select text on a page, then use the LinkLog button to generate a map.",
    prerequisiteOf: "Prerequisite of",
    why: "Why this unlocks it",
    fallbackSummary: "This is one of the hidden assumptions behind the selected concept.",
    show: "Show prerequisites",
    retry: "Try again",
    shown: "Prerequisites shown",
    replace: "Replace",
    knownAction: "Known",
    markKnown: "I know this",
    depthLimit: "Deeper expansion is limited to the first layer for now.",
    loadingCopy: "Reading the page context and arranging the map...",
    status: {
      unexplored: "Unknown",
      learning: "Reading",
      mastered: "Known"
    }
  },
  zh: {
    selectedConcept: "选中的概念",
    readyToMap: "等待划词",
    conceptCopyKnown: "继续阅读前，先看懂它背后的隐藏前置知识。",
    conceptCopyEmpty: "在任意网页划选一个概念，LinkLog 会帮你找出文章默认你已经知道的内容。",
    unknowns: "未知",
    known: "已掌握",
    toUnlock: "可展开",
    compass: "知识罗盘",
    tapNode: "点击节点",
    currentTarget: "当前阅读目标",
    hiddenAssumptions: "隐藏前置知识",
    highLeverage: "优先高价值节点",
    empty: "在网页中划选文字，然后点击 LinkLog 按钮生成知识地图。",
    prerequisiteOf: "前置于",
    why: "为什么它重要",
    fallbackSummary: "这是理解所选概念背后的一个隐藏前置知识。",
    show: "显示前置知识",
    retry: "重试",
    shown: "已显示前置知识",
    replace: "替换",
    knownAction: "已掌握",
    markKnown: "我知道这个",
    depthLimit: "当前只支持展开第一层知识点，避免地图变得过深。",
    loadingCopy: "正在阅读页面上下文并整理知识地图...",
    status: {
      unexplored: "未知",
      learning: "阅读中",
      mastered: "已掌握"
    }
  }
}

const STATUS_COLORS: Record<GraphNode["status"], string> = {
  unexplored: "#9b4a32",
  learning: "#b8872d",
  mastered: "#4f7d63"
}

function getIncomingRelation(
  edges: GraphEdge[],
  nodeId: string,
  language: UiLanguage
) {
  const relation = edges.find((edge) => edge.to === nodeId)?.relation || "unlocks"
  if (language === "en") return relation

  const normalized = relation.toLowerCase()
  if (normalized === "requires") return "需要先理解"
  if (normalized === "unlocks") return "帮助理解"
  if (normalized === "related") return "相关"
  if (normalized === "prerequisite") return "前置知识"
  return relation
}

export default function GraphView({
  nodes,
  edges,
  loading,
  loadingLabel,
  error,
  language,
  onExpandNode,
  onRefreshNode,
  onMarkKnown
}: GraphViewProps) {
  const rootNode = nodes.find((node) => node.depth === 0)
  const unknownNodes = useMemo(
    () => nodes.filter((node) => node.depth > 0),
    [nodes]
  )
  const topLevelNodes = useMemo(
    () =>
      unknownNodes.filter((node) => {
        const parentId = edges.find((edge) => edge.to === node.id)?.from
        return node.depth === 1 || !parentId || parentId === "root"
      }),
    [edges, unknownNodes]
  )
  const childrenByParent = useMemo(() => {
    const groups = new Map<string, GraphNode[]>()
    for (const edge of edges) {
      if (edge.from === "root") continue
      const child = unknownNodes.find((node) => node.id === edge.to)
      if (!child) continue
      const children = groups.get(edge.from) || []
      children.push(child)
      groups.set(edge.from, children)
    }
    return groups
  }, [edges, unknownNodes])
  const [selectedId, setSelectedId] = useState<string>("")

  useEffect(() => {
    if (!unknownNodes.length) {
      setSelectedId(rootNode?.id || "")
      return
    }
    if (!unknownNodes.some((node) => node.id === selectedId)) {
      setSelectedId(topLevelNodes[0]?.id || unknownNodes[0].id)
    }
  }, [rootNode?.id, selectedId, topLevelNodes, unknownNodes])

  const selected =
    unknownNodes.find((node) => node.id === selectedId) ||
    rootNode ||
    unknownNodes[0] ||
    null
  const masteredCount = unknownNodes.filter((node) => node.status === "mastered").length
  const selectedParent = edges.find((edge) => edge.to === selected?.id)?.from
  const selectedParentNode = nodes.find((node) => node.id === selectedParent)
  const canRetryPrerequisites =
    selected?.depth === 1 &&
    (selected.expandState === "none" || selected.expandState === "failed")
  const copy = COPY[language]
  const unlockableNodes = unknownNodes.filter(
    (node) => node.depth === 1 && !node.expanded
  )

  return (
    <div style={styles.container}>
      <div style={styles.scrollArea}>
        <section style={styles.conceptSection}>
          <div style={styles.kicker}>{copy.selectedConcept}</div>
          <h1 style={styles.conceptTitle}>{rootNode?.label || copy.readyToMap}</h1>
          <p style={styles.conceptCopy}>
            {unknownNodes.length
              ? copy.conceptCopyKnown
              : copy.conceptCopyEmpty}
          </p>
        </section>

        <section style={styles.statsRow}>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{unknownNodes.length}</span>
            <span style={styles.statLabel}>{copy.unknowns}</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{masteredCount}</span>
            <span style={styles.statLabel}>{copy.known}</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{unlockableNodes.length}</span>
            <span style={styles.statLabel}>{copy.toUnlock}</span>
          </div>
        </section>

        {rootNode && unknownNodes.length > 0 && (
          <section style={styles.mapSection}>
            <div style={styles.sectionHeader}>
              <span>{copy.compass}</span>
              <span style={styles.sectionHint}>{copy.tapNode}</span>
            </div>
            <div style={styles.mapRoot}>
              <span style={styles.rootDot} />
              <div>
                <div style={styles.rootLabel}>{rootNode.label}</div>
                <div style={styles.rootHint}>{copy.currentTarget}</div>
              </div>
            </div>
            <div style={styles.branchList}>
              {topLevelNodes.slice(0, 5).map((node, index) => {
                const active = selected?.id === node.id
                const children = childrenByParent.get(node.id) || []
                return (
                  <div key={node.id} style={styles.branchGroup}>
                    <button
                      onClick={() => setSelectedId(node.id)}
                      disabled={loading}
                      style={{
                        ...styles.branchNode,
                        ...(active ? styles.branchNodeActive : {}),
                        ...(loading ? styles.disabledControl : {})
                      }}
                    >
                      <span style={styles.branchIndex}>{index + 1}</span>
                      <span style={styles.branchText}>{node.label}</span>
                      <span
                        style={{
                          ...styles.statusDot,
                          background: STATUS_COLORS[node.status]
                        }}
                      />
                    </button>
                    {children.length > 0 && (
                      <div style={styles.childBranchList}>
                        {children.map((child) => {
                          const childActive = selected?.id === child.id
                          return (
                            <button
                              key={child.id}
                              onClick={() => setSelectedId(child.id)}
                              disabled={loading}
                              style={{
                                ...styles.branchNode,
                                ...styles.childBranchNode,
                                ...(childActive ? styles.branchNodeActive : {}),
                                ...(loading ? styles.disabledControl : {})
                              }}
                            >
                              <span style={styles.branchIndex}>↳</span>
                              <span style={styles.branchText}>{child.label}</span>
                              <span
                                style={{
                                  ...styles.statusDot,
                                  background: STATUS_COLORS[child.status]
                                }}
                              />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section style={styles.listSection}>
          <div style={styles.sectionHeader}>
            <span>{copy.hiddenAssumptions}</span>
            <span style={styles.sectionHint}>{copy.highLeverage}</span>
          </div>

          {unknownNodes.length === 0 ? (
            <div style={styles.emptyState}>
              {copy.empty}
            </div>
          ) : (
            <div style={styles.rows}>
              {topLevelNodes.map((node) => {
                const active = selected?.id === node.id
                const children = childrenByParent.get(node.id) || []
                return (
                  <div key={node.id} style={styles.rowGroup}>
                    <button
                      onClick={() => setSelectedId(node.id)}
                      disabled={loading}
                      style={{
                        ...styles.row,
                        ...(active ? styles.rowActive : {}),
                        ...(loading ? styles.disabledControl : {})
                      }}
                    >
                      <div style={styles.rowTop}>
                        <span style={styles.rowTitle}>{node.label}</span>
                        <span
                          style={{
                            ...styles.statusPill,
                            color: STATUS_COLORS[node.status],
                            borderColor: `${STATUS_COLORS[node.status]}55`,
                            background: `${STATUS_COLORS[node.status]}12`
                          }}
                        >
                          {copy.status[node.status]}
                        </span>
                      </div>
                      <div style={styles.rowSummary}>{node.summary}</div>
                      <div style={styles.rowRelation}>
                        {getIncomingRelation(edges, node.id, language)}
                      </div>
                    </button>
                    {children.length > 0 && (
                      <div style={styles.childRows}>
                        {children.map((child) => {
                          const childActive = selected?.id === child.id
                          return (
                            <button
                              key={child.id}
                              onClick={() => setSelectedId(child.id)}
                              disabled={loading}
                              style={{
                                ...styles.row,
                                ...styles.childRow,
                                ...(childActive ? styles.rowActive : {}),
                                ...(loading ? styles.disabledControl : {})
                              }}
                            >
                              <div style={styles.childMarker}>{copy.prerequisiteOf} {node.label}</div>
                              <div style={styles.rowTop}>
                                <span style={styles.rowTitle}>{child.label}</span>
                                <span
                                  style={{
                                    ...styles.statusPill,
                                    color: STATUS_COLORS[child.status],
                                    borderColor: `${STATUS_COLORS[child.status]}55`,
                                    background: `${STATUS_COLORS[child.status]}12`
                                  }}
                                >
                                  {copy.status[child.status]}
                                </span>
                              </div>
                              <div style={styles.rowSummary}>{child.summary}</div>
                              <div style={styles.rowRelation}>
                                {getIncomingRelation(edges, child.id, language)}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {error && <div style={styles.errorBar}>{error}</div>}

      {selected && (
        <section style={styles.detailPanel}>
          <div style={styles.detailEyebrow}>
            {selectedParentNode && selectedParentNode.id !== "root"
              ? `${copy.prerequisiteOf} ${selectedParentNode.label}`
              : copy.why}
          </div>
          <div style={styles.detailTitle}>{selected.label}</div>
          <p style={styles.detailCopy}>
            {selected.summary || copy.fallbackSummary}
          </p>
          {selected.expandMessage && (
            <div
              style={{
                ...styles.expandNotice,
                ...(selected.expandState === "failed" ? styles.expandNoticeError : {})
              }}
            >
              {selected.expandMessage}
            </div>
          )}
          <div style={styles.detailActions}>
            {selected.depth === 1 && (!selected.expanded || canRetryPrerequisites) && (
              <button
                style={{
                  ...styles.primaryBtn,
                  ...(selected.expandState === "none" ? styles.retryBtn : {}),
                  ...(selected.expandState === "failed" ? styles.retryBtn : {}),
                  ...(loading ? styles.disabledControl : {})
                }}
                onClick={() => onExpandNode(selected.id, selected.label)}
                disabled={loading}
              >
                {canRetryPrerequisites ? copy.retry : copy.show}
              </button>
            )}
            {selected.depth === 1 && selected.expandState === "found" && (
              <button
                style={{
                  ...styles.secondaryBtn,
                  ...styles.disabledControl
                }}
                disabled
              >
                {copy.shown}
              </button>
            )}
            {selected.depth > 1 && (
              <div style={styles.depthNotice}>{copy.depthLimit}</div>
            )}
            <button
              style={{
                ...styles.secondaryBtn,
                ...(loading ? styles.disabledControl : {})
              }}
              onClick={() => onRefreshNode(selected.id, selected.label)}
              disabled={loading}
            >
              {copy.replace}
            </button>
            <button
              style={{
                ...styles.secondaryBtn,
                ...(selected.status === "mastered" ? styles.knownBtn : {}),
                ...(loading ? styles.disabledControl : {})
              }}
              onClick={() => onMarkKnown(selected.label)}
              disabled={loading}
            >
              {selected.status === "mastered" ? copy.knownAction : copy.markKnown}
            </button>
          </div>
        </section>
      )}

      {loading && (
        <div style={styles.loadingOverlay}>
          <div style={styles.loadingCard}>
            <div style={styles.loadingSpinner} />
            <div>
              <div style={styles.loadingTitle}>{loadingLabel}</div>
              <div style={styles.loadingCopy}>
                {copy.loadingCopy}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#f7f3ea",
    color: "#25231e"
  },
  scrollArea: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "16px 16px 18px"
  },
  conceptSection: {
    paddingBottom: 16,
    borderBottom: "1px solid #e1d8c8"
  },
  kicker: {
    color: "#7b6f60",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: 0
  },
  conceptTitle: {
    margin: "7px 0 8px",
    fontSize: 25,
    lineHeight: 1.08,
    fontWeight: 760,
    color: "#191713"
  },
  conceptCopy: {
    margin: 0,
    color: "#665f53",
    fontSize: 14,
    lineHeight: 1.55
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 1,
    margin: "14px 0",
    border: "1px solid #e3dac9",
    borderRadius: 8,
    overflow: "hidden",
    background: "#e3dac9"
  },
  statItem: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "10px 8px",
    background: "#fbf8f1"
  },
  statValue: {
    color: "#2f3f35",
    fontSize: 17,
    fontWeight: 760
  },
  statLabel: {
    color: "#7b6f60",
    fontSize: 11
  },
  mapSection: {
    marginTop: 14,
    paddingBottom: 16,
    borderBottom: "1px solid #e1d8c8"
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
    color: "#2c2923",
    fontSize: 13,
    fontWeight: 750
  },
  sectionHint: {
    color: "#8d8171",
    fontSize: 11,
    fontWeight: 500
  },
  mapRoot: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 0"
  },
  rootDot: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "#26392f",
    boxShadow: "0 0 0 5px #dfe7dc"
  },
  rootLabel: {
    color: "#1e1b16",
    fontSize: 14,
    fontWeight: 730
  },
  rootHint: {
    marginTop: 2,
    color: "#827666",
    fontSize: 11
  },
  branchList: {
    marginLeft: 5,
    paddingLeft: 15,
    borderLeft: "1px solid #cfc4b3",
    display: "flex",
    flexDirection: "column",
    gap: 7
  },
  branchGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 5
  },
  branchNode: {
    width: "100%",
    minHeight: 34,
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr) 10px",
    alignItems: "center",
    gap: 8,
    textAlign: "left" as const,
    border: "1px solid transparent",
    borderRadius: 8,
    padding: "7px 9px",
    background: "transparent",
    color: "#2b2822",
    cursor: "pointer"
  },
  branchNodeActive: {
    borderColor: "#cdbf9e",
    background: "#fffaf0"
  },
  childBranchList: {
    marginLeft: 15,
    paddingLeft: 12,
    borderLeft: "1px dashed #d0c4b4",
    display: "flex",
    flexDirection: "column",
    gap: 5
  },
  childBranchNode: {
    minHeight: 31,
    background: "#fbf8f1"
  },
  branchIndex: {
    color: "#9b4a32",
    fontSize: 11,
    fontWeight: 800
  },
  branchText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    fontSize: 13,
    fontWeight: 650
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%"
  },
  listSection: {
    marginTop: 16
  },
  emptyState: {
    padding: "18px 0",
    color: "#746a5b",
    fontSize: 14,
    lineHeight: 1.55
  },
  rows: {
    borderTop: "1px solid #e2d8c7"
  },
  rowGroup: {
    borderBottom: "1px solid #e2d8c7"
  },
  row: {
    width: "100%",
    display: "block",
    textAlign: "left" as const,
    padding: "13px 2px",
    border: "none",
    borderBottom: "none",
    background: "transparent",
    color: "#25231e",
    cursor: "pointer"
  },
  rowActive: {
    background: "#fffaf0"
  },
  rowTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  rowTitle: {
    minWidth: 0,
    color: "#1d1a15",
    fontSize: 15,
    fontWeight: 740,
    overflowWrap: "anywhere" as const
  },
  statusPill: {
    flexShrink: 0,
    border: "1px solid",
    borderRadius: 6,
    padding: "3px 6px",
    fontSize: 11,
    fontWeight: 650
  },
  rowSummary: {
    marginTop: 6,
    color: "#5f574b",
    fontSize: 13,
    lineHeight: 1.5
  },
  rowRelation: {
    marginTop: 5,
    color: "#938674",
    fontSize: 11
  },
  childRows: {
    marginLeft: 14,
    paddingLeft: 12,
    borderLeft: "2px solid #d6cbb9"
  },
  childRow: {
    padding: "10px 2px 12px",
    borderTop: "1px dashed #ded3c2"
  },
  childMarker: {
    marginBottom: 5,
    color: "#94744b",
    fontSize: 10,
    fontWeight: 750,
    textTransform: "uppercase" as const,
    letterSpacing: 0
  },
  errorBar: {
    padding: "9px 16px",
    borderTop: "1px solid #e0b8aa",
    background: "#fff1ec",
    color: "#9b4a32",
    fontSize: 13,
    flexShrink: 0
  },
  detailPanel: {
    flexShrink: 0,
    padding: "14px 16px 16px",
    borderTop: "1px solid #d9cfbf",
    background: "#fbf8f1"
  },
  detailEyebrow: {
    color: "#8d8171",
    fontSize: 11,
    fontWeight: 750,
    textTransform: "uppercase" as const,
    letterSpacing: 0
  },
  detailTitle: {
    marginTop: 4,
    color: "#1c1914",
    fontSize: 16,
    fontWeight: 780
  },
  detailCopy: {
    margin: "7px 0 12px",
    color: "#5f574b",
    fontSize: 13,
    lineHeight: 1.5
  },
  expandNotice: {
    margin: "0 0 12px",
    padding: "9px 10px",
    border: "1px solid #d6c7ae",
    borderRadius: 7,
    background: "#fffaf0",
    color: "#6d5e49",
    fontSize: 12,
    lineHeight: 1.45
  },
  expandNoticeError: {
    borderColor: "#e0b8aa",
    background: "#fff1ec",
    color: "#9b4a32"
  },
  detailActions: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8
  },
  primaryBtn: {
    border: "1px solid #26392f",
    borderRadius: 7,
    background: "#26392f",
    color: "#fffaf0",
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 720,
    cursor: "pointer"
  },
  secondaryBtn: {
    border: "1px solid #d2c5b1",
    borderRadius: 7,
    background: "#fffaf0",
    color: "#3a352d",
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 650,
    cursor: "pointer"
  },
  retryBtn: {
    borderColor: "#b8872d",
    background: "#fff8e8",
    color: "#6f4c13"
  },
  depthNotice: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #d6c7ae",
    borderRadius: 7,
    background: "#fffaf0",
    color: "#6d5e49",
    fontSize: 12,
    lineHeight: 1.4
  },
  knownBtn: {
    borderColor: "#9eb5a4",
    background: "#edf4ed",
    color: "#3f6d52"
  },
  disabledControl: {
    opacity: 0.58,
    cursor: "not-allowed"
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    background: "rgba(247, 243, 234, 0.76)",
    backdropFilter: "blur(2px)"
  },
  loadingCard: {
    width: "100%",
    maxWidth: 330,
    display: "flex",
    alignItems: "center",
    gap: 13,
    padding: "14px 15px",
    border: "1px solid #cdbf9e",
    borderRadius: 8,
    background: "#fffaf0",
    boxShadow: "0 16px 38px rgba(45, 36, 25, 0.18)"
  },
  loadingSpinner: {
    width: 26,
    height: 26,
    flexShrink: 0,
    borderRadius: "50%",
    border: "3px solid #e0d5c4",
    borderTopColor: "#26392f",
    animation: "linklog-spin 0.85s linear infinite"
  },
  loadingTitle: {
    color: "#1e1b16",
    fontSize: 14,
    fontWeight: 780
  },
  loadingCopy: {
    marginTop: 4,
    color: "#6d6355",
    fontSize: 12,
    lineHeight: 1.4
  }
}
