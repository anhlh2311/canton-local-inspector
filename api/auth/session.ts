import type { VercelRequest, VercelResponse } from '@vercel/node'
import { jwtVerify } from 'jose'
import { Redis } from '@upstash/redis'

/**
 * Returns the current user session from the JWT cookie.
 * GET /api/auth/session
 *
 * Returns:
 *   { user: { id, email, name, image, role } } — if authenticated
 *   { user: null } — if no valid session
 *   { user: { email, name, image, denied: true } } — if authenticated but not authorized
 */

interface UserRecord {
  email: string
  name: string
  image: string
  role: 'admin' | 'editor' | 'viewer'
  createdAt: string
  lastLoginAt: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!authSecret) return res.status(200).json({ user: null })

  const cookie = parseCookies(req.headers.cookie || '')
  const token = cookie['canton-session']
  if (!token) return res.status(200).json({ user: null })

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(authSecret))

    // Denied user (authenticated but not authorized)
    if (payload.denied) {
      return res.status(200).json({
        user: {
          email: payload.email,
          name: payload.name,
          image: payload.image,
          denied: true,
        },
      })
    }

    // Refresh role from Redis (in case admin changed it)
    const userId = payload.sub as string
    let role = payload.role as string
    try {
      const redis = new Redis({
        url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
        token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
      })
      const userRecord = await redis.get<UserRecord>(`canton:users:${userId}`)
      if (userRecord) {
        role = userRecord.role
      } else {
        // User was removed from Redis — session invalid
        res.setHeader('Set-Cookie', 'canton-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
        return res.status(200).json({ user: null })
      }
    } catch {
      // Redis unavailable — use role from JWT
    }

    return res.status(200).json({
      user: {
        id: userId,
        email: payload.email,
        name: payload.name,
        image: payload.image,
        role,
      },
    })
  } catch {
    // Invalid or expired JWT
    res.setHeader('Set-Cookie', 'canton-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
    return res.status(200).json({ user: null })
  }
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const pair of cookieHeader.split(';')) {
    const [key, ...vals] = pair.trim().split('=')
    if (key) cookies[key] = vals.join('=')
  }
  return cookies
}
