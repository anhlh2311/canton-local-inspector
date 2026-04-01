import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'

/**
 * Returns the pre-built template index for a node from Redis.
 *
 * GET /api/templates?nodeId=xxx     — template index for a node
 * GET /api/templates?meta=true      — cron job metadata (last run, per-node status)
 */

interface TemplateEntry {
  templateId: string
  packageId: string
  packageName: string
  module: string
  entity: string
}

interface TemplateIndex {
  updatedAt: string | null
  templates: TemplateEntry[]
}

function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const redis = getRedis()

  // Return cron metadata
  if (req.query.meta === 'true') {
    const meta = await redis.get('canton:cron:meta')
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
    return res.status(200).json({ meta: meta ?? null })
  }

  // Return template index for a specific node
  const nodeId = req.query.nodeId as string
  if (!nodeId) {
    return res.status(400).json({ error: 'Missing nodeId query param' })
  }

  const index = await redis.get<TemplateIndex>(`canton:templates:${nodeId}`)
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
  return res.status(200).json(index ?? { updatedAt: null, templates: [] })
}
