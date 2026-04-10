import { Router } from 'express'
import http from 'node:http'
import https from 'node:https'

const router = Router()

function base64urlDecode(str: string): string {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
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

  // Pipe request body for POST/PUT/etc
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq)
  } else {
    proxyReq.end()
  }
})

// Handle OPTIONS for CORS preflight
router.options('*', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.status(204).end()
})

export default router
