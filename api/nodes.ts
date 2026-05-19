import type { VercelRequest, VercelResponse } from '@vercel/node'
import { jwtVerify } from 'jose'
import { Redis } from '@upstash/redis'
import type { JWTPayload } from 'jose'

/**
 * Manage server-stored node configurations.
 * Node configs are stored in Upstash Redis so they are shared across all users.
 * Secrets (clientSecret) are never stored here — they go to canton:creds:{nodeId}.
 *
 * GET    /api/nodes              — List all server-stored node configs (any authenticated user)
 * POST   /api/nodes              — Save a node config (admin only)
 * DELETE /api/nodes?nodeId=xxx   — Remove a node config (admin only)
 */

const NODES_LIST_KEY = 'canton:nodes:list'

function nodeKey(nodeId: string): string {
  return `canton:node:${nodeId}`
}

function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  })
}

async function verifySession(req: VercelRequest): Promise<{ authenticated: boolean; role?: string }> {
  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!authSecret) return { authenticated: true, role: 'admin' }
  const cookieHeader = req.headers.cookie || ''
  const match = cookieHeader.match(/canton-session=([^;]+)/)
  if (!match) return { authenticated: false }
  try {
    const { payload } = await jwtVerify(match[1], new TextEncoder().encode(authSecret))
    if ((payload as JWTPayload & { denied?: boolean }).denied) return { authenticated: false }
    return { authenticated: true, role: (payload as JWTPayload & { role?: string }).role }
  } catch {
    return { authenticated: false }
  }
}

// Sanitized node config — never includes clientSecret
interface StoredNodeConfig {
  id: string
  name: string
  color: string
  network?: string
  jsonApiUrl: string
  jsonApiPort: number
  validatorApiUrl: string
  validatorApiPort: number
  ledgerApiPort: number
  authMode: string
  // OAuth2 non-secret fields
  tokenUrl?: string
  clientId?: string
  audience?: string
  validatorAudience?: string
  // Metadata
  adminUser?: string
  globalSynchronizerId?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const session = await verifySession(req)
  if (!session.authenticated) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const redis = getRedis()

  // GET — list all server-stored node configs (any authenticated user)
  if (req.method === 'GET') {
    const nodeIds = await redis.smembers(NODES_LIST_KEY) as string[]
    if (!nodeIds.length) return res.status(200).json({ nodes: [] })

    const pipeline = redis.pipeline()
    for (const id of nodeIds) pipeline.get(nodeKey(id))
    const results = await pipeline.exec()

    const nodes = results.filter(Boolean) as StoredNodeConfig[]
    return res.status(200).json({ nodes })
  }

  // POST / DELETE require admin
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }

  // POST — save a node config
  if (req.method === 'POST') {
    const body = req.body ?? {}
    const { id, name, jsonApiUrl } = body
    if (!id || !name || !jsonApiUrl) {
      return res.status(400).json({ error: 'Missing required fields: id, name, jsonApiUrl' })
    }

    const nodeConfig: StoredNodeConfig = {
      id: body.id,
      name: body.name,
      color: body.color || '#ec4899',
      network: body.network || undefined,
      jsonApiUrl: body.jsonApiUrl,
      jsonApiPort: Number(body.jsonApiPort) || 0,
      validatorApiUrl: body.validatorApiUrl || '',
      validatorApiPort: Number(body.validatorApiPort) || 0,
      ledgerApiPort: Number(body.ledgerApiPort) || 0,
      authMode: body.authMode || 'oauth2',
      tokenUrl: body.tokenUrl || undefined,
      clientId: body.clientId || undefined,
      audience: body.audience || undefined,
      validatorAudience: body.validatorAudience || undefined,
      adminUser: body.adminUser || undefined,
      globalSynchronizerId: body.globalSynchronizerId || undefined,
    }

    await redis.set(nodeKey(id), nodeConfig)
    await redis.sadd(NODES_LIST_KEY, id)
    return res.status(200).json({ ok: true })
  }

  // DELETE — remove a node config
  if (req.method === 'DELETE') {
    const nodeId = (req.query.nodeId as string) || (req.body?.nodeId as string)
    if (!nodeId) {
      return res.status(400).json({ error: 'Missing nodeId' })
    }
    await redis.del(nodeKey(nodeId))
    await redis.srem(NODES_LIST_KEY, nodeId)
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
