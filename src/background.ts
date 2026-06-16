import OpenAI from "openai"
import {
  getApiKey,
  getApiBaseUrl,
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
import type {
  GraphNode,
  GraphEdge,
  GenerateGraphRequest,
  ExpandNodeRequest,
  RefreshNodeRequest
} from "~types"

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {})
  }
})

let openai: OpenAI | null = null

async function getClient(): Promise<OpenAI> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new Error("API Key not configured. Please set it in Settings.")
  if (!openai) {
    const baseURL = await getApiBaseUrl()
    openai = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true })
  }
  return openai
}

function resetClient() {
  openai = null
}

async function getModel(): Promise<string> {
  const baseURL = await getApiBaseUrl()
  if (baseURL.includes("deepseek")) return "deepseek-chat"
  return "gpt-4o-mini"
}

async function streamAndParse(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  generationId: number
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const client = await getClient()
  const model = await getModel()

  const stream = await client.chat.completions.create({
    model,
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 2000
  })

  let accumulated = ""
  let lastValidNodes: GraphNode[] = []
  let lastValidEdges: GraphEdge[] = []

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || ""
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
      await saveStreamBuffer({
        status: "streaming",
        nodes: lastValidNodes,
        edges: lastValidEdges,
        generationId
      })
    } catch {
      // not yet valid JSON, keep streaming
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

  const messages = buildGenerateMessages(
    req.selectedText,
    req.pageContent,
    req.pageTitle
  )

  const rootNode: GraphNode = {
    id: "root",
    label: req.selectedText,
    summary: "The concept you selected from the page.",
    status: "learning",
    expanded: true,
    depth: 0
  }

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

    const graphKey = `${req.pageUrl}::${req.selectedText}`
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

    return { success: true }
  } catch (err: any) {
    await saveStreamBuffer({
      status: "error",
      nodes: [rootNode],
      edges: [],
      error: err.message,
      generationId
    })
    return { success: false, error: err.message }
  }
}

async function handleExpand(req: ExpandNodeRequest) {
  const messages = buildExpandMessages(req.nodeLabel, req.parentConcept)

  try {
    const { nodes: rawNodes, edges: rawEdges } = await streamAndParse(messages)
    const knownNodes = await getKnownNodes()

    const parentNodeId = `node_${req.nodeLabel}`

    const childNodes: GraphNode[] = rawNodes.map((n) => ({
      ...n,
      id: `child_${req.nodeLabel}_${n.id}`,
      status: knownNodes.includes(n.label) ? ("mastered" as const) : ("unexplored" as const),
      expanded: false,
      depth: 2
    }))

    const childEdges: GraphEdge[] = rawEdges.map((e) => ({
      from: e.from === "parent" ? parentNodeId : e.from,
      to: e.to.startsWith("n") ? `child_${req.nodeLabel}_${e.to}` : e.to,
      relation: e.relation
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
  const messages = buildRefreshMessages(req.nodeLabel, req.parentConcept)

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
