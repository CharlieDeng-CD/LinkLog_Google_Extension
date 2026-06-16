export interface GraphNode {
  id: string
  label: string
  summary: string
  status: "unexplored" | "learning" | "mastered"
  expanded: boolean
  depth: number
}

export interface GraphEdge {
  from: string
  to: string
  relation: string
}

export interface GraphData {
  concept: string
  sourceUrl: string
  sourceTitle: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  createdAt: number
}

export interface LocalData {
  apiKey: string
  knownNodes: string[]
  exploredGraphs: Record<string, GraphData>
  dailyStats: Record<string, { explored: number; mastered: number }>
  streak: number
  lastActiveDate: string
}

export type MessageAction =
  | "generate-graph"
  | "expand-node"
  | "refresh-node"
  | "set-api-key"
  | "get-api-key"

export interface GenerateGraphRequest {
  action: "generate-graph"
  selectedText: string
  pageContent: string
  pageTitle: string
  pageUrl: string
}

export interface ExpandNodeRequest {
  action: "expand-node"
  nodeLabel: string
  parentConcept: string
  pageContent: string
}

export interface RefreshNodeRequest {
  action: "refresh-node"
  nodeLabel: string
  parentConcept: string
  pageContent: string
}

export interface SetApiKeyRequest {
  action: "set-api-key"
  apiKey: string
}

export interface GetApiKeyRequest {
  action: "get-api-key"
}

export type MessageRequest =
  | GenerateGraphRequest
  | ExpandNodeRequest
  | RefreshNodeRequest
  | SetApiKeyRequest
  | GetApiKeyRequest

export interface StreamUpdate {
  status: "streaming" | "done" | "error"
  nodes: GraphNode[]
  edges: GraphEdge[]
  error?: string
}
