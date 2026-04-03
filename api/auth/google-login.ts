import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Redirects the user to Google's OAuth consent screen.
 * GET /api/auth/google-login
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured' })

  const redirectUri = `${getBaseUrl(req)}/api/auth/google-callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
  })

  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}

function getBaseUrl(req: VercelRequest): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'
  return `${proto}://${host}`
}
