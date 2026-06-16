import type { GraphNode, GraphEdge } from "~types"

const SYSTEM_PROMPT = `You are a knowledge graph generator. Given a concept that a user selected while reading a webpage, generate a prerequisite knowledge graph.

Rules:
1. Generate exactly 3-5 prerequisite concept nodes that the reader needs to understand BEFORE understanding the selected concept.
2. Each node should be a single concept (not a sentence or description).
3. Focus on concepts the reader might NOT already know ("unknown unknowns").
4. Keep summaries to one sentence, in the same language as the user's page content.
5. Each node has a depth of 1 (direct prerequisites).

You MUST respond with valid JSON only, no markdown, no explanation. Use this exact format:
{"nodes":[{"id":"n1","label":"Concept Name","summary":"One sentence explanation."}],"edges":[{"from":"root","to":"n1","relation":"requires"}]}`

const EXPAND_PROMPT = `You are a knowledge graph generator. The user wants to explore deeper into the concept "{nodeLabel}", which is a prerequisite of "{parentConcept}".

Generate 2-3 sub-prerequisite concepts needed to understand "{nodeLabel}".
Keep summaries to one sentence, in the same language as the original page content.

You MUST respond with valid JSON only, no markdown, no explanation. Use this exact format:
{"nodes":[{"id":"n1","label":"Concept Name","summary":"One sentence explanation."}],"edges":[{"from":"parent","to":"n1","relation":"requires"}]}`

const REFRESH_PROMPT = `You are a knowledge graph generator. The user wants alternative prerequisite concepts for "{parentConcept}" to replace the node "{nodeLabel}".

Generate 1 new prerequisite concept (different from "{nodeLabel}") that would help understand "{parentConcept}".
Keep the summary to one sentence, in the same language as the original page content.

You MUST respond with valid JSON only, no markdown, no explanation. Use this exact format:
{"nodes":[{"id":"n1","label":"Concept Name","summary":"One sentence explanation."}],"edges":[{"from":"parent","to":"n1","relation":"requires"}]}`

export function buildGenerateMessages(
  selectedText: string,
  pageContent: string,
  pageTitle: string
) {
  const truncated = pageContent.slice(0, 6000)
  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: `Page title: "${pageTitle}"\n\nPage content:\n${truncated}\n\nSelected concept: "${selectedText}"\n\nGenerate the prerequisite knowledge graph.`
    }
  ]
}

export function buildExpandMessages(
  nodeLabel: string,
  parentConcept: string
) {
  return [
    {
      role: "system" as const,
      content: EXPAND_PROMPT.replace("{nodeLabel}", nodeLabel).replace(
        "{parentConcept}",
        parentConcept
      )
    },
    {
      role: "user" as const,
      content: `Expand the concept "${nodeLabel}" and show its sub-prerequisites.`
    }
  ]
}

export function buildRefreshMessages(
  nodeLabel: string,
  parentConcept: string
) {
  return [
    {
      role: "system" as const,
      content: REFRESH_PROMPT.replace("{nodeLabel}", nodeLabel).replace(
        "{parentConcept}",
        parentConcept
      )
    },
    {
      role: "user" as const,
      content: `Give me an alternative prerequisite to replace "${nodeLabel}" for understanding "${parentConcept}".`
    }
  ]
}

export function parseGraphResponse(text: string): {
  nodes: Omit<GraphNode, "status" | "expanded" | "depth">[]
  edges: GraphEdge[]
} {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("No JSON found in response")

  const parsed = JSON.parse(jsonMatch[0])
  const nodes = (parsed.nodes || []).map((n: any) => ({
    id: n.id || `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: n.label || "Unknown",
    summary: n.summary || ""
  }))
  const edges = (parsed.edges || []).map((e: any) => ({
    from: e.from || "root",
    to: e.to || "",
    relation: e.relation || "related"
  }))
  return { nodes, edges }
}
