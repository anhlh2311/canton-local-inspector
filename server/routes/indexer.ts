import { Router } from 'express'
import { SignJWT } from 'jose'
import WebSocket from 'ws'
import { getStorage } from '../storage/index.js'
import type { TemplateEntry, NodeAuthConfig } from '../storage/interface.js'
import { jsonApiHeaders, ledgerGatewayHeaders } from '../../lib/ledgerGateway.js'

const router = Router()

// ---- Types ----

interface NodeConfig {
  id: string
  name: string
  network?: string
  jsonApiUrl: string
  jsonApiPort: number
  validatorApiUrl: string
  validatorApiPort: number
  authMode: string
  userId?: string
  secret?: string
  audience?: string
  issuer?: string
  validatorAudience?: string
}

interface IndexResult {
  status: 'ok' | 'error' | 'skipped'
  templateCount: number
  error?: string
  updatedAt: string
}

// ---- Helpers ----

function buildFullUrl(url: string, port: number): string {
  try {
    const parsed = new URL(url)
    if (!parsed.port && port) parsed.port = String(port)
    // Inside Docker, localhost refers to the container — use host.docker.internal to reach host
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      parsed.hostname = process.env.DOCKER_HOST_OVERRIDE || 'host.docker.internal'
    }
    return parsed.href.replace(/\/$/, '')
  } catch {
    return port ? `${url}:${port}` : url
  }
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

function getOAuth2Credentials(nodeId: string): NodeAuthConfig | null {
  if (process.env.CANTON_NODES_AUTH) {
    try {
      const configs = JSON.parse(process.env.CANTON_NODES_AUTH) as Record<string, NodeAuthConfig>
      if (configs[nodeId]) return configs[nodeId]
    } catch { /* fall through */ }
  }
  return null
}

async function getJsonApiToken(node: NodeConfig): Promise<string> {
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

  const creds = getOAuth2Credentials(node.id)
  if (!creds) throw new Error(`No OAuth2 credentials for node ${node.id}`)

  const res = await fetch(creds.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...ledgerGatewayHeaders(creds.tokenUrl),
    },
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

function parseTemplateId(templateId: string, packageName: string = ''): TemplateEntry | null {
  const colonIdx = templateId.indexOf(':')
  if (colonIdx < 0) return null
  const packageId = templateId.slice(0, colonIdx)
  const rest = templateId.slice(colonIdx + 1)
  const lastColon = rest.lastIndexOf(':')
  if (lastColon < 0) return null
  const module = rest.slice(0, lastColon)
  const entity = rest.slice(lastColon + 1)
  // Canton no longer accepts packageId in queries — use #packageName:Module:Entity format
  const queryTemplateId = packageName ? `#${packageName}:${module}:${entity}` : templateId
  return { templateId: queryTemplateId, packageId, packageName, module, entity }
}

function streamActiveContracts(
  jsonBase: string, token: string, offset: string | number,
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const wsUrl = jsonBase.replace(/^http/, 'ws') + '/v2/state/active-contracts'
    const ws = new WebSocket(wsUrl, [`jwt.token.${token}`, 'daml.ws.auth'], {
      headers: ledgerGatewayHeaders(jsonBase),
    })
    const contracts: Record<string, unknown>[] = []
    const TIMEOUT_MS = 55000
    const timer = setTimeout(() => { ws.close(); resolve(contracts) }, TIMEOUT_MS)

    ws.on('open', () => {
      ws.send(JSON.stringify({
        filter: {
          filtersForAnyParty: {
            cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }]
          }
        },
        verbose: false,
        activeAtOffset: offset,
      }))
    })
    ws.on('message', (data: Buffer) => { try { contracts.push(JSON.parse(data.toString())) } catch { /* skip */ } })
    ws.on('close', () => { clearTimeout(timer); resolve(contracts) })
    ws.on('error', (err: Error) => { clearTimeout(timer); if (contracts.length > 0) resolve(contracts); else reject(err) })
  })
}

async function indexNode(node: NodeConfig): Promise<TemplateEntry[]> {
  const jsonBase = buildFullUrl(node.jsonApiUrl, node.jsonApiPort)
  const templates = new Map<string, TemplateEntry>()
  const jsonToken = await getJsonApiToken(node)
  const jsonHeaders = jsonApiHeaders(jsonBase, jsonToken)

  const ledgerEndRes = await fetch(`${jsonBase}/v2/state/ledger-end`, { headers: jsonHeaders })
  if (!ledgerEndRes.ok) throw new Error(`Ledger end failed: ${ledgerEndRes.status}`)
  const { offset } = await ledgerEndRes.json()
  const errors: string[] = []

  const extractTemplates = (contracts: Record<string, unknown>[]) => {
    for (const c of contracts) {
      const entry = (c as Record<string, unknown>)?.contractEntry as Record<string, unknown> | undefined
      const active = entry?.JsActiveContract as Record<string, unknown> | undefined
      const evt = active?.createdEvent as Record<string, unknown> | undefined
      if (evt?.templateId) {
        const e = parseTemplateId(evt.templateId as string, (evt.packageName as string) ?? '')
        if (e) templates.set(e.templateId, e)
      }
    }
  }

  // Primary: WebSocket streaming
  try {
    const wsContracts = await streamActiveContracts(jsonBase, jsonToken, offset)
    extractTemplates(wsContracts)
    if (templates.size > 0) return [...templates.values()]
    errors.push(`WebSocket returned ${wsContracts.length} contracts, 0 templates`)
  } catch (err) {
    errors.push(`WebSocket: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Fallback 1: HTTP wildcard
  const wildcardFilter = { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }
  try {
    const res = await fetch(`${jsonBase}/v2/state/active-contracts`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({
        filter: { filtersForAnyParty: { cumulative: [wildcardFilter] } },
        verbose: false, activeAtOffset: offset,
      }),
    })
    if (res.ok) {
      const contracts = await res.json()
      if (Array.isArray(contracts)) extractTemplates(contracts)
      if (templates.size > 0) return [...templates.values()]
      errors.push(`HTTP wildcard: ${res.status} ok but 0 templates`)
    } else {
      errors.push(`HTTP wildcard: ${res.status}`)
    }
  } catch (err) {
    errors.push(`HTTP wildcard: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Fallback 2: Per-user-party wildcards
  try {
    const usersRes = await fetch(`${jsonBase}/v2/users?pageSize=20`, { headers: jsonHeaders })
    if (usersRes.ok) {
      const usersData = await usersRes.json()
      const parties = new Set<string>()
      for (const entry of usersData.users ?? []) {
        const u = (entry as Record<string, unknown>)?.user ?? entry
        if ((u as Record<string, unknown>)?.primaryParty) parties.add((u as Record<string, unknown>).primaryParty as string)
      }
      for (const party of [...parties].slice(0, 5)) {
        try {
          const res = await fetch(`${jsonBase}/v2/state/active-contracts`, {
            method: 'POST', headers: jsonHeaders,
            body: JSON.stringify({
              filter: { filtersByParty: { [party]: { cumulative: [wildcardFilter] } } },
              verbose: false, activeAtOffset: offset,
            }),
          })
          if (res.ok) {
            const contracts = await res.json()
            if (Array.isArray(contracts)) extractTemplates(contracts)
            if (templates.size > 0) break
          }
        } catch { /* try next party */ }
      }
    }
  } catch { /* continue */ }

  if (templates.size === 0 && errors.length > 0) {
    console.warn(`[index-templates] ${node.id}: all strategies failed:`, errors.join('; '))
  }
  return [...templates.values()]
}

// ---- Exported indexing function (used by cron and route) ----

export async function runIndexing(bodyNodes?: NodeConfig[]): Promise<Record<string, unknown>> {
  const storage = await getStorage()
  const startTime = Date.now()

  const envNodes = parseNodesFromEnv()
  const nodeMap = new Map<string, NodeConfig>()
  for (const n of envNodes) nodeMap.set(n.id, n)
  if (bodyNodes) {
    for (const n of bodyNodes) nodeMap.set(n.id, n)
  }
  const nodes = [...nodeMap.values()]
  if (nodes.length === 0) {
    return { message: 'No nodes configured', results: {} }
  }

  const results: Record<string, IndexResult> = {}

  const networkNodes: Record<string, NodeConfig[]> = {}
  for (const node of nodes) {
    const net = node.network || node.id
    if (!networkNodes[net]) networkNodes[net] = []
    networkNodes[net].push(node)
  }

  await Promise.allSettled(
    Object.entries(networkNodes).map(async ([network, netNodes]) => {
      try {
        const allTemplates = new Map<string, TemplateEntry>()
        const nodeResults = await Promise.allSettled(
          netNodes.map((n) => indexNode(n))
        )
        for (const result of nodeResults) {
          if (result.status === 'fulfilled') {
            for (const t of result.value) allTemplates.set(t.templateId, t)
          }
        }
        const templates = [...allTemplates.values()]
        await storage.setTemplateIndex(network, {
          updatedAt: new Date().toISOString(),
          network,
          templates,
        })
        results[network] = { status: 'ok', templateCount: templates.length, updatedAt: new Date().toISOString() }
      } catch (err) {
        results[network] = {
          status: 'error', templateCount: 0,
          error: err instanceof Error ? err.message : 'Unknown error',
          updatedAt: new Date().toISOString(),
        }
      }
    })
  )

  const meta = { lastRun: new Date().toISOString(), durationMs: Date.now() - startTime, results }
  await Promise.all([
    storage.setCronMeta(meta),
    storage.setLastRunTimestamp(Date.now()),
  ])

  return meta
}

// ---- Route handlers ----

router.get('/', async (_req, res) => {
  try {
    const result = await runIndexing()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

router.post('/', async (req, res) => {
  const storage = await getStorage()

  const skipCooldown = req.query.force === 'true'
  const COOLDOWN_MS = 5 * 60 * 1000
  const lastRunTs = await storage.getLastRunTimestamp()
  if (!skipCooldown && lastRunTs && (Date.now() - lastRunTs) < COOLDOWN_MS) {
    const remainingSec = Math.ceil((COOLDOWN_MS - (Date.now() - lastRunTs)) / 1000)
    return res.status(429).json({
      error: 'Cooldown active',
      details: `Last indexing ran ${Math.round((Date.now() - lastRunTs) / 1000)}s ago. Try again in ${remainingSec}s.`,
      retryAfterSec: remainingSec,
    })
  }

  const lockAcquired = await storage.acquireLock(120)
  if (!lockAcquired) {
    return res.status(409).json({ error: 'Indexing already in progress' })
  }

  try {
    const bodyNodes = req.body?.nodes as NodeConfig[] | undefined
    const result = await runIndexing(bodyNodes)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  } finally {
    await storage.releaseLock()
  }
})

export default router
