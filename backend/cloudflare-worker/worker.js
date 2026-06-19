const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  })
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown"
  )
}

async function checkRateLimit(env, request) {
  if (!env.LINKLOG_RATE_LIMIT_KV) return true

  const ip = getClientIp(request)
  const key = `rl:${ip}:${Math.floor(Date.now() / 3600000)}`
  const current = Number((await env.LINKLOG_RATE_LIMIT_KV.get(key)) || "0")
  const limit = Number(env.LINKLOG_HOURLY_LIMIT || "60")

  if (current >= limit) return false
  await env.LINKLOG_RATE_LIMIT_KV.put(key, String(current + 1), {
    expirationTtl: 3700
  })
  return true
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const url = new URL(request.url)
    if (request.method !== "POST" || url.pathname !== "/chat/completions") {
      return jsonResponse({ error: "Not found" }, 404)
    }

    if (!env.DEEPSEEK_API_KEY) {
      return jsonResponse({ error: "Server is missing DEEPSEEK_API_KEY." }, 500)
    }

    if (!(await checkRateLimit(env, request))) {
      return jsonResponse({ error: "Rate limit exceeded. Please try later." }, 429)
    }

    let payload
    try {
      payload = await request.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400)
    }

    const upstreamBody = {
      model: "deepseek-chat",
      messages: payload.messages || [],
      stream: payload.stream !== false,
      temperature: payload.temperature ?? 0.7,
      max_tokens: Math.min(Number(payload.max_tokens || 2000), 3000)
    }

    const upstream = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(upstreamBody)
    })

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        ...corsHeaders,
        "Content-Type":
          upstream.headers.get("Content-Type") || "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store"
      }
    })
  }
}
