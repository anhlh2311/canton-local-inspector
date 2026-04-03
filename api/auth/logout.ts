import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Clears the session cookie and redirects to login.
 * POST /api/auth/logout
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()

  res.setHeader('Set-Cookie', 'canton-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')

  if (req.method === 'POST') {
    return res.status(200).json({ ok: true })
  }

  // GET — redirect to login
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'
  return res.redirect(302, `${proto}://${host}/login`)
}
