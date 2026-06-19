const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
const MAX_RECENT_EVENTS = 100

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function getDayKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function safeString(value, maxLength = 80) {
  if (typeof value !== "string") return ""
  return value.slice(0, maxLength)
}

function incrementBucket(target, key, amount = 1) {
  const safeKey = safeString(key || "unknown", 80) || "unknown"
  target[safeKey] = (target[safeKey] || 0) + amount
}

function sanitizeEvent(payload) {
  const event = safeString(payload.event, 60)
  if (!event) return null

  return {
    event,
    language: safeString(payload.language, 12) || "unknown",
    extensionVersion: safeString(payload.extensionVersion, 24) || "unknown",
    installId: safeString(payload.installId, 80),
    conceptHash: safeString(payload.conceptHash, 80),
    conceptLength: Math.max(0, Math.min(Number(payload.conceptLength || 0), 200)),
    nodeCount: Math.max(0, Math.min(Number(payload.nodeCount || 0), 100)),
    childCount: Math.max(0, Math.min(Number(payload.childCount || 0), 50)),
    status: safeString(payload.status, 24),
    errorCode: safeString(payload.errorCode, 80),
    pageHost: safeString(payload.pageHost, 120),
    timestamp: Date.now()
  }
}

async function recordAnalytics(env, event) {
  if (!env.LINKLOG_ANALYTICS_KV || !event) return

  const day = getDayKey(event.timestamp)
  const dayKey = `analytics:day:${day}`
  const recentKey = "analytics:recent"
  const existingDay = await env.LINKLOG_ANALYTICS_KV.get(dayKey, "json")
  const aggregate =
    existingDay || {
      date: day,
      total: 0,
      events: {},
      languages: {},
      versions: {},
      statuses: {},
      errors: {},
      hosts: {}
    }

  aggregate.total += 1
  incrementBucket(aggregate.events, event.event)
  incrementBucket(aggregate.languages, event.language)
  incrementBucket(aggregate.versions, event.extensionVersion)
  if (event.status) incrementBucket(aggregate.statuses, event.status)
  if (event.errorCode) incrementBucket(aggregate.errors, event.errorCode)
  if (event.pageHost) incrementBucket(aggregate.hosts, event.pageHost)

  const recent = (await env.LINKLOG_ANALYTICS_KV.get(recentKey, "json")) || []
  recent.unshift(event)
  await Promise.all([
    env.LINKLOG_ANALYTICS_KV.put(dayKey, JSON.stringify(aggregate), {
      expirationTtl: 60 * 60 * 24 * 120
    }),
    env.LINKLOG_ANALYTICS_KV.put(
      recentKey,
      JSON.stringify(recent.slice(0, MAX_RECENT_EVENTS)),
      { expirationTtl: 60 * 60 * 24 * 30 }
    )
  ])
}

async function handleAnalyticsPost(request, env, ctx) {
  let payload
  try {
    payload = await request.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400)
  }

  const event = sanitizeEvent(payload)
  if (!event) return jsonResponse({ error: "Missing analytics event." }, 400)

  const write = recordAnalytics(env, event)
  if (ctx?.waitUntil) ctx.waitUntil(write)
  else await write

  return jsonResponse({ ok: true })
}

async function handleAnalyticsSummary(request, env) {
  if (!env.LINKLOG_ANALYTICS_KV) {
    return jsonResponse({ error: "Analytics KV is not configured." }, 501)
  }

  if (!env.LINKLOG_ANALYTICS_ADMIN_TOKEN) {
    return jsonResponse({ error: "Analytics admin token is not configured." }, 501)
  }

  const expected = `Bearer ${env.LINKLOG_ANALYTICS_ADMIN_TOKEN}`
  if (request.headers.get("Authorization") !== expected) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const url = new URL(request.url)
  const days = Math.max(1, Math.min(Number(url.searchParams.get("days") || "7"), 30))
  const includeRecent = url.searchParams.get("recent") === "1"
  const daily = []

  for (let offset = 0; offset < days; offset++) {
    const timestamp = Date.now() - offset * 86400000
    const day = getDayKey(timestamp)
    const aggregate = await env.LINKLOG_ANALYTICS_KV.get(
      `analytics:day:${day}`,
      "json"
    )
    daily.push(
      aggregate || {
        date: day,
        total: 0,
        events: {},
        languages: {},
        versions: {},
        statuses: {},
        errors: {},
        hosts: {}
      }
    )
  }

  const body = { daily }
  if (includeRecent) {
    body.recent = (await env.LINKLOG_ANALYTICS_KV.get("analytics:recent", "json")) || []
  }
  return jsonResponse(body)
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
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const url = new URL(request.url)

    if (url.pathname === "/analytics" && request.method === "POST") {
      return handleAnalyticsPost(request, env, ctx)
    }

    if (url.pathname === "/analytics/summary" && request.method === "GET") {
      return handleAnalyticsSummary(request, env)
    }

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
