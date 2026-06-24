import {
  addKnownNode,
  getApiKey,
  getApiBaseUrl,
  getGraph,
  getLearningSummary,
  getKnownNodes,
  removeKnownNode,
  saveGraph,
  saveStreamBuffer,
  clearStreamBuffer,
  updateDailyStats
} from "~utils/storage"
import {
  buildGenerateMessages,
  buildExpandMessages,
  buildRefreshMessages,
  parseGraphResponse
} from "~utils/llm"
import { getDefaultUiLanguage, normalizeUiLanguage } from "~utils/language"
import type {
  GraphNode,
  GraphEdge,
  GenerateGraphRequest,
  ExpandNodeRequest,
  RefreshNodeRequest,
  AnalyticsTrackRequest,
  UiLanguage
} from "~types"

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

const ANALYTICS_STORAGE_KEY = "analyticsInstallId"
const ANALYTICS_ENDPOINT_PATH = "/analytics"
const LLM_CONNECT_TIMEOUT_MS = 25000

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    ensureContentScript(tab)
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {})
  }
})

let contextMenuSetupPromise: Promise<void> = Promise.resolve()

async function setupContextMenu() {
  contextMenuSetupPromise = contextMenuSetupPromise.then(async () => {
    const { uiLanguage } = await chrome.storage.local.get("uiLanguage")
    const language = normalizeUiLanguage(uiLanguage) || getDefaultUiLanguage()
    const title =
      language === "zh" ? "用 LinkLog 探索选中内容" : "Explore with LinkLog"

    await new Promise<void>((resolve) => {
      chrome.contextMenus.update(
        "linklog-explore-selection",
        { title, contexts: ["selection"] },
        () => {
          if (!chrome.runtime.lastError) {
            resolve()
            return
          }

          chrome.contextMenus.create(
            {
              id: "linklog-explore-selection",
              title,
              contexts: ["selection"]
            },
            () => {
              // Duplicate id can happen during rapid service-worker restarts.
              void chrome.runtime.lastError
              resolve()
            }
          )
        }
      )
    })
  })

  return contextMenuSetupPromise
}

async function openLinkLogSurface(tabId?: number) {
  if (!tabId) return
  await chrome.sidePanel.open({ tabId }).catch(() => {})
}

function extractVisiblePageText() {
  const article = document.querySelector("article")
  if (article?.textContent?.trim()) return article.textContent.trim().slice(0, 10000)

  const main = document.querySelector("main, [role='main']")
  if (main?.textContent?.trim()) return main.textContent.trim().slice(0, 10000)

  const body = document.body
  if (!body) return document.title

  const clone = body.cloneNode(true) as HTMLElement
  clone
    .querySelectorAll("script,style,noscript,iframe,nav,header,footer")
    .forEach((el) => el.remove())
  return clone.textContent?.trim().slice(0, 10000) || document.title
}

async function getPageContentFromTab(tabId: number) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractVisiblePageText
    })
    return String(result?.result || "")
  } catch {
    return ""
  }
}

function isHostedLinkLogBackend(baseUrl: string) {
  return /^https:\/\/linklog-api\./.test(baseUrl)
}

function getErrorCode(message = "") {
  if (!message) return "unknown"
  if (message.includes("429")) return "rate_limit"
  if (message.includes("401") || message.includes("403")) return "auth"
  if (message.includes("LLM request failed")) return "llm_request_failed"
  if (message.includes("JSON")) return "parse_error"
  if (message.includes("stream")) return "stream_error"
  return message.slice(0, 80)
}

async function getAnalyticsInstallId() {
  const existing = await chrome.storage.local.get(ANALYTICS_STORAGE_KEY)
  if (existing[ANALYTICS_STORAGE_KEY]) return existing[ANALYTICS_STORAGE_KEY]

  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  await chrome.storage.local.set({ [ANALYTICS_STORAGE_KEY]: id })
  return id
}

async function sha256Hex(value: string) {
  if (!value) return ""
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function getPageHost(pageUrl?: string) {
  try {
    if (!pageUrl) return ""
    return new URL(pageUrl).hostname
  } catch {
    return ""
  }
}

async function trackAnalytics(input: Omit<AnalyticsTrackRequest, "action">) {
  try {
    const baseUrl = await getApiBaseUrl()
    if (!isHostedLinkLogBackend(baseUrl)) return

    const installId = await getAnalyticsInstallId()
    const concept = input.concept || ""
    await fetch(`${baseUrl}${ANALYTICS_ENDPOINT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: input.event,
        language: input.language || "en",
        extensionVersion: chrome.runtime.getManifest().version,
        installId,
        conceptHash: await sha256Hex(concept.trim().toLowerCase()),
        conceptLength: concept.length,
        nodeCount: input.nodeCount || 0,
        childCount: input.childCount || 0,
        status: input.status || "",
        errorCode: input.errorCode || "",
        pageHost: getPageHost(input.pageUrl)
      })
    }).catch(() => {})
  } catch {
    // Analytics should never block LinkLog.
  }
}

async function startSelectionGeneration(data: {
  selectedText: string
  pageContent: string
  pageTitle: string
  pageUrl: string
  generationId: number
  language?: UiLanguage
}) {
  await chrome.storage.local.set({ _pendingGeneration: data })
  trackAnalytics({
    event: "selection_explore_clicked",
    language: data.language || "en",
    concept: data.selectedText,
    pageUrl: data.pageUrl
  })

  const generationRequest = {
    action: "generate-graph",
    selectedText: data.selectedText,
    pageContent: data.pageContent,
    pageTitle: data.pageTitle,
    pageUrl: data.pageUrl,
    language: data.language || "en"
  } as GenerateGraphRequest

  handleGenerate(generationRequest, data.generationId)
}

function isInjectableUrl(url?: string) {
  return Boolean(url && /^https?:\/\//.test(url))
}

function getContentScriptFiles() {
  return (
    chrome.runtime
      .getManifest()
      .content_scripts?.flatMap((script) => script.js || []) || []
  )
}

async function isContentScriptReady(tabId: number) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "linklog-content-ping"
    })
    return Boolean(response?.ready)
  } catch {
    return false
  }
}

async function ensureContentScript(tab: chrome.tabs.Tab) {
  if (!tab.id || !isInjectableUrl(tab.url)) return

  const ready = await isContentScriptReady(tab.id)
  if (ready) return

  const files = getContentScriptFiles()
  if (!files.length) return

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files
    })
  } catch {
    // Some pages, such as browser-owned pages, reject script injection.
  }
}

async function ensureContentScriptsInOpenTabs() {
  const tabs = await chrome.tabs.query({})
  await Promise.all(tabs.map((tab) => ensureContentScript(tab)))
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu()
  setTimeout(() => {
    ensureContentScriptsInOpenTabs()
  }, 500)
})

chrome.runtime.onStartup.addListener(() => {
  setupContextMenu()
  setTimeout(() => {
    ensureContentScriptsInOpenTabs()
  }, 500)
})

setupContextMenu()

chrome.storage.onChanged.addListener((changes) => {
  if (changes.uiLanguage) setupContextMenu()
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "linklog-explore-selection") return
  const selectedText = info.selectionText?.trim()
  if (!selectedText || !tab?.id) return

  const generationId = Date.now()
  const pageContent = await getPageContentFromTab(tab.id)
  const { uiLanguage } = await chrome.storage.local.get("uiLanguage")
  const language = normalizeUiLanguage(uiLanguage) || getDefaultUiLanguage()

  await startSelectionGeneration({
    selectedText,
    pageContent,
    pageTitle: tab.title || "",
    pageUrl: tab.url || "",
    generationId,
    language
  })

  await openLinkLogSurface(tab.id)
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    setTimeout(() => {
      ensureContentScript(tab)
    }, 300)
  }
})

function requiresApiKey(baseURL: string) {
  return /api\.(deepseek|openai)\.com/.test(baseURL)
}

async function getAuthConfig(): Promise<{ apiKey: string; baseURL: string }> {
  const apiKey = await getApiKey()
  const baseURL = (await getApiBaseUrl()).replace(/\/+$/, "")
  if (!apiKey && requiresApiKey(baseURL)) {
    throw new Error("API Key not configured. Please set it in Settings.")
  }
  return { apiKey, baseURL }
}

function resetClient() {
  // Kept for message compatibility; fetch requests read fresh settings each time.
}

async function getModel(): Promise<string> {
  const baseURL = await getApiBaseUrl()
  if (baseURL.includes("deepseek")) return "deepseek-chat"
  return "gpt-4o-mini"
}

async function fetchWithConnectTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = LLM_CONNECT_TIMEOUT_MS
) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(
        "LinkLog backend connection timed out. Please check whether this network can access the LinkLog API."
      )
    }
    if (
      err?.message?.includes("Failed to fetch") ||
      err?.message?.includes("NetworkError")
    ) {
      throw new Error(
        "Cannot reach the LinkLog backend from this network. Please try another network or contact LinkLog support."
      )
    }
    throw err
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

async function streamAndParse(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  generationId?: number
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const { apiKey, baseURL } = await getAuthConfig()
  const model = await getModel()
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetchWithConnectTimeout(`${baseURL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 2000
    })
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(
      `LLM request failed (${response.status}): ${errorText || response.statusText}`
    )
  }
  if (!response.body) throw new Error("LLM response did not include a stream.")

  let accumulated = ""
  let lastValidNodes: GraphNode[] = []
  let lastValidEdges: GraphEdge[] = []
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === "[DONE]") continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta?.content || ""
        if (!delta) continue
        accumulated += delta

        try {
          const { nodes: rawNodes, edges } = parseGraphResponse(accumulated)
          const knownNodes = await getKnownNodes()
          lastValidNodes = rawNodes.map((n) => ({
            ...n,
            status: knownNodes.includes(n.label) ? ("mastered" as const) : ("unexplored" as const),
            expanded: false,
            depth: 1
          }))
          lastValidEdges = edges
          if (generationId !== undefined) {
            await saveStreamBuffer({
              status: "streaming",
              nodes: lastValidNodes,
              edges: lastValidEdges,
              generationId
            })
          }
        } catch {
          // not yet valid JSON, keep streaming
        }
      } catch {
        // Ignore malformed stream fragments and keep reading.
      }
    }
  }

  const { nodes: rawNodes, edges: finalEdges } = parseGraphResponse(accumulated)
  const knownNodes = await getKnownNodes()
  const finalNodes: GraphNode[] = rawNodes.map((n) => ({
    ...n,
    status: knownNodes.includes(n.label) ? ("mastered" as const) : ("unexplored" as const),
    expanded: false,
    depth: 1
  }))

  return { nodes: finalNodes, edges: finalEdges }
}

chrome.runtime.onMessage.addListener(
  (message: any, sender, sendResponse) => {
    if (message.type === "open-side-panel") {
      const tabId = message.tabId || sender.tab?.id
      if (tabId) {
        chrome.sidePanel
          .open({ tabId })
          .then(() => sendResponse({ success: true }))
          .catch((err: any) => sendResponse({ success: false, error: err.message }))
      } else {
        sendResponse({ success: false, error: "No tab ID" })
      }
      return true
    }

    if (message.type === "linklog-open-selection") {
      const tabId = sender.tab?.id
      const generationId = message.generationId || Date.now()
      const openPromise = openLinkLogSurface(tabId)

      startSelectionGeneration({
        selectedText: message.selectedText,
        pageContent: message.pageContent,
        pageTitle: message.pageTitle,
        pageUrl: message.pageUrl,
        generationId,
        language: message.language === "zh" ? "zh" : "en"
      })
        .then(async () => {
          await openPromise
          sendResponse({ success: true, generationId })
        })
        .catch((err: any) =>
          sendResponse({ success: false, error: err.message })
        )
      return true
    }

    if (message.type === "linklog-get-stream-buffer") {
      chrome.storage.local
        .get("streamBuffer")
        .then((result) => sendResponse({ success: true, buffer: result.streamBuffer }))
        .catch((err: any) =>
          sendResponse({ success: false, error: err.message })
        )
      return true
    }

    if (message.action === "set-api-key") {
      resetClient()
      sendResponse({ success: true })
      return false
    }

    if (message.action === "remove-known") {
      removeKnownNode(message.label)
        .then(() => sendResponse({ success: true }))
        .catch((err: any) => sendResponse({ success: false, error: err.message }))
      return true
    }

    if (message.action === "add-known") {
      addKnownNode(message.label)
        .then(async (changed) => {
          if (changed) await updateDailyStats(0, 1)
          sendResponse({ success: true, changed })
        })
        .catch((err: any) => sendResponse({ success: false, error: err.message }))
      return true
    }

    if (message.action === "analytics-track") {
      trackAnalytics(message as AnalyticsTrackRequest)
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: true }))
      return true
    }

    if (message.action === "get-learning-summary") {
      getLearningSummary()
        .then((summary) => sendResponse({ success: true, summary }))
        .catch((err: any) => sendResponse({ success: false, error: err.message }))
      return true
    }

    if (message.action === "generate-graph") {
      handleGenerate(message as GenerateGraphRequest, message.generationId || Date.now())
        .then((result) => sendResponse(result))
        .catch((err: any) => sendResponse({ success: false, error: err.message }))
      return true
    }

    if (message.action === "expand-node") {
      handleExpand(message as ExpandNodeRequest)
        .then((result) => sendResponse(result))
        .catch((err: any) => sendResponse({ success: false, error: err.message }))
      return true
    }

    if (message.action === "refresh-node") {
      handleRefresh(message as RefreshNodeRequest)
        .then((result) => sendResponse(result))
        .catch((err: any) => sendResponse({ success: false, error: err.message }))
      return true
    }

    return false
  }
)

async function handleGenerate(req: GenerateGraphRequest, generationId: number) {
  await clearStreamBuffer()

  const language = req.language || "en"
  trackAnalytics({
    event: "map_generation_started",
    language,
    concept: req.selectedText,
    pageUrl: req.pageUrl
  })

  const graphKey = `${req.pageUrl}::${language}::${req.selectedText}`
  const cachedGraph = await getGraph(graphKey)
  if (cachedGraph) {
    await saveStreamBuffer({
      status: "done",
      nodes: cachedGraph.nodes,
      edges: cachedGraph.edges,
      generationId
    })
    trackAnalytics({
      event: "map_generation_cached",
      language,
      concept: req.selectedText,
      nodeCount: cachedGraph.nodes.length,
      status: "cached",
      pageUrl: req.pageUrl
    })
    return { success: true, cached: true }
  }

  const messages = buildGenerateMessages(
    req.selectedText,
    req.pageContent,
    req.pageTitle,
    language
  )

  const rootNode: GraphNode = {
    id: "root",
    label: req.selectedText,
    summary:
      language === "zh"
        ? "你在页面中选中的概念。"
        : "The concept you selected from the page.",
    status: "learning",
    expanded: true,
    depth: 0
  }

  await saveStreamBuffer({
    status: "streaming",
    nodes: [rootNode],
    edges: [],
    generationId
  })

  try {
    const { nodes, edges } = await streamAndParse(messages, generationId)

    const seen = new Set<string>(["root"])
    const uniqueNodes = nodes.filter((n) => {
      if (seen.has(n.id) || seen.has(n.label)) return false
      seen.add(n.id)
      seen.add(n.label)
      return true
    })

    const allNodes = [rootNode, ...uniqueNodes]
    const allEdges = edges.map((e) => ({
      ...e,
      from: e.from === "root" ? "root" : e.from,
      to: e.to
    }))

    await saveGraph(graphKey, {
      concept: req.selectedText,
      sourceUrl: req.pageUrl,
      sourceTitle: req.pageTitle,
      nodes: allNodes,
      edges: allEdges,
      createdAt: Date.now()
    })

    await saveStreamBuffer({ status: "done", nodes: allNodes, edges: allEdges, generationId })
    await updateDailyStats(nodes.length, 0)
    trackAnalytics({
      event: "map_generation_succeeded",
      language,
      concept: req.selectedText,
      nodeCount: allNodes.length,
      status: "succeeded",
      pageUrl: req.pageUrl
    })

    return { success: true }
  } catch (err: any) {
    await saveStreamBuffer({
      status: "error",
      nodes: [rootNode],
      edges: [],
      error: err.message,
      generationId
    })
    trackAnalytics({
      event: "map_generation_failed",
      language,
      concept: req.selectedText,
      status: "failed",
      errorCode: getErrorCode(err.message),
      pageUrl: req.pageUrl
    })
    return { success: false, error: err.message }
  }
}

async function handleExpand(req: ExpandNodeRequest) {
  const messages = buildExpandMessages(
    req.nodeLabel,
    req.parentConcept,
    req.language || "en"
  )

  try {
    const { nodes: rawNodes, edges: rawEdges } = await streamAndParse(messages)
    const knownNodes = await getKnownNodes()

    const parentNodeId = req.nodeId

    const childNodes: GraphNode[] = rawNodes.map((n) => ({
      ...n,
      id: `child_${req.nodeLabel}_${n.id}`,
      status: knownNodes.includes(n.label) ? ("mastered" as const) : ("unexplored" as const),
      expanded: false,
      depth: 2
    }))

    const relationByTarget = new Map(
      rawEdges.map((edge) => [edge.to, edge.relation || "requires"])
    )
    const childEdges: GraphEdge[] = childNodes.map((node, index) => ({
      from: parentNodeId,
      to: node.id,
      relation: relationByTarget.get(rawNodes[index]?.id) || "requires"
    }))

    return {
      success: true,
      parentNodeId,
      children: childNodes,
      edges: childEdges
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

async function handleRefresh(req: RefreshNodeRequest) {
  const messages = buildRefreshMessages(
    req.nodeLabel,
    req.parentConcept,
    req.language || "en"
  )

  try {
    const { nodes: rawNodes } = await streamAndParse(messages)
    const knownNodes = await getKnownNodes()

    const newNode: GraphNode = {
      ...rawNodes[0],
      id: `refresh_${Date.now()}`,
      status: knownNodes.includes(rawNodes[0]?.label) ? ("mastered" as const) : ("unexplored" as const),
      expanded: false,
      depth: 1
    }

    return { success: true, node: newNode }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export {}
