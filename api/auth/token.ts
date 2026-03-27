import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { audience } = req.body ?? {}

  const tokenUrl = process.env.CANTON_OAUTH2_TOKEN_URL
  const clientId = process.env.CANTON_OAUTH2_CLIENT_ID
  const clientSecret = process.env.CANTON_OAUTH2_CLIENT_SECRET
  const defaultAudience = process.env.CANTON_OAUTH2_AUDIENCE

  if (!tokenUrl || !clientId || !clientSecret) {
    return res.status(500).json({ error: 'OAuth2 credentials not configured on server' })
  }

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: audience || defaultAudience || '',
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
