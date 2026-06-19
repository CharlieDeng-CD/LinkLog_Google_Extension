export interface GraphNode {
  id: string
  label: string
  summary: string
  status: "unexplored" | "learning" | "mastered"
  expanded: boolean
  expandState?: "found" | "none" | "failed"
  expandMessage?: string
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

export interface DailyStats {
  explored: number
  mastered: number
}

export interface LearningSummary {
  knownCount: number
  exploredCount: number
  streak: number
  today: DailyStats
  recentGraphs: GraphData[]
}

export type UiLanguage = "en" | "zh"

export interface LocalData {
  apiKey: string
  knownNodes: string[]
  exploredGraphs: Record<string, GraphData>
  dailyStats: Record<string, DailyStats>
  streak: number
  lastActiveDate: string
}

export type MessageAction =
  | "generate-graph"
  | "expand-node"
  | "refresh-node"
  | "set-api-key"
  | "get-api-key"
  | "add-known"
  | "remove-known"
  | "get-learning-summary"

export interface GenerateGraphRequest {
  action: "generate-graph"
  selectedText: string
  pageContent: string
  pageTitle: string
  pageUrl: string
  language?: UiLanguage
}

export interface ExpandNodeRequest {
  action: "expand-node"
  nodeId: string
  nodeLabel: string
  parentConcept: string
  pageContent: string
  language?: UiLanguage
}

export interface RefreshNodeRequest {
  action: "refresh-node"
  nodeId: string
  nodeLabel: string
  parentConcept: string
  pageContent: string
  language?: UiLanguage
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
