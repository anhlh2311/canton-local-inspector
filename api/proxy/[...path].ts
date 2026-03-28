import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Canton API proxy serverless function (catch-all).
 * URL format: /api/proxy/{base64url-encoded-origin}/{rest-of-path}
 *
 * Example: /api/proxy/aHR0cDovLzE0Ni41OS4xMTAuMTAwOjc1NzU/api/json-api/v2/version
 * → forwards to http://146.59.110.100:7575/api/json-api/v2/version
 */

const ALLOWED_TARGETS = [
  process.env.CANTON_JSON_API_URL,
  process.env.CANTON_VALIDATOR_API_URL,
].filter(Boolean) as string[]

function isAllowedTarget(url: string): boolean {
  if (ALLOWED_TARGETS.length === 0) return true
  return ALLOWED_TARGETS.some((allowed) => url.startsWith(allowed))
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

  const pathSegments = req.query.path
  if (!pathSegments || !Array.isArray(pathSegments) || pathSegments.length === 0) {
    return res.status(400).json({ error: 'Missing proxy path segments' })
  }

  const encodedOrigin = pathSegments[0]
  const restPath = '/' + pathSegments.slice(1).join('/')

  let targetOrigin: string
  try {
    targetOrigin = base64urlDecode(encodedOrigin)
  } catch {
    return res.status(400).json({ error: 'Invalid base64url-encoded origin' })
  }

  const fullUrl = targetOrigin + restPath

  if (!isAllowedTarget(fullUrl)) {
    return res.status(403).json({ error: 'Target URL not allowed' })
  }

  const headers: Record<string, string> = {}
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
