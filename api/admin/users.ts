import type { VercelRequest, VercelResponse } from '@vercel/node'
import { jwtVerify } from 'jose'
import { Redis } from '@upstash/redis'

/**
 * User management endpoints (admin only).
 *
 * GET    /api/admin/users          — List all users
 * PATCH  /api/admin/users          — Change user role { userId, role }
 * DELETE /api/admin/users          — Revoke user access { userId }
 */

interface UserRecord {
  email: string
  name: string
  image: string
  role: 'admin' | 'editor' | 'viewer'
  createdAt: string
  lastLoginAt: string
}

function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  })
}

async function verifyAdmin(req: VercelRequest): Promise<{ userId: string; email: string } | null> {
  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!authSecret) return null

  const cookieHeader = req.headers.cookie || ''
  const match = cookieHeader.match(/canton-session=([^;]+)/)
  if (!match) return null

  try {
    const { payload } = await jwtVerify(match[1], new TextEncoder().encode(authSecret))
    if (payload.role !== 'admin') return null
    return { userId: payload.sub as string, email: payload.email as string }
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()

  const admin = await verifyAdmin(req)
  if (!admin) return res.status(403).json({ error: 'Admin access required' })

  const redis = getRedis()

  // GET — List all users
  if (req.method === 'GET') {
    const userIds = await redis.smembers('canton:users:list')
    const users: (UserRecord & { id: string })[] = []
    if (userIds.length > 0) {
      const pipeline = redis.pipeline()
      for (const id of userIds) pipeline.get(`canton:users:${id}`)
      const results = await pipeline.exec()
      for (let i = 0; i < userIds.length; i++) {
        const record = results[i] as UserRecord | null
        if (record) users.push({ id: userIds[i], ...record })
      }
    }
    users.sort((a, b) => new Date(b.lastLoginAt).getTime() - new Date(a.lastLoginAt).getTime())
    return res.status(200).json({ users })
  }

  // PATCH — Change user role
  if (req.method === 'PATCH') {
    const { userId, role } = req.body ?? {}
    if (!userId || !['admin', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid userId or role' })
    }
    // Admin cannot demote themselves
    if (userId === admin.userId && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot change your own admin role' })
    }
    const user = await redis.get<UserRecord>(`canton:users:${userId}`)
    if (!user) return res.status(404).json({ error: 'User not found' })

    user.role = role
    await redis.set(`canton:users:${userId}`, user)
    return res.status(200).json({ ok: true, user: { id: userId, ...user } })
  }

  // DELETE — Revoke user access
  if (req.method === 'DELETE') {
    const userId = (req.query.userId || req.body?.userId) as string
    if (!userId) return res.status(400).json({ error: 'Missing userId' })
    if (userId === admin.userId) {
      return res.status(400).json({ error: 'Cannot revoke your own access' })
    }
    const user = await redis.get<UserRecord>(`canton:users:${userId}`)
    if (user) {
      await Promise.all([
        redis.del(`canton:users:${userId}`),
        redis.del(`canton:users:by-email:${user.email}`),
        redis.srem('canton:users:list', userId),
      ])
    }
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
