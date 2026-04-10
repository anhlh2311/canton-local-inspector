import { Router } from 'express'
import http from 'node:http'
import https from 'node:https'

const router = Router()

// NOTE: This proxy is intended for local development only (Docker / yarn server).
// It does not enforce session authentication. Do not expose to untrusted networks.

function base64urlDecode(str: string): string {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

// Build allowed targets from env vars (mirrors Vercel proxy behavior)
function getAllowedTargets(): string[] {
  const targets: string[] = []
  if (process.env.CANTON_JSON_API_URL) targets.push(process.env.CANTON_JSON_API_URL)
  if (process.env.CANTON_VALIDATOR_API_URL) targets.push(process.env.CANTON_VALIDATOR_API_URL)
  if (process.env.CANTON_ALLOWED_TARGETS) {
    targets.push(...process.env.CANTON_ALLOWED_TARGETS.split(',').map((t) => t.trim()).filter(Boolean))
  }
  return targets
}

const ALLOWED_TARGETS = getAllowedTargets()

function isAllowedTarget(url: string): boolean {
  // Allow localhost targets (primary use case for local dev)
  try {
    const h = new URL(url).hostname
    if (h === 'localhost' || h === '127.0.0.1') return true
  } catch { /* continue */ }

  if (ALLOWED_TARGETS.length === 0) return true
  try {
    const targetHost = new URL(url).hostname
    return ALLOWED_TARGETS.some((allowed) => {
      try {
        return new URL(allowed).hostname === targetHost
      } catch { return url.startsWith(allowed) }
    })
  } catch {
    return ALLOWED_TARGETS.some((allowed) => url.startsWith(allowed))
  }
}

// Handle /api/proxy/:encodedOrigin/*
router.all('/:encodedOrigin/*', (req, res) => {
  let targetOrigin: string
  try {
    targetOrigin = base64urlDecode(req.params.encodedOrigin)
  } catch {
    return res.status(400).json({ error: 'Invalid base64url-encoded origin' })
  }

  // Everything after the encodedOrigin segment
  const restPath = '/' + (req.params[0] || '')

  // Forward original query params
  const queryParams = new URLSearchParams()
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      value.forEach((v) => queryParams.append(key, String(v)))
    } else if (value) {
      queryParams.append(key, String(value))
    }
  }
  const queryString = queryParams.toString()
  const fullUrl = targetOrigin + restPath + (queryString ? `?${queryString}` : '')

  // Validate target URL
  if (!isAllowedTarget(fullUrl) && !targetOrigin.startsWith('https://')) {
    return res.status(403).json({ error: `Target URL not allowed: ${targetOrigin}` })
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(fullUrl)
  } catch {
    return res.status(400).json({ error: `Invalid target URL: ${fullUrl}` })
  }

  const isHttps = targetUrl.protocol === 'https:'
  const transport = isHttps ? https : http

  const headers: Record<string, string> = {}
  if (req.headers.authorization) headers['Authorization'] = req.headers.authorization
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type']
  headers['Host'] = targetUrl.host

  const proxyReq = transport.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const contentType = proxyRes.headers['content-type']
      if (contentType) res.setHeader('Content-Type', contentType)
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.status(proxyRes.statusCode ?? 502)
      proxyRes.pipe(res)
    }
  )

  proxyReq.on('error', (err) => {
    console.error(`[proxy] Error proxying to ${fullUrl}:`, err.message)
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy request failed', details: err.message })
    }
  })

  // Write body from already-parsed request (express.json() consumes the stream)
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    proxyReq.write(body)
    proxyReq.end()
  } else {
    proxyReq.end()
  }
})

export default router
