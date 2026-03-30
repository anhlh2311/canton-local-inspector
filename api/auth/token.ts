import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * OAuth2 token exchange serverless function.
 * Supports multiple nodes — client sends nodeId to select credentials.
 *
 * Server-side env vars:
 *   CANTON_NODES_AUTH — JSON object mapping nodeId to OAuth2 credentials:
 *     '{"devnet":{"tokenUrl":"...","clientId":"...","clientSecret":"...","audience":"...","validatorAudience":"..."}}'
 *
 *   Legacy single-node vars (used when nodeId is not found in CANTON_NODES_AUTH):
 *     CANTON_OAUTH2_TOKEN_URL, CANTON_OAUTH2_CLIENT_ID, CANTON_OAUTH2_CLIENT_SECRET,
 *     CANTON_OAUTH2_AUDIENCE, CANTON_OAUTH2_VALIDATOR_AUDIENCE
 */

interface NodeAuthConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  audience: string
  validatorAudience?: string
}

function getNodeAuth(nodeId?: string): NodeAuthConfig | null {
  // Try multi-node config first
  if (nodeId && process.env.CANTON_NODES_AUTH) {
    try {
      const configs = JSON.parse(process.env.CANTON_NODES_AUTH) as Record<string, NodeAuthConfig>
      if (configs[nodeId]) return configs[nodeId]
    } catch {
      // Fall through to legacy
    }
  }

  // Legacy single-node env vars
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { audience, nodeId } = req.body ?? {}

  const auth = getNodeAuth(nodeId)
  if (!auth) {
    return res.status(500).json({
      error: 'OAuth2 credentials not configured on server',
      details: nodeId
        ? `No credentials found for node "${nodeId}". Configure CANTON_NODES_AUTH or CANTON_OAUTH2_* env vars.`
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
