import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'

/**
 * OAuth2 token exchange serverless function.
 *
 * Credential lookup priority:
 *   1. CANTON_NODES_AUTH env var (pre-configured nodes)
 *   2. Upstash Redis (dynamically-added nodes from Settings UI)
 *   3. Legacy single-node CANTON_OAUTH2_* env vars
 */

interface NodeAuthConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  audience: string
  validatorAudience?: string
}

function getNodeAuthFromEnv(nodeId?: string): NodeAuthConfig | null {
  if (nodeId && process.env.CANTON_NODES_AUTH) {
    try {
      const configs = JSON.parse(process.env.CANTON_NODES_AUTH) as Record<string, NodeAuthConfig>
      if (configs[nodeId]) return configs[nodeId]
    } catch {
      // Fall through to legacy
    }
  }

  const tokenUrl = process.env.CANTON_OAUTH2_TOKEN_URL
  const clientId = process.env.CANTON_OAUTH2_CLIENT_ID
  const clientSecret = process.env.CANTON_OAUTH2_CLIENT_SECRET
  if (!tokenUrl || !clientId || !clientSecret) return null

  return {
    tokenUrl,
    clientId,
    clientSecret,
    audience: process.env.CANTON_OAUTH2_AUDIENCE || '',
    validatorAudience: process.env.CANTON_OAUTH2_VALIDATOR_AUDIENCE,
  }
}

async function getStoredCredentials(nodeId: string): Promise<NodeAuthConfig | null> {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  const redis = new Redis({ url, token })
  return redis.get<NodeAuthConfig>(`canton:creds:${nodeId}`)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { audience, nodeId } = req.body ?? {}

  // Priority 1: Environment variables
  let auth: NodeAuthConfig | null = getNodeAuthFromEnv(nodeId)

  // Priority 2: Upstash Redis
  if (!auth && nodeId) {
    auth = await getStoredCredentials(nodeId)
  }

  if (!auth) {
    return res.status(500).json({
      error: 'OAuth2 credentials not configured',
      details: nodeId
        ? `No credentials found for node "${nodeId}". Save credentials via the Settings UI or configure CANTON_NODES_AUTH env var.`
        : 'Configure CANTON_OAUTH2_* or CANTON_NODES_AUTH env vars.',
    })
  }

  try {
    const response = await fetch(auth.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        audience: audience || auth.audience || '',
      }).toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return res.status(response.status).json({ error: 'Token exchange failed', details: errorText })
    }

    const data = await response.json()
    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(502).json({ error: 'Failed to contact OAuth2 provider', details: message })
  }
}
