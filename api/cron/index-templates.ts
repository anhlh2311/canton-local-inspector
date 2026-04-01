import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { SignJWT } from 'jose'

/**
 * Cron job: Index templates for all configured Canton nodes.
 * Runs daily via Vercel Cron (schedule in vercel.json).
 * Can also be triggered manually via POST with CRON_SECRET.
 *
 * For each node:
 *   1. Authenticate (shared-secret JWT or OAuth2)
 *   2. Query scan proxy for core Splice template IDs
 *   3. Query JSON API with filtersForAnyParty wildcard
 *   4. Try individual user party wildcards if needed
 *   5. Store discovered templates in Upstash Redis
 *
 * Security: Requires Authorization: Bearer <CRON_SECRET>
 * Concurrency: Uses Redis lock to prevent overlapping runs
 */

// ---- Inline types ----

interface NodeAuthEnvConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  audience: string
  validatorAudience?: string
}

interface NodeConfig {
  id: string
  name: string
  network?: string
  jsonApiUrl: string
  jsonApiPort: number
  validatorApiUrl: string
  validatorApiPort: number
  authMode: string
  // shared-secret fields
  userId?: string
  secret?: string
  audience?: string
  issuer?: string
  // oauth2 fields (audience reused)
  validatorAudience?: string
}

interface TemplateEntry {
  templateId: string
  packageId: string
  packageName: string
  module: string
  entity: string
}

interface IndexResult {
  status: 'ok' | 'error' | 'skipped'
  templateCount: number
  error?: string
  updatedAt: string
}

// ---- Inline helpers ----

function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  })
}

function buildFullUrl(url: string, port: number): string {
  try {
    const parsed = new URL(url)
    if (!parsed.port && port) parsed.port = String(port)
    return parsed.href.replace(/\/$/, '')
  } catch {
    return port ? `${url}:${port}` : url
  }
}

function isLocalhost(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return h === 'localhost' || h === '127.0.0.1'
  } catch { return false }
}

function parseNodesFromEnv(): NodeConfig[] {
  let raw = process.env.VITE_NODES as string | undefined
  if (!raw) return []
  raw = raw.trim()
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    raw = raw.slice(1, -1)
  }
  try {
    const nodes = JSON.parse(raw) as Record<string, unknown>[]
    return nodes.map((n, i) => ({
      id: (n.id as string) || `env-node-${i}`,
      name: (n.name as string) || `Node ${i + 1}`,
      network: (n.network as string) || undefined,
      jsonApiUrl: (n.jsonApiUrl as string) || '',
      jsonApiPort: Number(n.jsonApiPort) || 0,
      validatorApiUrl: (n.validatorApiUrl as string) || '',
      validatorApiPort: Number(n.validatorApiPort) || 0,
      authMode: (n.authMode as string) || 'shared-secret',
      userId: (n.userId as string) || 'ledger-api-user',
      secret: (n.secret as string) || 'unsafe',
      audience: (n.audience as string) || 'https://canton.network.global',
      issuer: (n.issuer as string) || 'unsafe-auth',
      validatorAudience: (n.validatorAudience as string) || undefined,
    }))
  } catch {
    return []
  }
}

function getOAuth2Credentials(nodeId: string): NodeAuthEnvConfig | null {
  if (process.env.CANTON_NODES_AUTH) {
    try {
      const configs = JSON.parse(process.env.CANTON_NODES_AUTH) as Record<string, NodeAuthEnvConfig>
      if (configs[nodeId]) return configs[nodeId]
    } catch { /* fall through */ }
  }
  return null
}

async function getOAuth2CredentialsFromRedis(redis: Redis, nodeId: string): Promise<NodeAuthEnvConfig | null> {
  return redis.get<NodeAuthEnvConfig>(`canton:creds:${nodeId}`)
}

async function getJsonApiToken(node: NodeConfig, redis: Redis): Promise<string> {
  if (node.authMode === 'shared-secret') {
    const key = new TextEncoder().encode(node.secret || 'unsafe')
    return new SignJWT({
      sub: node.userId || 'ledger-api-user',
      aud: node.audience || 'https://canton.network.global',
      iss: node.issuer || 'unsafe-auth',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key)
  }

  // OAuth2
  const creds = getOAuth2Credentials(node.id) || await getOAuth2CredentialsFromRedis(redis, node.id)
  if (!creds) throw new Error(`No OAuth2 credentials for node ${node.id}`)

  const res = await fetch(creds.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      audience: node.audience || creds.audience || '',
    }).toString(),
  })
  if (!res.ok) throw new Error(`OAuth2 token failed: ${res.status}`)
  const data = await res.json()
  return data.access_token
}

async function getValidatorToken(node: NodeConfig, redis: Redis): Promise<string> {
  if (node.authMode === 'shared-secret') {
    return getJsonApiToken(node, redis) // Same token for shared-secret
  }

  const creds = getOAuth2Credentials(node.id) || await getOAuth2CredentialsFromRedis(redis, node.id)
  if (!creds) throw new Error(`No OAuth2 credentials for node ${node.id}`)

  const audience = creds.validatorAudience || node.validatorAudience || creds.audience
  const res = await fetch(creds.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      audience,
    }).toString(),
  })
  if (!res.ok) throw new Error(`Validator OAuth2 token failed: ${res.status}`)
  const data = await res.json()
  return data.access_token
}

function parseTemplateId(templateId: string, packageName: string = ''): TemplateEntry | null {
  const colonIdx = templateId.indexOf(':')
  if (colonIdx < 0) return null
  const packageId = templateId.slice(0, colonIdx)
  const rest = templateId.slice(colonIdx + 1)
  const lastColon = rest.lastIndexOf(':')
  if (lastColon < 0) return null
  return {
    templateId,
    packageId,
    packageName,
    module: rest.slice(0, lastColon),
    entity: rest.slice(lastColon + 1),
  }
}

// ---- Per-node indexing logic ----

async function indexNode(node: NodeConfig, redis: Redis): Promise<TemplateEntry[]> {
  const jsonBase = buildFullUrl(node.jsonApiUrl, node.jsonApiPort)
  const valBase = node.validatorApiUrl ? buildFullUrl(node.validatorApiUrl, node.validatorApiPort) : null
  const templates = new Map<string, TemplateEntry>()

  const jsonToken = await getJsonApiToken(node, redis)
  const jsonHeaders = { 'Authorization': `Bearer ${jsonToken}`, 'Content-Type': 'application/json' }

  // Get ledger end offset
  const ledgerEndRes = await fetch(`${jsonBase}/v2/state/ledger-end`, { headers: jsonHeaders })
  if (!ledgerEndRes.ok) throw new Error(`Ledger end failed: ${ledgerEndRes.status}`)
  const { offset } = await ledgerEndRes.json()

  // Strategy 1: Scan proxy (no 200 limit, core Splice templates)
  if (valBase) {
    try {
      const valToken = await getValidatorToken(node, redis)
      const valHeaders = { 'Authorization': `Bearer ${valToken}`, 'Content-Type': 'application/json' }

      const [amuletRes, roundsRes] = await Promise.allSettled([
        fetch(`${valBase}/api/validator/v0/scan-proxy/amulet-rules`, { headers: valHeaders }),
        fetch(`${valBase}/api/validator/v0/scan-proxy/open-and-issuing-mining-rounds`, { headers: valHeaders }),
      ])

      if (amuletRes.status === 'fulfilled' && amuletRes.value.ok) {
        const data = await amuletRes.value.json()
        const tid = data?.amulet_rules?.contract?.template_id
        if (tid) { const e = parseTemplateId(tid, 'splice-amulet'); if (e) templates.set(tid, e) }
      }
      if (roundsRes.status === 'fulfilled' && roundsRes.value.ok) {
        const data = await roundsRes.value.json()
        for (const key of Object.keys(data ?? {})) {
          if (Array.isArray(data[key])) {
            for (const r of data[key]) {
              const tid = r?.contract?.template_id
              if (tid) { const e = parseTemplateId(tid, 'splice-amulet'); if (e) templates.set(tid, e) }
            }
          }
        }
      }
    } catch { /* Scan proxy not available */ }
  }

  // Strategy 2: filtersForAnyParty wildcard
  const wildcardFilter = { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }
  try {
    const res = await fetch(`${jsonBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        filter: { filtersForAnyParty: { cumulative: [wildcardFilter] } },
        verbose: false,
        activeAtOffset: offset,
      }),
    })
    if (res.ok) {
      const contracts = await res.json()
      if (Array.isArray(contracts)) {
        for (const c of contracts) {
          const evt = c?.contractEntry?.JsActiveContract?.createdEvent
          if (evt?.templateId) {
            const e = parseTemplateId(evt.templateId, evt.packageName ?? '')
            if (e) templates.set(e.templateId, e)
          }
        }
      }
      if (templates.size > 0) return [...templates.values()]
    }
  } catch { /* Hit 200 limit or other error */ }

  // Strategy 3: Per-user-party wildcards (try up to 10 parties)
  try {
    const usersRes = await fetch(`${jsonBase}/v2/users?pageSize=20`, { headers: jsonHeaders })
    if (usersRes.ok) {
      const usersData = await usersRes.json()
      const parties = new Set<string>()
      for (const entry of usersData.users ?? []) {
        const u = entry?.user ?? entry
        const party = u?.primaryParty
        if (party) parties.add(party)
      }

      // Query in parallel batches of 5
      const partyList = [...parties].slice(0, 10)
      const BATCH = 5
      for (let i = 0; i < partyList.length; i += BATCH) {
        const batch = partyList.slice(i, i + BATCH)
        const results = await Promise.allSettled(
          batch.map((party) =>
            fetch(`${jsonBase}/v2/state/active-contracts`, {
              method: 'POST',
              headers: jsonHeaders,
              body: JSON.stringify({
                filter: { filtersByParty: { [party]: { cumulative: [wildcardFilter] } } },
                verbose: false,
                activeAtOffset: offset,
              }),
            }).then(async (r) => {
              if (!r.ok) throw new Error(`${r.status}`)
              return r.json()
            })
          )
        )
        for (const result of results) {
          if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            for (const c of result.value) {
              const evt = c?.contractEntry?.JsActiveContract?.createdEvent
              if (evt?.templateId) {
                const e = parseTemplateId(evt.templateId, evt.packageName ?? '')
                if (e) templates.set(e.templateId, e)
              }
            }
          }
        }
        if (templates.size > 0) break // Stop after first successful batch
      }
    }
  } catch { /* continue */ }

  return [...templates.values()]
}

// ---- Handler ----

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()

  // Auth: Accept CRON_SECRET (Vercel cron) or same-origin POST (manual trigger from UI)
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  const isManualPost = req.method === 'POST'

  if (isManualPost) {
    // Manual trigger: verify same-origin (Origin header must match Host)
    const origin = (req.headers.origin || '') as string
    const host = req.headers.host || ''
    const isSameOrigin = host && origin.includes(host)
    const hasCronSecret = cronSecret && authHeader === `Bearer ${cronSecret}`
    if (!isSameOrigin && !hasCronSecret) {
      return res.status(401).json({ error: 'Unauthorized — must be same-origin or include CRON_SECRET' })
    }
  } else {
    // GET (Vercel cron): require CRON_SECRET
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const redis = getRedis()
  const startTime = Date.now()

  // Cooldown: reject if last run was less than 5 minutes ago (skip with ?force=true)
  const skipCooldown = req.query.force === 'true'
  const COOLDOWN_MS = 5 * 60 * 1000
  const lastRunTs = await redis.get<number>('canton:cron:lastRunTs')
  if (!skipCooldown && lastRunTs && (Date.now() - lastRunTs) < COOLDOWN_MS) {
    const remainingSec = Math.ceil((COOLDOWN_MS - (Date.now() - lastRunTs)) / 1000)
    return res.status(429).json({
      error: 'Cooldown active',
      details: `Last indexing ran ${Math.round((Date.now() - lastRunTs) / 1000)}s ago. Try again in ${remainingSec}s.`,
      retryAfterSec: remainingSec,
    })
  }

  // Acquire lock (120s TTL)
  const lockAcquired = await redis.set('canton:cron:lock', 'running', { nx: true, ex: 120 })
  if (!lockAcquired) {
    return res.status(409).json({ error: 'Indexing already in progress' })
  }

  try {
    const nodes = parseNodesFromEnv()
    if (nodes.length === 0) {
      return res.status(200).json({ message: 'No nodes configured', results: {} })
    }

    const results: Record<string, IndexResult> = {}

    // Process all nodes in parallel
    await Promise.allSettled(
      nodes.map(async (node) => {
        // Skip localhost nodes (unreachable from Vercel)
        if (isLocalhost(node.jsonApiUrl)) {
          results[node.id] = { status: 'skipped', templateCount: 0, updatedAt: new Date().toISOString() }
          return
        }

        try {
          const templates = await indexNode(node, redis)
          await redis.set(`canton:templates:${node.id}`, {
            updatedAt: new Date().toISOString(),
            network: node.network || null,
            templates,
          })
          results[node.id] = {
            status: 'ok',
            templateCount: templates.length,
            updatedAt: new Date().toISOString(),
          }
        } catch (err) {
          results[node.id] = {
            status: 'error',
            templateCount: 0,
            error: err instanceof Error ? err.message : 'Unknown error',
            updatedAt: new Date().toISOString(),
          }
        }
      })
    )

    // Store cron metadata + cooldown timestamp
    const meta = {
      lastRun: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      results,
    }
    await Promise.all([
      redis.set('canton:cron:meta', meta),
      redis.set('canton:cron:lastRunTs', Date.now()),
    ])

    return res.status(200).json(meta)
  } finally {
    // Always release lock
    await redis.del('canton:cron:lock')
  }
}
