import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'

/**
 * Manage OAuth2 credentials for dynamically-added nodes.
 * Credentials are stored in Upstash Redis — never in the browser.
 *
 * POST   /api/auth/credentials  — Save credentials for a node
 * DELETE /api/auth/credentials  — Remove credentials for a node
 * GET    /api/auth/credentials?nodeId=xxx — Check if credentials exist (no secrets returned)
 *
 * Requires env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 * (auto-set when linking Upstash Redis via Vercel Marketplace)
 */

export interface StoredCredentials {
  tokenUrl: string
  clientId: string
  clientSecret: string
  audience: string
  validatorAudience?: string
}

function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  })
}

function kvKey(nodeId: string): string {
  return `canton:creds:${nodeId}`
}

export async function getStoredCredentials(nodeId: string): Promise<StoredCredentials | null> {
  const redis = getRedis()
  return redis.get<StoredCredentials>(kvKey(nodeId))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const redis = getRedis()

  if (req.method === 'POST') {
    const { nodeId, tokenUrl, clientId, clientSecret, audience, validatorAudience } = req.body ?? {}
    if (!nodeId || !tokenUrl || !clientId || !clientSecret) {
      return res.status(400).json({ error: 'Missing required fields: nodeId, tokenUrl, clientId, clientSecret' })
    }

    const creds: StoredCredentials = { tokenUrl, clientId, clientSecret, audience: audience || '', validatorAudience }
    await redis.set(kvKey(nodeId), creds)
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const nodeId = (req.query.nodeId as string) || (req.body?.nodeId as string)
    if (!nodeId) {
      return res.status(400).json({ error: 'Missing nodeId' })
    }
    await redis.del(kvKey(nodeId))
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'GET') {
    const nodeId = req.query.nodeId as string
    if (!nodeId) {
      return res.status(400).json({ error: 'Missing nodeId query param' })
    }
    const creds = await redis.get<StoredCredentials>(kvKey(nodeId))
    return res.status(200).json({ exists: !!creds })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
