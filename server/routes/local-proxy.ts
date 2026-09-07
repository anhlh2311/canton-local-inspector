import { Router, type Request, type Response } from 'express'
import http from 'node:http'
import https from 'node:https'
import { ledgerGatewayHeaders } from '../../lib/ledgerGateway'

/**
 * Local proxy for Vite-style proxy paths used when VITE_DEPLOY_ENV=local.
 * Handles:
 *   /proxy/json/{nodeId}/*        → localhost:{jsonApiPort}
 *   /proxy/validator/{nodeId}/*   → localhost:{validatorApiPort}
 *   /proxy/remote/{base64url}/*   → decoded remote origin
 *   /proxy/oauth2-token/{base64url}/* → decoded OAuth2 token endpoint
 */

const router = Router()

// ---- Node port map (built from VITE_NODES + quickstart defaults) ----

interface LocalNode {
  id: string
  jsonApi: number
  validatorApi: number
}

const defaultLocalNodes: LocalNode[] = [
  { id: 'trading-partner', jsonApi: 1975, validatorApi: 1903 },
  { id: 'app-user', jsonApi: 2975, validatorApi: 2903 },
  { id: 'app-provider', jsonApi: 3975, validatorApi: 3903 },
  { id: 'super-validator', jsonApi: 4975, validatorApi: 4903 },
]

function getEnvLocalNodes(): LocalNode[] {
  try {
    let raw = process.env.VITE_NODES
    if (!raw) return []
    raw = raw.trim()
    if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
      raw = raw.slice(1, -1)
    }
    const nodes = JSON.parse(raw) as Record<string, unknown>[]
    return nodes
      .filter((n) => {
        const url = (n.jsonApiUrl as string) || ''
        return url.includes('localhost') || url.includes('127.0.0.1')
      })
      .map((n) => ({
        id: (n.id as string) || 'env-node',
        jsonApi: Number(n.jsonApiPort) || 0,
        validatorApi: Number(n.validatorApiPort) || 0,
      }))
      .filter((n) => n.jsonApi > 0)
  } catch {
    return []
  }
}

// Build node map: nodeId → { jsonApi, validatorApi }
const nodeMap = new Map<string, LocalNode>()
for (const node of [...defaultLocalNodes, ...getEnvLocalNodes()]) {
  if (!nodeMap.has(node.id)) nodeMap.set(node.id, node)
}

function base64urlDecode(str: string): string {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

// ---- Shared forwarding logic ----

function forwardRequest(req: Request, res: Response, targetUrl: URL): void {
  const isHttps = targetUrl.protocol === 'https:'
  const transport = isHttps ? https : http

  const headers: Record<string, string> = {
    ...ledgerGatewayHeaders(targetUrl.origin),
  }
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
    console.error(`[local-proxy] Error proxying to ${targetUrl.href}:`, err.message)
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy request failed', details: err.message })
    }
  })

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    proxyReq.write(body)
    proxyReq.end()
  } else {
    proxyReq.end()
  }
}

// ---- Middleware: parse /proxy/{type}/{id-or-encoded}/{rest} ----

router.use((req, res, next) => {
  const urlPath = req.url.split('?')[0]

  // Match /proxy/json/{nodeId}/{rest...}
  const jsonMatch = urlPath.match(/^\/proxy\/json\/([^/]+)(\/.*)$/)
  if (jsonMatch) {
    const nodeId = jsonMatch[1]
    const restPath = jsonMatch[2]
    const node = nodeMap.get(nodeId)
    if (!node) {
      return res.status(404).json({ error: `Unknown node: ${nodeId}` })
    }
    // Inside Docker, localhost refers to the container itself, not the host.
    // Use host.docker.internal to reach the host machine's Canton nodes.
    const hostname = process.env.DOCKER_HOST_OVERRIDE || 'host.docker.internal'
    const targetUrl = new URL(`http://${hostname}:${node.jsonApi}${restPath}`)
    // Append query string
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
    if (qs) targetUrl.search = qs
    return forwardRequest(req, res, targetUrl)
  }

  // Match /proxy/validator/{nodeId}/{rest...}
  const valMatch = urlPath.match(/^\/proxy\/validator\/([^/]+)(\/.*)$/)
  if (valMatch) {
    const nodeId = valMatch[1]
    const restPath = valMatch[2]
    const node = nodeMap.get(nodeId)
    if (!node || !node.validatorApi) {
      return res.status(404).json({ error: `Unknown node or no validator API: ${nodeId}` })
    }
    const hostname = process.env.DOCKER_HOST_OVERRIDE || 'host.docker.internal'
    const targetUrl = new URL(`http://${hostname}:${node.validatorApi}${restPath}`)
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
    if (qs) targetUrl.search = qs
    return forwardRequest(req, res, targetUrl)
  }

  // Match /proxy/remote/{base64url-encoded}/{rest...} or /proxy/oauth2-token/{base64url-encoded}/{rest...}
  const remoteMatch = urlPath.match(/^\/proxy\/(?:remote|oauth2-token)\/([^/]+)(\/.*)$/)
  if (remoteMatch) {
    let targetOrigin: string
    try {
      targetOrigin = base64urlDecode(remoteMatch[1])
    } catch {
      return res.status(400).json({ error: 'Invalid base64url-encoded origin' })
    }
    const restPath = remoteMatch[2]
    const fullUrl = targetOrigin + restPath
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
    try {
      const targetUrl = new URL(fullUrl + qs)
      return forwardRequest(req, res, targetUrl)
    } catch {
      return res.status(400).json({ error: `Invalid target URL: ${fullUrl}` })
    }
  }

  next()
})

export default router
