import type { VercelRequest, VercelResponse } from '@vercel/node'
import { jwtVerify } from 'jose'
import { ledgerGatewayHeaders } from '../lib/ledgerGateway'

/**
 * Canton API proxy serverless function.
 * Vercel rewrite: /api/proxy/{encoded}/{path...} → /api/proxy?_path={encoded}/{path...}
 *
 * Example: /api/proxy/aHR0cDovLzE0Ni41OS4xMTAuMTAwOjc1NzU/api/json-api/v2/version
 * → forwards to http://146.59.110.100:7575/api/json-api/v2/version
 */

// Build allowed targets from env vars
function getAllowedTargets(): string[] {
  const targets: string[] = []

  // Legacy single-node vars
  if (process.env.CANTON_JSON_API_URL) targets.push(process.env.CANTON_JSON_API_URL)
  if (process.env.CANTON_VALIDATOR_API_URL) targets.push(process.env.CANTON_VALIDATOR_API_URL)

  // Multi-node: CANTON_ALLOWED_TARGETS (comma-separated URLs)
  if (process.env.CANTON_ALLOWED_TARGETS) {
    targets.push(...process.env.CANTON_ALLOWED_TARGETS.split(',').map((t) => t.trim()).filter(Boolean))
  }

  return targets
}

const ALLOWED_TARGETS = getAllowedTargets()

function isAllowedTarget(url: string): boolean {
  if (ALLOWED_TARGETS.length === 0) return true
  try {
    const targetHost = new URL(url).hostname
    return ALLOWED_TARGETS.some((allowed) => {
      try {
        // Match by hostname — allows different ports/paths on the same host
        return new URL(allowed).hostname === targetHost
      } catch { return url.startsWith(allowed) }
    })
  } catch {
    return ALLOWED_TARGETS.some((allowed) => url.startsWith(allowed))
  }
}

function base64urlDecode(str: string): string {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res.status(204).end()
  }

  // Require valid user session to proxy Canton API requests
  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (authSecret) {
    const cookieHeader = req.headers.cookie || ''
    const match = cookieHeader.match(/canton-session=([^;]+)/)
    let authenticated = false
    if (match) {
      try {
        const { payload } = await jwtVerify(match[1], new TextEncoder().encode(authSecret))
        authenticated = !payload.denied
      } catch { /* invalid token */ }
    }
    if (!authenticated) {
      return res.status(401).json({ error: 'Authentication required' })
    }
  }

  // Path comes from rewrite query param
  const rawPath = (req.query._path as string) || ''
  if (!rawPath) {
    return res.status(400).json({ error: 'Missing _path param. Use /api/proxy/{base64url-origin}/{path}' })
  }

  const segments = rawPath.split('/')
  const encodedOrigin = segments[0]
  const restPath = '/' + segments.slice(1).join('/')

  let targetOrigin: string
  try {
    targetOrigin = base64urlDecode(encodedOrigin)
  } catch {
    return res.status(400).json({ error: 'Invalid base64url-encoded origin' })
  }

  // Forward original query params (except our internal _path param)
  const queryParams = new URLSearchParams()
  for (const [key, value] of Object.entries(req.query)) {
    if (key === '_path') continue
    if (Array.isArray(value)) {
      value.forEach((v) => queryParams.append(key, v))
    } else if (value) {
      queryParams.append(key, value)
    }
  }
  const queryString = queryParams.toString()
  const fullUrl = targetOrigin + restPath + (queryString ? `?${queryString}` : '')

  // Check if targeting localhost — serverless functions can't reach the user's machine
  try {
    const targetHost = new URL(targetOrigin).hostname
    if (targetHost === 'localhost' || targetHost === '127.0.0.1') {
      return res.status(400).json({
        error: 'Cannot connect to localhost from Vercel',
        details: 'Localhost nodes are not reachable from cloud-hosted deployments. Use "yarn dev" for local development, or expose your Canton node via a tunnel (ngrok, cloudflared) and use the public URL instead.',
      })
    }
  } catch { /* continue */ }

  // Allow pre-configured targets from env, plus any HTTPS target
  // (dynamic nodes added via Settings UI use HTTPS endpoints)
  if (!isAllowedTarget(targetOrigin + restPath) && !targetOrigin.startsWith('https://')) {
    return res.status(403).json({ error: `Target URL not allowed: ${targetOrigin}` })
  }

  const headers: Record<string, string> = {
    ...ledgerGatewayHeaders(targetOrigin),
  }
  if (req.headers.authorization) headers['Authorization'] = req.headers.authorization as string
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'] as string

  try {
    const fetchOptions: RequestInit = {
      method: req.method || 'GET',
      headers,
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    }

    const response = await fetch(fullUrl, fetchOptions)

    const contentType = response.headers.get('content-type')
    if (contentType) res.setHeader('Content-Type', contentType)
    res.setHeader('Access-Control-Allow-Origin', '*')

    const data = await response.text()
    return res.status(response.status).send(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(502).json({ error: 'Proxy request failed', details: message })
  }
}
