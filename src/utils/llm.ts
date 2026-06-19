import type { GraphNode, GraphEdge, UiLanguage } from "~types"

function getLanguageInstruction(language: UiLanguage = "en") {
  if (language === "zh") {
    return `Output language: Simplified Chinese.
Use Chinese for explanations, summaries, relation labels, and all user-facing text.
Keep established professional terms in English when they are commonly used that way, such as API, LLM, prompt, agent, IDE, RAG, vector database, OpenAI, DeepSeek, Claude, Cursor, Mermaid.
Node labels may be Chinese, English, or mixed Chinese-English depending on what feels natural, but do not output an all-English graph unless the selected concept itself is an English proper noun that should remain English.`
  }

  return "Output language: English."
}

const SYSTEM_PROMPT = `You are a knowledge graph generator. Given a concept that a user selected while reading a webpage, generate a prerequisite knowledge graph.

Rules:
1. Generate exactly 3-5 prerequisite concept nodes that the reader needs to understand BEFORE understanding the selected concept.
2. Each node should be a single concept (not a sentence or description).
3. Prioritize high-leverage "unknown unknowns": ideas that are easy to skip, rarely named explicitly in the page, but unlock the selected concept.
4. Avoid generic dictionary definitions, obvious synonyms, broad school subjects, and duplicate concepts.
5. Keep summaries to one sharp sentence that explains why this prerequisite matters.
6. Each node has a depth of 1 (direct prerequisites).

You MUST respond with valid JSON only, no markdown, no explanation. Use this exact format:
{"nodes":[{"id":"n1","label":"Concept Name","summary":"One sentence explanation."}],"edges":[{"from":"root","to":"n1","relation":"requires"}]}`

const EXPAND_PROMPT = `You are a knowledge graph generator. The user wants to explore deeper into the concept "{nodeLabel}", which is a prerequisite of "{parentConcept}".

Generate 2-3 sub-prerequisite concepts needed to understand "{nodeLabel}".
Prioritize the hidden assumptions behind "{nodeLabel}", not obvious definitions.
Keep summaries to one sharp sentence that explains why the concept matters.

You MUST respond with valid JSON only, no markdown, no explanation. Use this exact format:
{"nodes":[{"id":"n1","label":"Concept Name","summary":"One sentence explanation."}],"edges":[{"from":"parent","to":"n1","relation":"requires"}]}`

const REFRESH_PROMPT = `You are a knowledge graph generator. The user wants alternative prerequisite concepts for "{parentConcept}" to replace the node "{nodeLabel}".

Generate 1 new prerequisite concept (different from "{nodeLabel}") that would help understand "{parentConcept}".
Prioritize a non-obvious but useful prerequisite, not a synonym or a broader category.
Keep the summary to one sharp sentence that explains why the concept matters.

You MUST respond with valid JSON only, no markdown, no explanation. Use this exact format:
{"nodes":[{"id":"n1","label":"Concept Name","summary":"One sentence explanation."}],"edges":[{"from":"parent","to":"n1","relation":"requires"}]}`

export function buildGenerateMessages(
  selectedText: string,
  pageContent: string,
  pageTitle: string,
  language: UiLanguage = "en"
) {
  const truncated = pageContent.slice(0, 6000)
  return [
    {
      role: "system" as const,
      content: `${SYSTEM_PROMPT}\n\n${getLanguageInstruction(language)}`
    },
    {
      role: "user" as const,
      content:
        language === "zh"
          ? `页面标题：「${pageTitle}」\n\n页面内容：\n${truncated}\n\n选中的概念：「${selectedText}」\n\n请生成理解这个概念所需的前置知识图谱。`
          : `Page title: "${pageTitle}"\n\nPage content:\n${truncated}\n\nSelected concept: "${selectedText}"\n\nGenerate the prerequisite knowledge graph.`
    }
  ]
}

export function buildExpandMessages(
  nodeLabel: string,
  parentConcept: string,
  language: UiLanguage = "en"
) {
  return [
    {
      role: "system" as const,
      content: `${EXPAND_PROMPT.replace("{nodeLabel}", nodeLabel).replace(
        "{parentConcept}",
        parentConcept
      )}\n\n${getLanguageInstruction(language)}`
    },
    {
      role: "user" as const,
      content:
        language === "zh"
          ? `请展开「${nodeLabel}」，显示理解它之前需要知道的下一层前置知识。`
          : `Expand the concept "${nodeLabel}" and show its sub-prerequisites.`
    }
  ]
}

export function buildRefreshMessages(
  nodeLabel: string,
  parentConcept: string,
  language: UiLanguage = "en"
) {
  return [
    {
      role: "system" as const,
      content: `${REFRESH_PROMPT.replace("{nodeLabel}", nodeLabel).replace(
        "{parentConcept}",
        parentConcept
      )}\n\n${getLanguageInstruction(language)}`
    },
    {
      role: "user" as const,
      content:
        language === "zh"
          ? `请给出一个新的前置知识点，用来替换「${nodeLabel}」，帮助理解「${parentConcept}」。`
          : `Give me an alternative prerequisite to replace "${nodeLabel}" for understanding "${parentConcept}".`
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
