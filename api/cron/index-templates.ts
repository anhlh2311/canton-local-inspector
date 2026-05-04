import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { SignJWT } from 'jose'
import WebSocket from 'ws'

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

/** Stream ALL active contracts via WebSocket — no 200-element limit.
 *  Falls back to HTTP API if WebSocket fails. */
async function indexNode(node: NodeConfig, redis: Redis): Promise<TemplateEntry[]> {
  const jsonBase = buildFullUrl(node.jsonApiUrl, node.jsonApiPort)
  const templates = new Map<string, TemplateEntry>()
  const TAG = `[index-templates] ${node.id}`

  console.log(`${TAG}: starting indexing — jsonBase=${jsonBase}, authMode=${node.authMode}`)

  const jsonToken = await getJsonApiToken(node, redis)
  const jsonHeaders = { 'Authorization': `Bearer ${jsonToken}`, 'Content-Type': 'application/json' }

  // Get ledger end offset
  const ledgerEndRes = await fetch(`${jsonBase}/v2/state/ledger-end`, { headers: jsonHeaders })
  if (!ledgerEndRes.ok) {
    const body = await ledgerEndRes.text().catch(() => '(unreadable)')
    throw new Error(`Ledger end failed: ${ledgerEndRes.status} — ${body}`)
  }
  const { offset } = await ledgerEndRes.json()
  console.log(`${TAG}: ledger-end offset=${JSON.stringify(offset)}`)

  const errors: string[] = []

  // Primary strategy: WebSocket streaming (no 200-element limit)
  try {
    console.log(`${TAG}: [WS] attempting WebSocket streaming...`)
    const wsContracts = await streamActiveContracts(jsonBase, jsonToken, offset)
    console.log(`${TAG}: [WS] received ${wsContracts.length} messages`)
    if (wsContracts.length > 0 && wsContracts.length <= 3) {
      console.log(`${TAG}: [WS] sample messages: ${JSON.stringify(wsContracts).slice(0, 2000)}`)
    } else if (wsContracts.length > 3) {
      console.log(`${TAG}: [WS] first message keys: ${JSON.stringify(Object.keys(wsContracts[0] || {}))}`)
      console.log(`${TAG}: [WS] first message sample: ${JSON.stringify(wsContracts[0]).slice(0, 1000)}`)
    }
    for (const c of wsContracts) {
      const entry = (c as Record<string, unknown>)?.contractEntry as Record<string, unknown> | undefined
      const active = entry?.JsActiveContract as Record<string, unknown> | undefined
      const evt = active?.createdEvent as Record<string, unknown> | undefined
      if (evt?.templateId) {
        const e = parseTemplateId(evt.templateId as string, (evt.packageName as string) ?? '')
        if (e) templates.set(e.templateId, e)
      }
    }
    console.log(`${TAG}: [WS] extracted ${templates.size} unique templates from ${wsContracts.length} contracts`)
    if (templates.size > 0) return [...templates.values()]
    errors.push(`WebSocket returned ${wsContracts.length} contracts, 0 templates`)
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    console.error(`${TAG}: [WS] error:`, errMsg)
    errors.push(`WebSocket: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Fallback 1: HTTP filtersForAnyParty wildcard (limited to 200)
  const wildcardFilter = { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }
  try {
    console.log(`${TAG}: [HTTP] attempting filtersForAnyParty wildcard...`)
    const httpBody = {
      filter: { filtersForAnyParty: { cumulative: [wildcardFilter] } },
      verbose: false,
      activeAtOffset: offset,
    }
    const res = await fetch(`${jsonBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(httpBody),
    })
    const hdrs: Record<string, string> = {}
    res.headers.forEach((v, k) => { hdrs[k] = v })
    console.log(`${TAG}: [HTTP] response status=${res.status}, content-type=${hdrs['content-type'] || 'unknown'}, content-length=${hdrs['content-length'] || 'unknown'}`)
    if (res.ok) {
      const rawText = await res.text()
      console.log(`${TAG}: [HTTP] response body length=${rawText.length}, preview=${rawText.slice(0, 500)}`)
      let contracts: unknown
      try { contracts = JSON.parse(rawText) } catch { contracts = rawText }
      if (Array.isArray(contracts)) {
        console.log(`${TAG}: [HTTP] parsed ${contracts.length} contracts`)
        for (const c of contracts) {
          const entry = (c as Record<string, unknown>)?.contractEntry as Record<string, unknown> | undefined
          const active = entry?.JsActiveContract as Record<string, unknown> | undefined
          const evt = active?.createdEvent as Record<string, unknown> | undefined
          if (evt?.templateId) {
            const e = parseTemplateId(evt.templateId as string, (evt.packageName as string) ?? '')
            if (e) templates.set(e.templateId, e)
          }
        }
      } else {
        console.warn(`${TAG}: [HTTP] response is not an array — type=${typeof contracts}, value=${rawText.slice(0, 500)}`)
      }
      if (templates.size > 0) return [...templates.values()]
      errors.push(`HTTP wildcard: ${res.status} ok but 0 templates`)
    } else {
      const errBody = await res.text().catch(() => '(unreadable)')
      console.error(`${TAG}: [HTTP] error response: status=${res.status}, body=${errBody.slice(0, 1000)}`)
      errors.push(`HTTP wildcard: ${res.status} — ${errBody.slice(0, 200)}`)
    }
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    console.error(`${TAG}: [HTTP] fetch error:`, errMsg)
    errors.push(`HTTP wildcard: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Fallback 2: Per-user-party wildcards
  try {
    console.log(`${TAG}: [Party] attempting per-user-party wildcards...`)
    const usersRes = await fetch(`${jsonBase}/v2/users?pageSize=20`, { headers: jsonHeaders })
    console.log(`${TAG}: [Party] users endpoint status=${usersRes.status}`)
    if (usersRes.ok) {
      const usersData = await usersRes.json()
      const parties = new Set<string>()
      for (const entry of usersData.users ?? []) {
        const u = (entry as Record<string, unknown>)?.user ?? entry
        if ((u as Record<string, unknown>)?.primaryParty) parties.add((u as Record<string, unknown>).primaryParty as string)
      }
      console.log(`${TAG}: [Party] found ${parties.size} parties: ${[...parties].slice(0, 5).join(', ')}`)
      for (const party of [...parties].slice(0, 5)) {
        try {
          const res = await fetch(`${jsonBase}/v2/state/active-contracts`, {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({
              filter: { filtersByParty: { [party]: { cumulative: [wildcardFilter] } } },
              verbose: false,
              activeAtOffset: offset,
            }),
          })
          console.log(`${TAG}: [Party] party=${party.slice(0, 30)}... status=${res.status}`)
          if (res.ok) {
            const contracts = await res.json()
            if (Array.isArray(contracts)) {
              console.log(`${TAG}: [Party] party=${party.slice(0, 30)}... returned ${contracts.length} contracts`)
              for (const c of contracts) {
                const cEntry = (c as Record<string, unknown>)?.contractEntry as Record<string, unknown> | undefined
                const cActive = cEntry?.JsActiveContract as Record<string, unknown> | undefined
                const evt = cActive?.createdEvent as Record<string, unknown> | undefined
                if (evt?.templateId) {
                  const e = parseTemplateId(evt.templateId as string, (evt.packageName as string) ?? '')
                  if (e) templates.set(e.templateId, e)
                }
              }
            } else {
              const raw = JSON.stringify(contracts).slice(0, 500)
              console.warn(`${TAG}: [Party] party=${party.slice(0, 30)}... response not array: ${raw}`)
            }
            if (templates.size > 0) break
          } else {
            const errBody = await res.text().catch(() => '(unreadable)')
            console.warn(`${TAG}: [Party] party=${party.slice(0, 30)}... error: ${res.status} — ${errBody.slice(0, 300)}`)
          }
        } catch (err) {
          console.warn(`${TAG}: [Party] party=${party.slice(0, 30)}... exception: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } else {
      const errBody = await usersRes.text().catch(() => '(unreadable)')
      console.warn(`${TAG}: [Party] users endpoint failed: ${usersRes.status} — ${errBody.slice(0, 300)}`)
      errors.push(`Per-user-party: users endpoint ${usersRes.status}`)
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`${TAG}: [Party] exception:`, errMsg)
    errors.push(`Per-user-party: ${errMsg}`)
  }

  if (templates.size === 0 && errors.length > 0) {
    console.error(`${TAG}: ALL STRATEGIES FAILED — errors: ${errors.join(' | ')}`)
  } else {
    console.log(`${TAG}: finished with ${templates.size} templates`)
  }
  return [...templates.values()]
}

/** Connect to Canton JSON API WebSocket and stream all active contracts.
 *  Returns when the stream completes (connection closes). Timeout after 45s. */
function streamActiveContracts(
  jsonBase: string,
  token: string,
  offset: string | number,
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const wsUrl = jsonBase.replace(/^http/, 'ws') + '/v2/state/active-contracts'
    console.log(`[index-templates] [WS] connecting to ${wsUrl}`)
    const ws = new WebSocket(wsUrl, [`jwt.token.${token}`, 'daml.ws.auth'])
    const contracts: Record<string, unknown>[] = []
    let messageCount = 0
    const TIMEOUT_MS = 45000 // 45s — leave 15s buffer for the 60s Vercel limit
    const timer = setTimeout(() => {
      console.warn(`[index-templates] [WS] timeout after ${TIMEOUT_MS}ms with ${contracts.length} contracts, ${messageCount} total messages`)
      ws.close()
      resolve(contracts) // Return whatever we got before timeout
    }, TIMEOUT_MS)

    ws.on('open', () => {
      console.log(`[index-templates] [WS] connected, sending filter request with offset=${JSON.stringify(offset)}`)
      ws.send(JSON.stringify({
        filter: {
          filtersForAnyParty: {
            cumulative: [{
              identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } }
            }]
          }
        },
        verbose: false,
        activeAtOffset: offset,
      }))
    })

    ws.on('message', (data: Buffer) => {
      messageCount++
      const raw = data.toString()
      if (messageCount <= 3) {
        console.log(`[index-templates] [WS] message #${messageCount} (${raw.length} bytes): ${raw.slice(0, 500)}`)
      }
      try {
        contracts.push(JSON.parse(raw))
      } catch (err) {
        console.warn(`[index-templates] [WS] failed to parse message #${messageCount}: ${(err as Error).message} — raw: ${raw.slice(0, 200)}`)
      }
    })

    ws.on('close', (code: number, reason: Buffer) => {
      clearTimeout(timer)
      console.log(`[index-templates] [WS] closed — code=${code}, reason="${reason.toString()}", contracts=${contracts.length}, messages=${messageCount}`)
      resolve(contracts)
    })

    ws.on('error', (err: Error) => {
      clearTimeout(timer)
      console.error(`[index-templates] [WS] error: ${err.message}`, err.stack)
      if (contracts.length > 0) resolve(contracts) // Return partial results
      else reject(err)
    })
  })
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
    // For manual POST triggers, use nodes from request body (includes dynamically-added nodes).
    // For scheduled GET (Vercel cron), use VITE_NODES env var only.
    const bodyNodes = (isManualPost && req.body?.nodes) as NodeConfig[] | undefined
    const envNodes = parseNodesFromEnv()
    // Merge: body nodes override env nodes with same ID, then append new ones
    const nodeMap = new Map<string, NodeConfig>()
    for (const n of envNodes) nodeMap.set(n.id, n)
    if (bodyNodes) {
      for (const n of bodyNodes) nodeMap.set(n.id, n)
    }
    const nodes = [...nodeMap.values()]
    console.log(`[index-templates] resolved ${nodes.length} nodes: ${nodes.map(n => `${n.id}(${n.network || 'no-network'}, ${n.authMode}, json=${n.jsonApiUrl}:${n.jsonApiPort})`).join(', ')}`)
    if (nodes.length === 0) {
      return res.status(200).json({ message: 'No nodes configured', results: {} })
    }

    const results: Record<string, IndexResult> = {}

    // Group nodes by network — multiple nodes on the same network share one template index
    const networkNodes: Record<string, NodeConfig[]> = {}
    for (const node of nodes) {
      const net = node.network || node.id
      if (!networkNodes[net]) networkNodes[net] = []
      networkNodes[net].push(node)
    }

    // Process each network in parallel, merge templates from all its nodes
    await Promise.allSettled(
      Object.entries(networkNodes).map(async ([network, netNodes]) => {
        // Skip networks where all nodes are localhost
        if (netNodes.every((n) => isLocalhost(n.jsonApiUrl))) {
          results[network] = { status: 'skipped', templateCount: 0, updatedAt: new Date().toISOString() }
          return
        }

        try {
          // Index all nodes in this network and merge their templates
          const allTemplates = new Map<string, TemplateEntry>()
          const nonLocalNodes = netNodes.filter((n) => !isLocalhost(n.jsonApiUrl))
          const nodeResults = await Promise.allSettled(
            nonLocalNodes.map((n) => indexNode(n, redis))
          )
          for (let i = 0; i < nodeResults.length; i++) {
            const result = nodeResults[i]
            if (result.status === 'fulfilled') {
              for (const t of result.value) allTemplates.set(t.templateId, t)
            } else {
              console.error(`[index-templates] ${network}/${nonLocalNodes[i].id}: indexNode rejected — ${result.reason}`)
            }
          }
          const templates = [...allTemplates.values()]
          await redis.set(`canton:templates:${network}`, {
            updatedAt: new Date().toISOString(),
            network,
            templates,
          })
          results[network] = {
            status: 'ok',
            templateCount: templates.length,
            updatedAt: new Date().toISOString(),
          }
        } catch (err) {
          results[network] = {
            status: 'error',
            templateCount: 0,
            error: err instanceof Error ? err.message : 'Unknown error',
            updatedAt: new Date().toISOString(),
          }
        }
      })
    )

    // Store cron metadata + cooldown timestamp
    const durationMs = Date.now() - startTime
    console.log(`[index-templates] completed in ${durationMs}ms — results: ${JSON.stringify(results)}`)
    const meta = {
      lastRun: new Date().toISOString(),
      durationMs,
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
