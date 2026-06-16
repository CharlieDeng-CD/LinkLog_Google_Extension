import { useState } from "react"
import type { GraphNode, GraphEdge } from "~types"

interface GraphViewProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  loading: boolean
  error: string | null
  onExpandNode: (label: string) => void
  onRefreshNode: (label: string) => void
  onMarkKnown: (label: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  unexplored: "#3f3f46",
  learning: "#f59e0b",
  mastered: "#10b981"
}

const STATUS_LABELS: Record<string, string> = {
  unexplored: "未探索",
  learning: "学习中",
  mastered: "已掌握"
}

export default function GraphView({
  nodes,
  edges,
  loading,
  error,
  onExpandNode,
  onRefreshNode,
  onMarkKnown
}: GraphViewProps) {
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const rootNode = nodes.find((n) => n.depth === 0)
  const childNodes = nodes.filter((n) => n.depth > 0)

  return (
    <div style={styles.container}>
      {loading && (
        <div style={styles.loadingBar}>Generating knowledge graph...</div>
      )}

      <div style={styles.list}>
        {rootNode && (
          <div
            style={{
              ...styles.card,
              borderColor: "#6366f1",
              background: "rgba(99,102,241,0.08)"
            }}
            onClick={() => setSelected(rootNode)}
          >
            <div style={styles.cardHeader}>
              <span style={{ ...styles.dot, background: STATUS_COLORS[rootNode.status] }} />
              <span style={styles.cardLabel}>{rootNode.label}</span>
              <span style={styles.badge}>ROOT</span>
            </div>
            {rootNode.summary && <div style={styles.cardSummary}>{rootNode.summary}</div>}
          </div>
        )}

        {childNodes.length > 0 && (
          <div style={styles.divider}>
            <div style={styles.dividerLine} />
            <span style={styles.dividerText}>prerequisites</span>
            <div style={styles.dividerLine} />
          </div>
        )}

        {childNodes.map((node) => (
          <div
            key={node.id}
            style={{
              ...styles.card,
              borderColor: selected?.id === node.id ? "#a78bfa" : "#27272a",
              background: selected?.id === node.id ? "rgba(167,139,250,0.06)" : "#18181b"
            }}
            onClick={() => setSelected(node)}
          >
            <div style={styles.cardHeader}>
              <span style={{ ...styles.dot, background: STATUS_COLORS[node.status] }} />
              <span style={styles.cardLabel}>{node.label}</span>
              <span style={styles.statusText}>{STATUS_LABELS[node.status]}</span>
            </div>
            {node.summary && <div style={styles.cardSummary}>{node.summary}</div>}
            {edges.filter((e) => e.to === node.id).length > 0 && (
              <div style={styles.relation}>
                {edges
                  .filter((e) => e.to === node.id)
                  .map((e) => e.relation)
                  .join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <div style={styles.errorBar}>{error}</div>}

      {selected && (
        <div style={styles.detail}>
          <div style={styles.detailTitle}>{selected.label}</div>
          {selected.summary && <div style={styles.detailSummary}>{selected.summary}</div>}
          <div style={styles.detailActions}>
            {selected.depth > 0 && !selected.expanded && (
              <button
                style={styles.primaryBtn}
                onClick={() => onExpandNode(selected.label)}
                disabled={loading}
              >
                Expand
              </button>
            )}
            <button
              style={styles.btn}
              onClick={() => onRefreshNode(selected.label)}
              disabled={loading}
            >
              Refresh
            </button>
            <button
              style={{
                ...styles.btn,
                background: selected.status === "mastered" ? "#065f46" : "#27272a",
                borderColor: selected.status === "mastered" ? "#10b981" : "#3f3f46"
              }}
              onClick={() => onMarkKnown(selected.label)}
            >
              {selected.status === "mastered" ? "Known" : "Mark as Known"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  },
  loadingBar: {
    padding: "8px 16px",
    background: "rgba(99,102,241,0.1)",
    fontSize: 12,
    color: "#a1a1aa",
    flexShrink: 0
  },
  list: {
    flex: 1,
    overflow: "auto",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "4px 0"
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: "#27272a"
  },
  dividerText: {
    fontSize: 11,
    color: "#52525b",
    textTransform: "uppercase" as const,
    letterSpacing: 1
  },
  card: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #27272a",
    background: "#18181b",
    cursor: "pointer",
    transition: "border-color 0.15s"
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: "#e4e4e7",
    flex: 1
  },
  badge: {
    fontSize: 10,
    fontWeight: 700,
    color: "#6366f1",
    background: "rgba(99,102,241,0.15)",
    padding: "2px 6px",
    borderRadius: 4
  },
  statusText: {
    fontSize: 11,
    color: "#71717a"
  },
  cardSummary: {
    fontSize: 12,
    color: "#a1a1aa",
    marginTop: 6,
    lineHeight: 1.5
  },
  relation: {
    fontSize: 11,
    color: "#52525b",
    marginTop: 4,
    fontStyle: "italic"
  },
  errorBar: {
    padding: "8px 16px",
    background: "#1c1917",
    borderTop: "1px solid #78350f",
    color: "#fbbf24",
    fontSize: 13,
    flexShrink: 0
  },
  detail: {
    padding: "12px 16px",
    borderTop: "1px solid #27272a",
    background: "#18181b",
    flexShrink: 0
  },
  detailTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "#e4e4e7",
    marginBottom: 4
  },
  detailSummary: {
    fontSize: 13,
    color: "#a1a1aa",
    marginBottom: 10,
    lineHeight: 1.5
  },
  detailActions: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap" as const
  },
  primaryBtn: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    background: "#6366f1",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer"
  },
  btn: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #3f3f46",
    background: "#27272a",
    color: "#d4d4d8",
    fontSize: 12,
    cursor: "pointer"
  }
}
