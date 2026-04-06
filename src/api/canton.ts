import axios from 'axios'
import type {
  NodeConfig,
  ConnectedSynchronizersResponse,
  LedgerEndResponse,
  VersionResponse,
  UsersResponse,
  UserResponse,
  PartyResponse,
  ParticipantIdResponse,
  PackagesResponse,
  ActiveContractsRequest,
  ActiveContractsResponse,
  ActiveContract,
  DsoPartyResponse,
} from '@/types/canton'

const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'

/** Save OAuth2 credentials server-side in Vercel KV (never stored in browser). */
export async function saveNodeCredentials(nodeId: string, creds: {
  tokenUrl: string; clientId: string; clientSecret: string;
  audience: string; validatorAudience?: string;
}): Promise<void> {
  await axios.post('/api/auth/credentials', { nodeId, ...creds })
}

/** Remove OAuth2 credentials from server-side storage. */
export async function deleteNodeCredentials(nodeId: string): Promise<void> {
  await axios.delete('/api/auth/credentials', { params: { nodeId } })
}

// ---- Template Index (cron-backed) ----

export interface TemplateIndexEntry {
  templateId: string
  packageId: string
  packageName: string
  module: string
  entity: string
}

export interface TemplateIndex {
  updatedAt: string | null
  templates: TemplateIndexEntry[]
}

export interface CronMeta {
  lastRun: string
  durationMs: number
  results: Record<string, { status: string; templateCount: number; error?: string; updatedAt: string }>
}

/** Fetch the pre-built template index by network (from cron job cache). */
export async function fetchTemplateIndex(network: string): Promise<TemplateIndex> {
  const res = await axios.get('/api/templates', { params: { network } })
  return res.data
}

/** Fetch cron job metadata (last run, per-node status). */
export async function fetchCronMeta(): Promise<CronMeta | null> {
  const res = await axios.get('/api/templates', { params: { meta: 'true' } })
  return res.data.meta ?? null
}

/** Manually trigger template index refresh. Pass force=true to skip cooldown.
 *  Sends the current node list so the server can index dynamically-added nodes too. */
export async function triggerIndexRefresh(force?: boolean, nodes?: NodeConfig[]): Promise<Record<string, unknown>> {
  // Send non-secret node config — the server uses this to know which nodes to index.
  // Credentials are looked up server-side from CANTON_NODES_AUTH or Redis.
  const nodeConfigs = nodes?.map((n) => ({
    id: n.id,
    name: n.name,
    network: n.network,
    jsonApiUrl: n.jsonApiUrl,
    jsonApiPort: n.jsonApiPort,
    validatorApiUrl: n.validatorApiUrl,
    validatorApiPort: n.validatorApiPort,
    authMode: n.auth.mode,
    audience: n.auth.mode === 'oauth2' ? n.auth.audience : undefined,
    validatorAudience: n.auth.mode === 'oauth2' ? n.auth.validatorAudience : undefined,
  }))
  const res = await axios.post('/api/cron/index-templates', nodeConfigs ? { nodes: nodeConfigs } : null, {
    params: force ? { force: 'true' } : undefined,
  })
  return res.data
}

function encodeOriginBase64url(origin: string): string {
  return btoa(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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
    const parsed = new URL(url)
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  } catch {
    return url.includes('localhost') || url.includes('127.0.0.1')
  }
}

function getProxyBase(url: string, port: number, nodeId: string, type: 'json' | 'validator'): string {
  const fullUrl = buildFullUrl(url, port)
  const parsed = new URL(fullUrl)
  const pathPrefix = parsed.pathname === '/' ? '' : parsed.pathname

  // Localhost targets
  if (isLocalhost(url)) {
    if (!isVercel) {
      // Local dev: use Vite proxy for CORS
      return `/proxy/${type}/${nodeId}`
    }
    // On Vercel: HTTPS→HTTP mixed content is blocked by browsers.
    // Route through the Vercel proxy anyway — it will fail with a clear error
    // rather than a cryptic ERR_BLOCKED_BY_CLIENT.
    const encoded = encodeOriginBase64url(parsed.origin)
    return `/api/proxy/${encoded}${pathPrefix}`
  }

  // Remote targets: use proxy to avoid CORS
  const encoded = encodeOriginBase64url(parsed.origin)

  if (isVercel) {
    return `/api/proxy/${encoded}${pathPrefix}`
  }

  return `/proxy/remote/${encoded}${pathPrefix}`
}

function createJsonApiClient(node: NodeConfig, token?: string) {
  const baseURL = getProxyBase(node.jsonApiUrl, node.jsonApiPort, node.id, 'json')
  return axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 30000,
  })
}

function createValidatorApiClient(node: NodeConfig, token?: string) {
  const baseURL = getProxyBase(node.validatorApiUrl, node.validatorApiPort, node.id, 'validator')
  return axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 30000,
  })
}

// ---- Version & Health ----

export async function getVersion(node: NodeConfig): Promise<VersionResponse> {
  const client = createJsonApiClient(node)
  const res = await client.get('/v2/version')
  return res.data
}

export async function checkNodeHealth(node: NodeConfig): Promise<{ online: boolean; version?: string; latencyMs: number }> {
  const start = Date.now()
  try {
    const data = await getVersion(node)
    return { online: true, version: data.version, latencyMs: Date.now() - start }
  } catch {
    return { online: false, latencyMs: Date.now() - start }
  }
}

// ---- State Queries ----

export async function getConnectedSynchronizers(node: NodeConfig, token: string): Promise<ConnectedSynchronizersResponse> {
  const client = createJsonApiClient(node, token)
  const res = await client.get('/v2/state/connected-synchronizers')
  return res.data
}

export async function getLedgerEnd(node: NodeConfig, token: string): Promise<LedgerEndResponse> {
  const client = createJsonApiClient(node, token)
  const res = await client.get('/v2/state/ledger-end')
  return res.data
}

export async function getActiveContracts(node: NodeConfig, token: string, request: ActiveContractsRequest): Promise<ActiveContractsResponse> {
  const client = createJsonApiClient(node, token)
  // Fetch ledger end offset if not provided — required by Canton API
  let requestWithOffset = request
  if (!request.activeAtOffset) {
    const ledgerEnd = await client.get('/v2/state/ledger-end')
    requestWithOffset = { ...request, activeAtOffset: ledgerEnd.data.offset }
  }
  try {
    const res = await client.post('/v2/state/active-contracts', requestWithOffset)
    return res.data
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: { code?: string } } }
    if (
      axiosErr.response?.status === 413 ||
      axiosErr.response?.data?.code === 'JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED'
    ) {
      const error = new Error('Too many contracts. Use "Load All" to stream via WebSocket.')
      ;(error as Error & { isLimitError: boolean }).isLimitError = true
      throw error
    }
    throw err
  }
}

/** Stream active contracts via browser-native WebSocket. No 200-element limit.
 *  Called explicitly by UI components when user clicks "Load All".
 *  onProgress callback fires periodically with the current count. */
export function streamActiveContractsWs(
  node: NodeConfig,
  token: string,
  request: ActiveContractsRequest,
  onProgress?: (count: number) => void,
): { promise: Promise<ActiveContract[]>; cancel: () => void } {
  const fullUrl = buildFullUrl(node.jsonApiUrl, node.jsonApiPort)
  const wsUrl = fullUrl.replace(/^http/, 'ws') + '/v2/state/active-contracts'

  // Detect mixed content: HTTPS page cannot connect to ws:// (non-TLS)
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && wsUrl.startsWith('ws://')) {
    const err = new Error(
      `Cannot stream from ${node.name}: mixed content blocked (HTTPS page → WS connection). ` +
      `The Canton node at ${fullUrl} does not support HTTPS/WSS.`
    )
    return { promise: Promise.reject(err), cancel: () => {} }
  }

  console.log('[WS] Connecting to:', wsUrl)
  console.log('[WS] Request:', JSON.stringify(request).slice(0, 500))

  const ws = new WebSocket(wsUrl, [`jwt.token.${token}`, 'daml.ws.auth'])
  const contracts: ActiveContract[] = []
  let cancelled = false

  const TIMEOUT_MS = 120000 // 2 min max
  const timer = setTimeout(() => { console.log('[WS] Timeout after 120s, got', contracts.length); ws.close() }, TIMEOUT_MS)

  const promise = new Promise<ActiveContract[]>((resolve, reject) => {
    ws.onopen = () => {
      console.log('[WS] Connected, sending filter...')
      ws.send(JSON.stringify(request))
    }

    ws.onmessage = (event) => {
      if (cancelled) return
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : '')
        if (msg.code && msg.cause) {
          console.error('[WS] Error frame:', msg.code, String(msg.cause).slice(0, 300))
          clearTimeout(timer)
          ws.close()
          reject(new Error(`${msg.code}: ${String(msg.cause).slice(0, 200)}`))
          return
        }
        contracts.push(msg as ActiveContract)
        if (contracts.length === 1) console.log('[WS] First contract received')
        if (onProgress && contracts.length % 500 === 0) onProgress(contracts.length)
      } catch (e) {
        console.warn('[WS] Parse error:', e, 'data:', String(event.data).slice(0, 200))
      }
    }

    ws.onclose = (event) => {
      clearTimeout(timer)
      console.log('[WS] Closed. Code:', event.code, 'Reason:', event.reason, 'Contracts:', contracts.length)
      if (onProgress) onProgress(contracts.length)
      resolve(contracts)
    }

    ws.onerror = (event) => {
      console.error('[WS] Connection error:', event)
      clearTimeout(timer)
      if (contracts.length > 0) resolve(contracts)
      else reject(new Error('WebSocket connection failed'))
    }
  })

  const cancel = () => {
    cancelled = true
    clearTimeout(timer)
    ws.close()
  }

  return { promise, cancel }
}

function isLimitError(err: unknown): boolean {
  const axiosErr = err as { response?: { status?: number; data?: { code?: string } } }
  return (
    axiosErr.response?.status === 413 ||
    axiosErr.response?.data?.code === 'JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED'
  )
}

/** Discover all active contracts for a party, handling the 200-contract node limit.
 *  Phase 1: Try wildcard query (works if <200 contracts).
 *  Phase 2: If limit hit, discover template IDs by querying known users' parties
 *           (which have fewer contracts), then query each template individually. */
export async function discoverAllContracts(
  node: NodeConfig,
  token: string,
  partyId: string,
): Promise<ActiveContract[]> {
  const client = createJsonApiClient(node, token)
  const ledgerEnd = await client.get('/v2/state/ledger-end')
  const offset = ledgerEnd.data.offset

  // Phase 1: Try wildcard — works if total contracts < 200
  try {
    const res = await client.post('/v2/state/active-contracts', {
      filter: {
        filtersByParty: {
          [partyId]: {
            cumulative: [{
              identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } }
            }]
          }
        }
      },
      verbose: true,
      activeAtOffset: offset,
    })
    return res.data as ActiveContract[]
  } catch (err: unknown) {
    if (!isLimitError(err)) throw err
  }

  // Phase 2: Wildcard hit the 200 limit.
  // Discover template IDs by querying other parties on this node (users typically
  // have far fewer contracts than the DSO party). Then query each template for
  // the target party individually.
  const templateIds = await discoverTemplateIds(node, token, partyId, offset)

  if (templateIds.size === 0) {
    console.warn('[Canton Inspector] Could not discover templates — node has >200 contracts per party. Use manual template query.')
    return []
  }

  // Query each template individually — per-template counts are usually well under 200
  const allContracts: ActiveContract[] = []
  for (const templateId of templateIds) {
    try {
      const res = await client.post('/v2/state/active-contracts', {
        filter: {
          filtersByParty: {
            [partyId]: {
              cumulative: [{
                identifierFilter: {
                  TemplateFilter: { value: { templateId, includeCreatedEventBlob: false } }
                }
              }]
            }
          }
        },
        verbose: true,
        activeAtOffset: offset,
      })
      allContracts.push(...(res.data as ActiveContract[]))
    } catch {
      // Skip templates that fail (e.g., a single template with >200 instances)
    }
  }

  return allContracts
}

// Per-network registry: network → packageName → Set<Module:Entity>
// Cross-network construction only applies within the same network (package hashes differ between networks).
const knownTemplatePatterns: Record<string, Record<string, Set<string>>> = {}

// Per-node: packageId → packageName mapping (discovered from contracts or scan proxy)
const packageNameMap: Record<string, Record<string, string>> = {}

// Node → network mapping (set when discovery runs)
const nodeNetworkMap: Record<string, string> = {}

function getNetworkKey(node: NodeConfig): string {
  return node.network || node.id
}

function learnFromContracts(node: NodeConfig, contracts: ActiveContract[]) {
  const networkKey = getNetworkKey(node)
  nodeNetworkMap[node.id] = networkKey
  if (!packageNameMap[node.id]) packageNameMap[node.id] = {}
  if (!knownTemplatePatterns[networkKey]) knownTemplatePatterns[networkKey] = {}
  for (const c of contracts) {
    const evt = c?.contractEntry?.JsActiveContract?.createdEvent
    if (!evt?.templateId) continue
    const tid = evt.templateId
    const pkgName = evt.packageName ?? ''
    const colonIdx = tid.indexOf(':')
    if (colonIdx < 0) continue
    const pkgId = tid.slice(0, colonIdx)
    const moduleEntity = tid.slice(colonIdx + 1)
    if (pkgName) {
      packageNameMap[node.id][pkgId] = pkgName
      if (!knownTemplatePatterns[networkKey][pkgName]) knownTemplatePatterns[networkKey][pkgName] = new Set()
      knownTemplatePatterns[networkKey][pkgName].add(moduleEntity)
    }
  }
}

function learnFromScanProxy(node: NodeConfig, templateId: string) {
  const networkKey = getNetworkKey(node)
  nodeNetworkMap[node.id] = networkKey
  const colonIdx = templateId.indexOf(':')
  if (colonIdx < 0) return
  const pkgId = templateId.slice(0, colonIdx)
  const moduleEntity = templateId.slice(colonIdx + 1)
  const spliceModuleMap: Record<string, string> = {
    'Splice.Amulet': 'splice-amulet', 'Splice.AmuletRules': 'splice-amulet',
    'Splice.AmuletTransferInstruction': 'splice-amulet', 'Splice.Round': 'splice-amulet',
    'Splice.ValidatorLicense': 'splice-amulet', 'Splice.ValidatorOnboarding': 'splice-amulet',
    'Splice.DsoRules': 'splice-amulet', 'Splice.DSO': 'splice-amulet',
    'Splice.Ans': 'splice-amulet', 'Splice.DecentralizedSynchronizer': 'splice-amulet',
    'Splice.ExternalPartyAmuletRules': 'splice-amulet',
    'Splice.Wallet': 'splice-wallet',
  }
  const moduleName = moduleEntity.split(':')[0]
  for (const [prefix, pkgName] of Object.entries(spliceModuleMap)) {
    if (moduleName === prefix || moduleName.startsWith(prefix + '.')) {
      if (!packageNameMap[node.id]) packageNameMap[node.id] = {}
      packageNameMap[node.id][pkgId] = pkgName
      if (!knownTemplatePatterns[networkKey]) knownTemplatePatterns[networkKey] = {}
      if (!knownTemplatePatterns[networkKey][pkgName]) knownTemplatePatterns[networkKey][pkgName] = new Set()
      knownTemplatePatterns[networkKey][pkgName].add(moduleEntity)
      return
    }
  }
}

/** Construct template IDs for a node by combining its package IDs with known Module:Entity patterns
 *  from the SAME network. Returns full templateId strings (packageId:Module:Entity). */
function constructTemplateIds(node: NodeConfig): Set<string> {
  const result = new Set<string>()
  const networkKey = getNetworkKey(node)
  const nodePkgMap = packageNameMap[node.id] ?? {}
  const networkPatterns = knownTemplatePatterns[networkKey] ?? {}
  for (const [pkgId, pkgName] of Object.entries(nodePkgMap)) {
    const patterns = networkPatterns[pkgName]
    if (patterns) {
      for (const moduleEntity of patterns) {
        result.add(`${pkgId}:${moduleEntity}`)
      }
    }
  }
  return result
}

/** Discover template IDs using a multi-strategy approach:
 *  1. Scan proxy (amulet-rules, mining-rounds) — no 200 limit, discovers core Splice templates
 *  2. filtersForAnyParty wildcard — best single-shot JSON API coverage
 *  3. Per-user-party wildcard — fallback for parties with <200 contracts
 *  4. Cross-network construction — use Module:Entity patterns learned from ANY node
 *     to construct template IDs using this node's package IDs */
async function discoverTemplateIds(
  node: NodeConfig,
  token: string,
  _targetPartyId: string,
  offset: string | number,
): Promise<Set<string>> {
  const client = createJsonApiClient(node, token)
  const templateIds = new Set<string>()

  // Strategy 0: Pre-built index from cron job (Vercel only, fastest path)
  if (isVercel) {
    try {
      // Try network key first, then node ID as fallback
      const networkKey = node.network || node.id
      let index = await fetchTemplateIndex(networkKey)
      // If no index found and network isn't set, try inferring from node name
      if ((!index.updatedAt || index.templates.length === 0) && !node.network) {
        const nameLower = node.name.toLowerCase()
        const inferred = ['mainnet', 'testnet', 'devnet'].find((n) => nameLower.includes(n))
        if (inferred) {
          const inferredIndex = await fetchTemplateIndex(inferred)
          if (inferredIndex.updatedAt && inferredIndex.templates.length > 0) index = inferredIndex
        }
      }
      if (index.updatedAt && index.templates.length > 0) {
        const networkKey = getNetworkKey(node)
        nodeNetworkMap[node.id] = networkKey
        if (!packageNameMap[node.id]) packageNameMap[node.id] = {}
        if (!knownTemplatePatterns[networkKey]) knownTemplatePatterns[networkKey] = {}
        for (const t of index.templates) {
          templateIds.add(t.templateId)
          if (t.packageName) {
            packageNameMap[node.id][t.packageId] = t.packageName
            if (!knownTemplatePatterns[networkKey][t.packageName]) knownTemplatePatterns[networkKey][t.packageName] = new Set()
            knownTemplatePatterns[networkKey][t.packageName].add(`${t.module}:${t.entity}`)
          }
        }
        for (const tid of constructTemplateIds(node)) templateIds.add(tid)
        return templateIds
      }
    } catch { /* Index not available, fall through to live discovery */ }
  }

  function addTemplateIds(contracts: ActiveContract[]) {
    learnFromContracts(node, contracts)
    for (const c of contracts) {
      const tid = c?.contractEntry?.JsActiveContract?.createdEvent?.templateId
      if (tid) templateIds.add(tid)
    }
  }

  // Strategy 1: Scan proxy — discovers core Splice template IDs with NO 200 limit
  if (node.validatorApiUrl) {
    try {
      const valToken = await getValidatorAuthToken(node)
      const valClient = createValidatorApiClient(node, valToken)
      const [amuletRulesRes, roundsRes] = await Promise.allSettled([
        valClient.get('/api/validator/v0/scan-proxy/amulet-rules'),
        valClient.get('/api/validator/v0/scan-proxy/open-and-issuing-mining-rounds'),
      ])
      // Extract template_ids from scan proxy responses
      if (amuletRulesRes.status === 'fulfilled') {
        const tid = amuletRulesRes.value.data?.amulet_rules?.contract?.template_id
        if (tid) { templateIds.add(tid); learnFromScanProxy(node, tid) }
      }
      if (roundsRes.status === 'fulfilled') {
        const data = roundsRes.value.data
        for (const key of Object.keys(data ?? {})) {
          if (Array.isArray(data[key])) {
            for (const r of data[key]) {
              const tid = r?.contract?.template_id
              if (tid) { templateIds.add(tid); learnFromScanProxy(node, tid) }
            }
          }
        }
      }
    } catch { /* Scan proxy not available — continue */ }
  }

  const wildcardFilter = { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }

  // Strategy 2: filtersForAnyParty wildcard — single query, max coverage
  try {
    const res = await client.post('/v2/state/active-contracts', {
      filter: { filtersForAnyParty: { cumulative: [wildcardFilter] } },
      verbose: false,
      activeAtOffset: offset,
    })
    addTemplateIds(res.data as ActiveContract[])
    // Construct additional templates from cross-network knowledge
    for (const tid of constructTemplateIds(node)) templateIds.add(tid)
    return templateIds
  } catch { /* Hit 200 limit */ }

  // Strategy 3: Per-user-party wildcard (stop on first success)
  try {
    const usersRes = await listAllUsers(node, token, { batchSize: 100, maxUsers: 20 })
    const parties: string[] = []
    const seen = new Set<string>()
    for (const entry of usersRes.users ?? []) {
      const u = (entry as Record<string, unknown>)?.user as Record<string, unknown> | undefined
      const party = ((u?.primaryParty ?? (entry as Record<string, unknown>)?.primaryParty) as string) ?? ''
      if (party && !seen.has(party)) { seen.add(party); parties.push(party) }
    }
    for (let i = 0; i < parties.length; i += 5) {
      const batch = parties.slice(i, i + 5)
      const results = await Promise.allSettled(
        batch.map((party) =>
          client.post('/v2/state/active-contracts', {
            filter: { filtersByParty: { [party]: { cumulative: [wildcardFilter] } } },
            verbose: false,
            activeAtOffset: offset,
          })
        )
      )
      let found = false
      for (const result of results) {
        if (result.status === 'fulfilled') {
          addTemplateIds(result.value.data as ActiveContract[])
          found = true
        }
      }
      if (found) break
    }
  } catch { /* continue */ }

  // Strategy 4: Cross-network construction — use learned patterns from other nodes
  for (const tid of constructTemplateIds(node)) templateIds.add(tid)

  return templateIds
}

// ---- Users & Parties ----

export async function listUsers(node: NodeConfig, token: string, pageSize: number = 500, pageToken?: string): Promise<UsersResponse> {
  const client = createJsonApiClient(node, token)
  let url = `/v2/users?pageSize=${pageSize}`
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`
  const res = await client.get(url)
  return res.data
}

/** Fetch ALL users by auto-paginating until no nextPageToken remains.
 *  Uses batches of `batchSize` (default 500) per request.
 *  Reports progress via optional callback so UI can show incremental results. */
export async function listAllUsers(
  node: NodeConfig,
  token: string,
  opts?: { batchSize?: number; maxUsers?: number; onProgress?: (loaded: number) => void },
): Promise<UsersResponse> {
  const batchSize = opts?.batchSize ?? 500
  const maxUsers = opts?.maxUsers ?? Infinity
  const allUsers: UsersResponse['users'] = []
  let pageToken: string | undefined

  do {
    const page = await listUsers(node, token, batchSize, pageToken)
    const users = page.users ?? []
    allUsers.push(...users)
    opts?.onProgress?.(allUsers.length)
    pageToken = page.nextPageToken || undefined

    if (allUsers.length >= maxUsers) break
    // Safety: if a page returned nothing, stop to avoid infinite loops
    if (users.length === 0) break
  } while (pageToken)

  return { users: allUsers, nextPageToken: undefined }
}

export async function getUser(node: NodeConfig, token: string, userId: string): Promise<UserResponse> {
  const client = createJsonApiClient(node, token)
  const res = await client.get(`/v2/users/${encodeURIComponent(userId)}`)
  return res.data
}

export async function getParty(node: NodeConfig, token: string, partyId: string): Promise<PartyResponse> {
  const client = createJsonApiClient(node, token)
  const res = await client.get(`/v2/parties/party?parties=${encodeURIComponent(partyId)}`)
  return res.data
}

export async function listParties(node: NodeConfig, token: string, pageSize: number = 200, pageToken?: string): Promise<PartyResponse> {
  const client = createJsonApiClient(node, token)
  let url = `/v2/parties?pageSize=${pageSize}`
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`
  const res = await client.get(url)
  return res.data
}

export async function getParticipantId(node: NodeConfig, token: string): Promise<ParticipantIdResponse> {
  const client = createJsonApiClient(node, token)
  const res = await client.get('/v2/parties/participant-id')
  return res.data
}

// ---- User Rights ----

export async function grantReadAsAnyParty(node: NodeConfig, token: string, userId: string = 'ledger-api-user'): Promise<void> {
  const client = createJsonApiClient(node, token)
  try {
    await client.post(`/v2/users/${encodeURIComponent(userId)}/rights`, {
      userId,
      identityProviderId: '',
      rights: [{ kind: { CanReadAsAnyParty: { value: {} } } }],
    })
  } catch (e: unknown) {
    // Ignore if already granted (409) or other non-critical errors
    const err = e as { response?: { status?: number; data?: unknown }; message?: string }
    if (err?.response?.status !== 409) {
      console.warn(`[Canton Inspector] Could not grant CanReadAsAnyParty to ${userId} on ${node.name}:`, err?.response?.data ?? err.message)
    }
  }
}

// ---- Packages ----

export async function listPackages(node: NodeConfig, token: string): Promise<PackagesResponse> {
  const client = createJsonApiClient(node, token)
  const res = await client.get('/v2/packages')
  return res.data
}

export interface PackageInfo {
  packageId: string
  packageName: string
  templates: { templateId: string; moduleName: string; entityName: string; activeCount: number }[]
}

export async function discoverPackageInfo(
  node: NodeConfig,
  token: string,
  partyId: string,
): Promise<PackageInfo[]> {
  // Use paginated discovery that handles the 200-contract limit
  const contracts = await discoverAllContracts(node, token, partyId)

  // Build package map from contract events
  const packageMap: Record<string, PackageInfo> = {}

  for (const c of contracts) {
    const evt = c?.contractEntry?.JsActiveContract?.createdEvent
    if (!evt) continue

    const templateId: string = evt.templateId ?? ''
    const packageName: string = evt.packageName ?? ''

    // templateId format: "packageId:ModuleName:EntityName"
    const parts = templateId.split(':')
    if (parts.length < 3) continue

    const packageId = parts[0]
    const moduleName = parts.slice(1, parts.length - 1).join(':')
    const entityName = parts[parts.length - 1]

    if (!packageMap[packageId]) {
      packageMap[packageId] = { packageId, packageName, templates: [] }
    }

    const pkg = packageMap[packageId]
    if (!pkg.packageName && packageName) pkg.packageName = packageName

    const existing = pkg.templates.find((t) => t.templateId === templateId)
    if (existing) {
      existing.activeCount++
    } else {
      pkg.templates.push({ templateId, moduleName, entityName, activeCount: 1 })
    }
  }

  return Object.values(packageMap).sort((a, b) => b.templates.length - a.templates.length)
}

// ---- Validator / Scan Proxy ----

export async function getDsoPartyId(node: NodeConfig, token?: string): Promise<DsoPartyResponse> {
  const client = createValidatorApiClient(node, token)
  const res = await client.get('/api/validator/v0/scan-proxy/dso-party-id')
  return res.data
}

// ---- JWT Token Generation (supports shared-secret and OAuth2) ----

import { SignJWT } from 'jose'

// Token cache keyed by nodeId + audience variant
const tokenCache: Record<string, { token: string; expiresAt: number }> = {}

async function fetchOAuth2Token(node: NodeConfig, audience: string): Promise<string> {
  if (node.auth.mode !== 'oauth2') throw new Error('Not OAuth2')

  const isClientOwned = node.auth.credentialOwnership === 'client'

  // Client-owned credentials: exchange token directly with OAuth provider from browser.
  // The client secret NEVER touches our backend — only the resulting access token does (via proxy).
  if (isClientOwned && node.auth.tokenUrl && node.auth.clientId && node.auth.clientSecret) {
    return fetchOAuth2TokenDirect(node.auth.tokenUrl, node.auth.clientId, node.auth.clientSecret, audience)
  }

  // Both Vercel and local dev: use the /api/auth/token endpoint.
  // On Vercel: served by the serverless function (reads CANTON_NODES_AUTH from env or Redis).
  // On local dev: served by the Vite dev server plugin (reads CANTON_NODES_AUTH from .env).
  // Client secret never touches the browser — only nodeId and audience are sent.
  const res = await axios.post('/api/auth/token', { audience, nodeId: node.id })
  return res.data.access_token
}

/** Exchange OAuth2 credentials directly with the provider from the browser.
 *  Used for editor-owned nodes — the client secret never touches our backend.
 *  Falls back to Vite proxy on local dev (for CORS). */
async function fetchOAuth2TokenDirect(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  audience: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    audience,
  }).toString()

  // Try direct fetch first (works if OAuth provider has CORS enabled)
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (res.ok) {
      const data = await res.json()
      return data.access_token
    }
    // If we get a non-CORS error (e.g., 401), throw it
    if (res.status !== 0) {
      throw new Error(`OAuth2 token exchange failed: ${res.status}`)
    }
  } catch (err) {
    // CORS error manifests as TypeError: Failed to fetch
    // Fall through to proxy
    if (!(err instanceof TypeError)) throw err
  }

  // CORS blocked — use proxy (on Vercel) or Vite proxy (local dev) as passthrough
  // NOTE: This means the proxy sees the client secret. We log a warning.
  console.warn('[auth] Direct OAuth2 exchange blocked by CORS — falling back to proxy. The client secret will pass through the server.')
  if (isVercel) {
    // Use the Vercel proxy to reach the OAuth provider
    const urlObj = new URL(tokenUrl)
    const encoded = btoa(urlObj.origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const res = await axios.post(
      `/api/proxy/${encoded}${urlObj.pathname}`,
      body,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    return res.data.access_token
  } else {
    const urlObj = new URL(tokenUrl)
    const encoded = encodeOriginBase64url(urlObj.origin)
    const res = await axios.post(
      `/proxy/oauth2-token/${encoded}${urlObj.pathname}`,
      body,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    return res.data.access_token
  }
}

function getCachedToken(cacheKey: string): string | null {
  const cached = tokenCache[cacheKey]
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token
  return null
}

export async function getAuthToken(node: NodeConfig): Promise<string> {
  const cacheKey = `${node.id}:json`
  const cached = getCachedToken(cacheKey)
  if (cached) return cached

  if (node.auth.mode === 'shared-secret') {
    const { userId, secret, audience, issuer } = node.auth
    const secretKey = new TextEncoder().encode(secret)
    const token = await new SignJWT({
      sub: userId,
      aud: audience,
      iss: issuer,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(secretKey)

    tokenCache[cacheKey] = { token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }
    return token
  }

  if (node.auth.mode === 'oauth2') {
    const token = await fetchOAuth2Token(node, node.auth.audience)
    tokenCache[cacheKey] = { token, expiresAt: Date.now() + 3600 * 1000 }
    return token
  }

  throw new Error(`Unknown auth mode: ${(node.auth as { mode: string }).mode}`)
}

/** Get auth token for the validator API — uses validatorAudience if configured */
export async function getValidatorAuthToken(node: NodeConfig): Promise<string> {
  // If no separate validator audience, reuse the main token
  if (node.auth.mode !== 'oauth2' || !node.auth.validatorAudience) {
    return getAuthToken(node)
  }

  const cacheKey = `${node.id}:validator`
  const cached = getCachedToken(cacheKey)
  if (cached) return cached

  const token = await fetchOAuth2Token(node, node.auth.validatorAudience)
  tokenCache[cacheKey] = { token, expiresAt: Date.now() + 3600 * 1000 }
  return token
}

// Keep backward compatibility — deprecated, use getAuthToken instead
export async function generateSharedSecretToken(): Promise<string> {
  // Fallback for old callers that don't pass a node
  const secretKey = new TextEncoder().encode('unsafe')
  return new SignJWT({
    sub: 'ledger-api-user',
    aud: 'https://canton.network.global',
    iss: 'unsafe-auth',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secretKey)
}

// ---- Helper: Build active contracts filter ----

export function buildAnyPartyTemplateFilter(templateId: string, activeAtOffset?: string): ActiveContractsRequest {
  return {
    filter: {
      filtersForAnyParty: {
        cumulative: [{
          identifierFilter: {
            TemplateFilter: {
              value: { templateId, includeCreatedEventBlob: false }
            }
          }
        }]
      }
    },
    verbose: true,
    ...(activeAtOffset ? { activeAtOffset } : {}),
  }
}

export function buildTemplateFilter(partyId: string, templateId: string, activeAtOffset?: string): ActiveContractsRequest {
  return {
    filter: {
      filtersByParty: {
        [partyId]: {
          cumulative: [{
            identifierFilter: {
              TemplateFilter: {
                value: { templateId, includeCreatedEventBlob: false }
              }
            }
          }]
        }
      }
    },
    verbose: true,
    ...(activeAtOffset ? { activeAtOffset } : {}),
  }
}

export function buildInterfaceFilter(partyId: string, interfaceId: string): ActiveContractsRequest {
  return {
    filter: {
      filtersByParty: {
        [partyId]: {
          cumulative: [{
            identifierFilter: {
              InterfaceFilter: {
                value: { interfaceId, includeCreatedEventBlob: false, includeInterfaceView: true }
              }
            }
          }]
        }
      }
    },
    verbose: true,
  }
}

export function buildWildcardFilter(partyId: string): ActiveContractsRequest {
  return {
    filter: {
      filtersByParty: {
        [partyId]: {
          cumulative: [{
            identifierFilter: {
              WildcardFilter: { value: { includeCreatedEventBlob: false } }
            }
          }]
        }
      }
    },
    verbose: true,
  }
}
