# Local Template Indexing & Docker Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostgreSQL-backed template indexing with an Express server and Docker Compose for local development, preserving the existing Vercel deployment unchanged.

**Architecture:** An Express server serves the Vite production build, mounts API routes (templates, proxy, token, indexer), and runs an in-process `node-cron` job every 10 minutes. A `TemplateStorage` abstraction switches between Upstash Redis (Vercel) and PostgreSQL (local Docker) based on the presence of `DATABASE_URL`.

**Tech Stack:** Express, pg (PostgreSQL client), node-cron, tsx, Docker Compose

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `server/index.ts` | Express app entry point: mount routes, serve static files, start cron |
| `server/storage/interface.ts` | `TemplateStorage` interface definition |
| `server/storage/redis.ts` | `RedisStorage` implementation (wraps existing Upstash Redis calls) |
| `server/storage/postgres.ts` | `PostgresStorage` implementation (new) |
| `server/storage/index.ts` | `getStorage()` factory function |
| `server/db-init.ts` | PostgreSQL schema creation on startup |
| `server/cron.ts` | `node-cron` scheduler wrapping the indexing logic |
| `server/routes/templates.ts` | `GET /api/templates` Express route |
| `server/routes/indexer.ts` | `GET/POST /api/cron/index-templates` Express route |
| `server/routes/proxy.ts` | `ALL /api/proxy/*` Express route |
| `server/routes/token.ts` | `POST /api/auth/token` Express route |
| `server/tsconfig.json` | TypeScript config for server code |
| `Dockerfile` | Multi-stage build: build frontend + run server |
| `docker-compose.yml` | App + PostgreSQL services |
| `.dockerignore` | Exclude node_modules, dist, .git from Docker context |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add dependencies (express, pg, node-cron, tsx) and docker scripts |
| `src/hooks/useCantonQuery.ts` | Remove `isVercel` gates on `useDiscoverTemplates`, `useTemplateIndex`, `useCronMeta` |
| `.env.example` | Add `DATABASE_URL`, `CRON_SCHEDULE`, `PORT` documentation |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add production and dev dependencies**

```bash
cd /Users/lehoanganh/Working/FETCH/Angelhack/Canton/canton-local-inspector
yarn add express pg node-cron
yarn add -D @types/express @types/pg @types/node-cron tsx
```

- [ ] **Step 2: Add docker scripts to package.json**

In `package.json`, add to the `"scripts"` object:

```json
"server": "tsx server/index.ts",
"docker:build": "docker compose build",
"docker:up": "docker compose up -d",
"docker:down": "docker compose down",
"docker:logs": "docker compose logs -f app"
```

- [ ] **Step 3: Create server tsconfig**

Create `server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "../dist-server",
    "rootDir": "."
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock server/tsconfig.json
git commit -m "chore: add express, pg, node-cron dependencies and server tsconfig"
```

---

## Task 2: Storage Abstraction — Interface & Factory

**Files:**
- Create: `server/storage/interface.ts`
- Create: `server/storage/index.ts`

- [ ] **Step 1: Create the TemplateStorage interface**

Create `server/storage/interface.ts`:

```typescript
export interface TemplateEntry {
  templateId: string
  packageId: string
  packageName: string
  module: string
  entity: string
}

export interface TemplateIndex {
  updatedAt: string | null
  network: string
  templates: TemplateEntry[]
}

export interface CronMeta {
  lastRun: string
  durationMs: number
  results: Record<string, { status: string; templateCount: number; error?: string; updatedAt: string }>
}

export interface NodeAuthConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  audience: string
  validatorAudience?: string
}

export interface TemplateStorage {
  getTemplateIndex(network: string): Promise<TemplateIndex | null>
  setTemplateIndex(network: string, data: TemplateIndex): Promise<void>
  getCronMeta(): Promise<CronMeta | null>
  setCronMeta(meta: CronMeta): Promise<void>
  getLastRunTimestamp(): Promise<number | null>
  setLastRunTimestamp(ts: number): Promise<void>
  acquireLock(ttlSeconds: number): Promise<boolean>
  releaseLock(): Promise<void>
  getCredentials(nodeId: string): Promise<NodeAuthConfig | null>
}
```

- [ ] **Step 2: Create the storage factory**

Create `server/storage/index.ts`:

```typescript
import type { TemplateStorage } from './interface.js'

let storageInstance: TemplateStorage | null = null

export async function getStorage(): Promise<TemplateStorage> {
  if (storageInstance) return storageInstance

  if (process.env.DATABASE_URL) {
    const { PostgresStorage } = await import('./postgres.js')
    storageInstance = new PostgresStorage(process.env.DATABASE_URL)
    return storageInstance
  }

  const { RedisStorage } = await import('./redis.js')
  storageInstance = new RedisStorage()
  return storageInstance
}

export type { TemplateStorage, TemplateIndex, TemplateEntry, CronMeta, NodeAuthConfig } from './interface.js'
```

- [ ] **Step 3: Commit**

```bash
git add server/storage/interface.ts server/storage/index.ts
git commit -m "feat: add TemplateStorage interface and factory"
```

---

## Task 3: RedisStorage Implementation

**Files:**
- Create: `server/storage/redis.ts`

- [ ] **Step 1: Implement RedisStorage**

Create `server/storage/redis.ts`. This wraps the existing Upstash Redis calls from `api/cron/index-templates.ts` and `api/templates.ts`:

```typescript
import { Redis } from '@upstash/redis'
import type { TemplateStorage, TemplateIndex, CronMeta, NodeAuthConfig } from './interface.js'

export class RedisStorage implements TemplateStorage {
  private redis: Redis

  constructor() {
    this.redis = new Redis({
      url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
      token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
    })
  }

  async getTemplateIndex(network: string): Promise<TemplateIndex | null> {
    return this.redis.get<TemplateIndex>(`canton:templates:${network}`)
  }

  async setTemplateIndex(network: string, data: TemplateIndex): Promise<void> {
    await this.redis.set(`canton:templates:${network}`, data)
  }

  async getCronMeta(): Promise<CronMeta | null> {
    return this.redis.get<CronMeta>('canton:cron:meta')
  }

  async setCronMeta(meta: CronMeta): Promise<void> {
    await this.redis.set('canton:cron:meta', meta)
  }

  async getLastRunTimestamp(): Promise<number | null> {
    return this.redis.get<number>('canton:cron:lastRunTs')
  }

  async setLastRunTimestamp(ts: number): Promise<void> {
    await this.redis.set('canton:cron:lastRunTs', ts)
  }

  async acquireLock(ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set('canton:cron:lock', 'running', { nx: true, ex: ttlSeconds })
    return !!result
  }

  async releaseLock(): Promise<void> {
    await this.redis.del('canton:cron:lock')
  }

  async getCredentials(nodeId: string): Promise<NodeAuthConfig | null> {
    return this.redis.get<NodeAuthConfig>(`canton:creds:${nodeId}`)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/storage/redis.ts
git commit -m "feat: add RedisStorage implementation"
```

---

## Task 4: PostgresStorage Implementation

**Files:**
- Create: `server/storage/postgres.ts`
- Create: `server/db-init.ts`

- [ ] **Step 1: Create DB initialization module**

Create `server/db-init.ts`:

```typescript
import pg from 'pg'

export async function initDatabase(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS template_index (
        network TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cron_meta (
        id INTEGER PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cron_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at TIMESTAMPTZ
      );
    `)
    console.log('[db-init] PostgreSQL schema initialized')
  } finally {
    await client.end()
  }
}
```

- [ ] **Step 2: Implement PostgresStorage**

Create `server/storage/postgres.ts`:

```typescript
import pg from 'pg'
import type { TemplateStorage, TemplateIndex, CronMeta, NodeAuthConfig } from './interface.js'

export class PostgresStorage implements TemplateStorage {
  private pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString })
  }

  async getTemplateIndex(network: string): Promise<TemplateIndex | null> {
    const result = await this.pool.query(
      'SELECT data FROM template_index WHERE network = $1',
      [network]
    )
    return result.rows[0]?.data ?? null
  }

  async setTemplateIndex(network: string, data: TemplateIndex): Promise<void> {
    await this.pool.query(
      `INSERT INTO template_index (network, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (network) DO UPDATE SET data = $2, updated_at = NOW()`,
      [network, JSON.stringify(data)]
    )
  }

  async getCronMeta(): Promise<CronMeta | null> {
    const result = await this.pool.query('SELECT data FROM cron_meta WHERE id = 1')
    return result.rows[0]?.data ?? null
  }

  async setCronMeta(meta: CronMeta): Promise<void> {
    await this.pool.query(
      `INSERT INTO cron_meta (id, data, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
      [JSON.stringify(meta)]
    )
  }

  async getLastRunTimestamp(): Promise<number | null> {
    // Clean up expired rows first
    await this.pool.query(
      "DELETE FROM cron_state WHERE expires_at IS NOT NULL AND expires_at < NOW()"
    )
    const result = await this.pool.query(
      "SELECT value FROM cron_state WHERE key = 'lastRunTs'"
    )
    return result.rows[0] ? Number(result.rows[0].value) : null
  }

  async setLastRunTimestamp(ts: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO cron_state (key, value)
       VALUES ('lastRunTs', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [String(ts)]
    )
  }

  async acquireLock(ttlSeconds: number): Promise<boolean> {
    // Clean up expired locks
    await this.pool.query(
      "DELETE FROM cron_state WHERE key = 'lock' AND expires_at IS NOT NULL AND expires_at < NOW()"
    )
    try {
      await this.pool.query(
        `INSERT INTO cron_state (key, value, expires_at)
         VALUES ('lock', 'running', NOW() + $1 * INTERVAL '1 second')`,
        [ttlSeconds]
      )
      return true
    } catch {
      // Unique constraint violation = lock already held
      return false
    }
  }

  async releaseLock(): Promise<void> {
    await this.pool.query("DELETE FROM cron_state WHERE key = 'lock'")
  }

  async getCredentials(nodeId: string): Promise<NodeAuthConfig | null> {
    // Local mode: credentials come from CANTON_NODES_AUTH env var only
    if (process.env.CANTON_NODES_AUTH) {
      try {
        const configs = JSON.parse(process.env.CANTON_NODES_AUTH) as Record<string, NodeAuthConfig>
        return configs[nodeId] ?? null
      } catch { /* fall through */ }
    }
    return null
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/db-init.ts server/storage/postgres.ts
git commit -m "feat: add PostgresStorage implementation and DB schema init"
```

---

## Task 5: Indexer Core Logic (Shared Between Vercel and Express)

**Files:**
- Create: `server/routes/indexer.ts`

This extracts the indexing logic from `api/cron/index-templates.ts` into a reusable form that works with the `TemplateStorage` abstraction. The original `api/cron/index-templates.ts` stays untouched for Vercel.

- [ ] **Step 1: Create the indexer route**

Create `server/routes/indexer.ts`:

```typescript
import { Router } from 'express'
import { SignJWT } from 'jose'
import WebSocket from 'ws'
import { getStorage } from '../storage/index.js'
import type { TemplateEntry, NodeAuthConfig } from '../storage/interface.js'

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

function parseTemplateId(templateId: string, packageName: string = ''): TemplateEntry | null {
  const colonIdx = templateId.indexOf(':')
  if (colonIdx < 0) return null
  const packageId = templateId.slice(0, colonIdx)
  const rest = templateId.slice(colonIdx + 1)
  const lastColon = rest.lastIndexOf(':')
  if (lastColon < 0) return null
  return { templateId, packageId, packageName, module: rest.slice(0, lastColon), entity: rest.slice(lastColon + 1) }
}

function streamActiveContracts(
  jsonBase: string, token: string, offset: string | number,
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const wsUrl = jsonBase.replace(/^http/, 'ws') + '/v2/state/active-contracts'
    const ws = new WebSocket(wsUrl, [`jwt.token.${token}`, 'daml.ws.auth'])
    const contracts: Record<string, unknown>[] = []
    const TIMEOUT_MS = 55000 // 55s — no Vercel limit locally, but keep reasonable
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
  const jsonHeaders = { 'Authorization': `Bearer ${jsonToken}`, 'Content-Type': 'application/json' }

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

  // Group by network
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
  // Manual trigger via GET (same as Vercel cron)
  try {
    const result = await runIndexing()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

router.post('/', async (req, res) => {
  const storage = await getStorage()

  // Cooldown check
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

  // Lock
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
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/indexer.ts
git commit -m "feat: add indexer route with shared indexing logic"
```

---

## Task 6: Templates API Route

**Files:**
- Create: `server/routes/templates.ts`

- [ ] **Step 1: Create the templates route**

Create `server/routes/templates.ts`:

```typescript
import { Router } from 'express'
import { getStorage } from '../storage/index.js'

const router = Router()

router.get('/', async (req, res) => {
  const storage = await getStorage()

  // Return cron metadata
  if (req.query.meta === 'true') {
    const meta = await storage.getCronMeta()
    res.setHeader('Cache-Control', 'max-age=30')
    return res.json({ meta: meta ?? null })
  }

  // Return template index by network
  const network = (req.query.network || req.query.nodeId) as string
  if (!network) {
    return res.status(400).json({ error: 'Missing network query param' })
  }

  const index = await storage.getTemplateIndex(network)
  res.setHeader('Cache-Control', 'max-age=60')
  return res.json(index ?? { updatedAt: null, templates: [] })
})

export default router
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/templates.ts
git commit -m "feat: add templates API route for local server"
```

---

## Task 7: Proxy Route

**Files:**
- Create: `server/routes/proxy.ts`

- [ ] **Step 1: Create the proxy route**

Create `server/routes/proxy.ts`. This is a simplified version of `api/proxy.ts` — no session auth (local uses mock admin), no localhost rejection (local needs localhost access):

```typescript
import { Router } from 'express'
import http from 'node:http'
import https from 'node:https'

const router = Router()

function base64urlDecode(str: string): string {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

// Handle /api/proxy/:encodedOrigin/*
router.all('/:encodedOrigin/*', (req, res) => {
  let targetOrigin: string
  try {
    targetOrigin = base64urlDecode(req.params.encodedOrigin)
  } catch {
    return res.status(400).json({ error: 'Invalid base64url-encoded origin' })
  }

  // Everything after the encodedOrigin segment
  const restPath = '/' + (req.params[0] || '')

  // Forward original query params
  const queryParams = new URLSearchParams()
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      value.forEach((v) => queryParams.append(key, String(v)))
    } else if (value) {
      queryParams.append(key, String(value))
    }
  }
  const queryString = queryParams.toString()
  const fullUrl = targetOrigin + restPath + (queryString ? `?${queryString}` : '')

  let targetUrl: URL
  try {
    targetUrl = new URL(fullUrl)
  } catch {
    return res.status(400).json({ error: `Invalid target URL: ${fullUrl}` })
  }

  const isHttps = targetUrl.protocol === 'https:'
  const transport = isHttps ? https : http

  const headers: Record<string, string> = {}
  if (req.headers.authorization) headers['Authorization'] = req.headers.authorization
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type']
  headers['Host'] = targetUrl.host

  const proxyReq = transport.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const contentType = proxyRes.headers['content-type']
      if (contentType) res.setHeader('Content-Type', contentType)
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.status(proxyRes.statusCode ?? 502)
      proxyRes.pipe(res)
    }
  )

  proxyReq.on('error', (err) => {
    console.error(`[proxy] Error proxying to ${fullUrl}:`, err.message)
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy request failed', details: err.message })
    }
  })

  // Pipe request body for POST/PUT/etc
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq)
  } else {
    proxyReq.end()
  }
})

// Handle OPTIONS for CORS preflight
router.options('*', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.status(204).end()
})

export default router
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/proxy.ts
git commit -m "feat: add proxy route for local server"
```

---

## Task 8: Token Exchange Route

**Files:**
- Create: `server/routes/token.ts`

- [ ] **Step 1: Create the token route**

Create `server/routes/token.ts`:

```typescript
import { Router } from 'express'

const router = Router()

interface NodeAuthConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  audience: string
  validatorAudience?: string
}

function getNodeAuthFromEnv(nodeId?: string): NodeAuthConfig | null {
  if (nodeId && process.env.CANTON_NODES_AUTH) {
    try {
      const configs = JSON.parse(process.env.CANTON_NODES_AUTH) as Record<string, NodeAuthConfig>
      if (configs[nodeId]) return configs[nodeId]
    } catch { /* fall through */ }
  }

  const tokenUrl = process.env.CANTON_OAUTH2_TOKEN_URL
  const clientId = process.env.CANTON_OAUTH2_CLIENT_ID
  const clientSecret = process.env.CANTON_OAUTH2_CLIENT_SECRET
  if (!tokenUrl || !clientId || !clientSecret) return null

  return {
    tokenUrl, clientId, clientSecret,
    audience: process.env.CANTON_OAUTH2_AUDIENCE || '',
    validatorAudience: process.env.CANTON_OAUTH2_VALIDATOR_AUDIENCE,
  }
}

router.post('/', async (req, res) => {
  const { audience, nodeId } = req.body ?? {}
  const auth = getNodeAuthFromEnv(nodeId)

  if (!auth) {
    return res.status(500).json({
      error: 'OAuth2 credentials not configured',
      details: nodeId
        ? `No credentials for node "${nodeId}". Configure CANTON_NODES_AUTH env var.`
        : 'Configure CANTON_OAUTH2_* or CANTON_NODES_AUTH env vars.',
    })
  }

  try {
    const response = await fetch(auth.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        audience: audience || auth.audience || '',
      }).toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return res.status(response.status).json({ error: 'Token exchange failed', details: errorText })
    }

    const data = await response.json()
    return res.json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(502).json({ error: 'Failed to contact OAuth2 provider', details: message })
  }
})

export default router
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/token.ts
git commit -m "feat: add token exchange route for local server"
```

---

## Task 9: Cron Scheduler

**Files:**
- Create: `server/cron.ts`

- [ ] **Step 1: Create the cron scheduler**

Create `server/cron.ts`:

```typescript
import cron from 'node-cron'
import { runIndexing } from './routes/indexer.js'

const SCHEDULE = process.env.CRON_SCHEDULE || '*/10 * * * *'

export function startCron(): void {
  console.log(`[cron] Template indexing scheduled: ${SCHEDULE}`)

  cron.schedule(SCHEDULE, async () => {
    console.log(`[cron] Running template indexing at ${new Date().toISOString()}`)
    try {
      const result = await runIndexing()
      const meta = result as Record<string, unknown>
      console.log(`[cron] Indexing complete in ${meta.durationMs}ms`)
    } catch (err) {
      console.error('[cron] Indexing failed:', err instanceof Error ? err.message : err)
    }
  })
}

export async function runInitialIndexing(): Promise<void> {
  console.log('[cron] Running initial template indexing...')
  try {
    const result = await runIndexing()
    const meta = result as Record<string, unknown>
    console.log(`[cron] Initial indexing complete in ${meta.durationMs}ms`)
  } catch (err) {
    console.error('[cron] Initial indexing failed:', err instanceof Error ? err.message : err)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/cron.ts
git commit -m "feat: add node-cron scheduler for template indexing"
```

---

## Task 10: Express Server Entry Point

**Files:**
- Create: `server/index.ts`

- [ ] **Step 1: Create the Express server**

Create `server/index.ts`:

```typescript
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDatabase } from './db-init.js'
import { startCron, runInitialIndexing } from './cron.js'
import templatesRouter from './routes/templates.js'
import indexerRouter from './routes/indexer.js'
import proxyRouter from './routes/proxy.js'
import tokenRouter from './routes/token.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000

async function main() {
  // Initialize PostgreSQL schema if DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    console.log('[server] Initializing PostgreSQL...')
    await initDatabase(process.env.DATABASE_URL)
  }

  const app = express()

  // Parse JSON bodies (needed for POST routes)
  app.use(express.json())

  // CORS headers for all API routes
  app.use('/api', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    next()
  })

  // API routes
  app.use('/api/templates', templatesRouter)
  app.use('/api/cron/index-templates', indexerRouter)
  app.use('/api/proxy', proxyRouter)
  app.use('/api/auth/token', tokenRouter)

  // Serve static files from Vite build output
  const distPath = path.resolve(__dirname, '..', 'dist')
  app.use(express.static(distPath))

  // SPA fallback: serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API route not found' })
    }
    res.sendFile(path.join(distPath, 'index.html'))
  })

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Canton Inspector running at http://localhost:${PORT}`)
  })

  // Start cron scheduler
  startCron()

  // Run initial indexing after a short delay
  setTimeout(() => { runInitialIndexing() }, 5000)
}

main().catch((err) => {
  console.error('[server] Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Verify the server starts locally (without Docker)**

```bash
cd /Users/lehoanganh/Working/FETCH/Angelhack/Canton/canton-local-inspector
yarn build && yarn server
```

Expected: Server starts on port 3000, logs "Canton Inspector running at http://localhost:3000". Initial indexing may fail if no Canton nodes are running — that's OK for now. Press Ctrl+C to stop.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: add Express server entry point with static file serving and cron"
```

---

## Task 11: Docker Configuration

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

Create `.dockerignore`:

```
node_modules
dist
dist-server
.git
.env
*.md
docs
```

- [ ] **Step 2: Create Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000

CMD ["npx", "tsx", "server/index.ts"]
```

- [ ] **Step 3: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: canton_inspector
      POSTGRES_USER: canton
      POSTGRES_PASSWORD: canton
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U canton -d canton_inspector"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql://canton:canton@postgres:5432/canton_inspector
      VITE_DEPLOY_ENV: local
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: add Dockerfile and docker-compose for local deployment"
```

---

## Task 12: Frontend Hook Updates

**Files:**
- Modify: `src/hooks/useCantonQuery.ts`

Remove the `isVercel` gates so the frontend uses the template index API regardless of deploy environment. When running with Docker (Express serves `/api/templates`), the index will be available. When running with `yarn dev` (no Express server), the index will return empty and fall back to live discovery.

- [ ] **Step 1: Update useDiscoverTemplates**

In `src/hooks/useCantonQuery.ts`, replace the `useDiscoverTemplates` function (lines 167-217). Remove the `isVercel` check and always try the index first:

Find this block (lines 167-217):

```typescript
export function useDiscoverTemplates(partyId: string | undefined) {
  const node = useNodeConfig()
  const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'
  return useQuery({
    queryKey: ['discover-templates', node.id, partyId],
    queryFn: async () => {
      // On Vercel: use the cached template index — zero active-contracts queries
      if (isVercel) {
        const networkKey = node.network || node.id
        let index = await api.fetchTemplateIndex(networkKey)
        // Fallback: infer network from node name
        if ((!index.updatedAt || index.templates.length === 0) && !node.network) {
          const nameLower = node.name.toLowerCase()
          const inferred = ['mainnet', 'testnet', 'devnet'].find((n) => nameLower.includes(n))
          if (inferred) {
            const inferredIndex = await api.fetchTemplateIndex(inferred)
            if (inferredIndex.updatedAt && inferredIndex.templates.length > 0) index = inferredIndex
          }
        }
        if (index.templates.length > 0) {
          return index.templates.map((t) => ({
            templateId: t.templateId,
            packageName: t.packageName,
            count: 0, // No count from index — counts come from live queries when user clicks
          }))
        }
      }

      // Local dev fallback: live discovery
      const token = await getToken(node)
      const contracts = await api.discoverAllContracts(node, token, partyId!)
      const templateMap: Record<string, { templateId: string; packageName: string; count: number }> = {}
      for (const c of contracts as ActiveContract[]) {
        const evt = c?.contractEntry?.JsActiveContract?.createdEvent
        if (!evt?.templateId) continue
        const tid = evt.templateId
        if (!templateMap[tid]) {
          templateMap[tid] = {
            templateId: tid,
            packageName: evt.packageName ?? '',
            count: 0,
          }
        }
        templateMap[tid].count++
      }
      return Object.values(templateMap).sort((a, b) => b.count - a.count)
    },
    enabled: !!partyId,
    staleTime: 30000,
  })
}
```

Replace with:

```typescript
export function useDiscoverTemplates(partyId: string | undefined) {
  const node = useNodeConfig()
  return useQuery({
    queryKey: ['discover-templates', node.id, partyId],
    queryFn: async () => {
      // Try the cached template index first (works on both Vercel and local Docker)
      try {
        const networkKey = node.network || node.id
        let index = await api.fetchTemplateIndex(networkKey)
        // Fallback: infer network from node name
        if ((!index.updatedAt || index.templates.length === 0) && !node.network) {
          const nameLower = node.name.toLowerCase()
          const inferred = ['mainnet', 'testnet', 'devnet'].find((n) => nameLower.includes(n))
          if (inferred) {
            const inferredIndex = await api.fetchTemplateIndex(inferred)
            if (inferredIndex.updatedAt && inferredIndex.templates.length > 0) index = inferredIndex
          }
        }
        if (index.templates.length > 0) {
          return index.templates.map((t) => ({
            templateId: t.templateId,
            packageName: t.packageName,
            count: 0,
          }))
        }
      } catch {
        // Index API not available (e.g., running yarn dev without Express server)
      }

      // Fallback: live discovery
      const token = await getToken(node)
      const contracts = await api.discoverAllContracts(node, token, partyId!)
      const templateMap: Record<string, { templateId: string; packageName: string; count: number }> = {}
      for (const c of contracts as ActiveContract[]) {
        const evt = c?.contractEntry?.JsActiveContract?.createdEvent
        if (!evt?.templateId) continue
        const tid = evt.templateId
        if (!templateMap[tid]) {
          templateMap[tid] = {
            templateId: tid,
            packageName: evt.packageName ?? '',
            count: 0,
          }
        }
        templateMap[tid].count++
      }
      return Object.values(templateMap).sort((a, b) => b.count - a.count)
    },
    enabled: !!partyId,
    staleTime: 30000,
  })
}
```

- [ ] **Step 2: Update useTemplateIndex**

Find (lines 241-251):

```typescript
export function useTemplateIndex() {
  const node = useNodeConfig()
  const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'
  return useQuery({
    queryKey: ['template-index', node.network || node.id],
    queryFn: () => api.fetchTemplateIndex(node.network || node.id),
    staleTime: 60000,
    enabled: isVercel,
  })
}
```

Replace with:

```typescript
export function useTemplateIndex() {
  const node = useNodeConfig()
  return useQuery({
    queryKey: ['template-index', node.network || node.id],
    queryFn: () => api.fetchTemplateIndex(node.network || node.id),
    staleTime: 60000,
  })
}
```

- [ ] **Step 3: Update useCronMeta**

Find (lines 253-262):

```typescript
export function useCronMeta() {
  const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'
  return useQuery({
    queryKey: ['cron-meta'],
    queryFn: () => api.fetchCronMeta(),
    staleTime: 30000,
    enabled: isVercel,
  })
}
```

Replace with:

```typescript
export function useCronMeta() {
  return useQuery({
    queryKey: ['cron-meta'],
    queryFn: () => api.fetchCronMeta(),
    staleTime: 30000,
  })
}
```

- [ ] **Step 4: Verify build still passes**

```bash
cd /Users/lehoanganh/Working/FETCH/Angelhack/Canton/canton-local-inspector
yarn build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCantonQuery.ts
git commit -m "feat: enable template index hooks for all deploy environments"
```

---

## Task 13: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add Docker/PostgreSQL env var documentation**

Append the following section to the end of `.env.example`:

```bash

# ─── Docker / Local Server ───────────────────────────────────────────────────
# These are used when running via `docker compose up` or `yarn server`.
# DATABASE_URL is automatically set by docker-compose.yml.

# DATABASE_URL=postgresql://canton:canton@localhost:5433/canton_inspector
# CRON_SCHEDULE=*/10 * * * *
# PORT=3000
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add Docker/PostgreSQL env vars to .env.example"
```

---

## Task 14: End-to-End Verification

- [ ] **Step 1: Verify yarn dev still works (regression test)**

```bash
cd /Users/lehoanganh/Working/FETCH/Angelhack/Canton/canton-local-inspector
yarn dev
```

Expected: Vite dev server starts normally. Template discovery falls back to live queries (no `/api/templates` endpoint in Vite dev mode). Press Ctrl+C to stop.

- [ ] **Step 2: Build and test Docker Compose**

```bash
cd /Users/lehoanganh/Working/FETCH/Angelhack/Canton/canton-local-inspector
docker compose build
docker compose up -d
```

Expected: Both `postgres` and `app` containers start. Check logs:

```bash
docker compose logs -f app
```

Expected output includes:
- `[server] Initializing PostgreSQL...`
- `[db-init] PostgreSQL schema initialized`
- `[server] Canton Inspector running at http://localhost:3000`
- `[cron] Template indexing scheduled: */10 * * * *`
- `[cron] Running initial template indexing...`

- [ ] **Step 3: Verify the app is accessible**

Open http://localhost:3000 in browser. The Canton Inspector UI should load.

- [ ] **Step 4: Verify the templates API works**

```bash
curl http://localhost:3000/api/templates?meta=true
```

Expected: JSON response with cron metadata (or `{ "meta": null }` if no nodes are configured/reachable).

- [ ] **Step 5: Clean up**

```bash
docker compose down
```

- [ ] **Step 6: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end testing"
```
