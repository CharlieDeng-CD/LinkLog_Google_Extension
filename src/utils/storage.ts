import type { GraphData, LocalData } from "~types"

const STORAGE_KEYS = {
  API_KEY: "apiKey",
  API_BASE_URL: "apiBaseUrl",
  KNOWN_NODES: "knownNodes",
  EXPLORED_GRAPHS: "exploredGraphs",
  DAILY_STATS: "dailyStats",
  STREAK: "streak",
  LAST_ACTIVE: "lastActiveDate",
  STREAM_BUFFER: "streamBuffer"
} as const

export async function getApiKey(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.API_KEY)
  return result[STORAGE_KEYS.API_KEY] || ""
}

export async function setApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.API_KEY]: key })
}

export async function getApiBaseUrl(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.API_BASE_URL)
  return result[STORAGE_KEYS.API_BASE_URL] || "https://api.deepseek.com"
}

export async function setApiBaseUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.API_BASE_URL]: url })
}

export async function getKnownNodes(): Promise<string[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.KNOWN_NODES)
  return result[STORAGE_KEYS.KNOWN_NODES] || []
}

export async function addKnownNode(label: string): Promise<void> {
  const known = await getKnownNodes()
  if (!known.includes(label)) {
    known.push(label)
    await chrome.storage.local.set({ [STORAGE_KEYS.KNOWN_NODES]: known })
  }
}

export async function removeKnownNode(label: string): Promise<void> {
  const known = await getKnownNodes()
  const filtered = known.filter((n) => n !== label)
  await chrome.storage.local.set({ [STORAGE_KEYS.KNOWN_NODES]: filtered })
}

export async function saveGraph(key: string, graph: GraphData): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.EXPLORED_GRAPHS)
  const graphs = result[STORAGE_KEYS.EXPLORED_GRAPHS] || {}
  graphs[key] = graph
  await chrome.storage.local.set({ [STORAGE_KEYS.EXPLORED_GRAPHS]: graphs })
}

export async function getGraph(key: string): Promise<GraphData | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.EXPLORED_GRAPHS)
  const graphs = result[STORAGE_KEYS.EXPLORED_GRAPHS] || {}
  return graphs[key] || null
}

export async function updateDailyStats(
  explored: number,
  mastered: number
): Promise<void> {
  const today = new Date().toISOString().split("T")[0]
  const result = await chrome.storage.local.get(STORAGE_KEYS.DAILY_STATS)
  const stats = result[STORAGE_KEYS.DAILY_STATS] || {}
  const existing = stats[today] || { explored: 0, mastered: 0 }
  stats[today] = {
    explored: existing.explored + explored,
    mastered: existing.mastered + mastered
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.DAILY_STATS]: stats })
  await updateStreak()
}

async function updateStreak(): Promise<void> {
  const today = new Date().toISOString().split("T")[0]
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.STREAK,
    STORAGE_KEYS.LAST_ACTIVE
  ])
  const lastActive = result[STORAGE_KEYS.LAST_ACTIVE] || ""
  let streak = result[STORAGE_KEYS.STREAK] || 0

  const yesterday = new Date(Date.now() - 86400000)
    .toISOString()
    .split("T")[0]

  if (lastActive === today) return
  if (lastActive === yesterday) {
    streak++
  } else {
    streak = 1
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.STREAK]: streak,
    [STORAGE_KEYS.LAST_ACTIVE]: today
  })
}

export async function saveStreamBuffer(data: {
  status: "streaming" | "done" | "error"
  generationId?: number
  nodes: Array<{
    id: string
    label: string
    summary: string
    status: string
    expanded: boolean
    depth: number
  }>
  edges: Array<{ from: string; to: string; relation: string }>
  error?: string
}): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.STREAM_BUFFER]: data })
}

export async function clearStreamBuffer(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.STREAM_BUFFER)
}
