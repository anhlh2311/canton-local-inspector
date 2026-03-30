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
    // Canton returns 413 or error code when results exceed the node limit (typically 200)
    // For wildcard queries that hit this limit, we need to paginate by template
    if (
      axiosErr.response?.status === 413 ||
      axiosErr.response?.data?.code === 'JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED'
    ) {
      // Check if this is a wildcard query — if so, we can't paginate it easily
      // Rethrow with a helpful message
      const error = new Error(
        'Too many contracts. The Canton node limits responses to 200 contracts. ' +
        'Try querying by specific template instead of using wildcard discovery.'
      )
      ;(error as Error & { isLimitError: boolean }).isLimitError = true
      throw error
    }
    throw err
  }
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

/** Discover template IDs using multiple strategies in parallel:
 *  1. Query each user's party with wildcard (users have fewer contracts than DSO)
 *  2. Collect all unique template IDs across successful queries
 *  Runs queries concurrently (batches of 5) for speed. */
async function discoverTemplateIds(
  node: NodeConfig,
  token: string,
  _targetPartyId: string,
  offset: string | number,
): Promise<Set<string>> {
  const client = createJsonApiClient(node, token)
  const templateIds = new Set<string>()

  function extractTemplateIds(contracts: ActiveContract[]) {
    for (const c of contracts) {
      const tid = c?.contractEntry?.JsActiveContract?.createdEvent?.templateId
      if (tid) templateIds.add(tid)
    }
  }

  // Get all users to find parties with fewer contracts
  let parties: string[]
  try {
    const usersRes = await listAllUsers(node, token, { batchSize: 100, maxUsers: 50 })
    const partySet = new Set<string>()
    for (const entry of usersRes.users ?? []) {
      const u = (entry as Record<string, unknown>)?.user as Record<string, unknown> | undefined
      const party = ((u?.primaryParty ?? (entry as Record<string, unknown>)?.primaryParty) as string) ?? ''
      if (party) partySet.add(party)
    }
    parties = [...partySet]
  } catch {
    return templateIds
  }

  // Query parties in parallel batches of 5 for speed
  const BATCH_SIZE = 5
  for (let i = 0; i < parties.length; i += BATCH_SIZE) {
    const batch = parties.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((party) =>
        client.post('/v2/state/active-contracts', {
          filter: {
            filtersByParty: {
              [party]: {
                cumulative: [{
                  identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } }
                }]
              }
            }
          },
          verbose: false,
          activeAtOffset: offset,
        })
      )
    )
    for (const result of results) {
      if (result.status === 'fulfilled') {
        extractTemplateIds(result.value.data as ActiveContract[])
      }
      // Skip failed queries (party has >200 contracts)
    }
  }

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

  if (isVercel) {
    // On Vercel: use serverless function — secrets stay server-side
    const res = await axios.post('/api/auth/token', { audience, nodeId: node.id })
    return res.data.access_token
  }

  // Local dev: proxy through Vite (client has the credentials in node config)
  const { tokenUrl, clientId, clientSecret } = node.auth
  const urlObj = new URL(tokenUrl)
  const origin = urlObj.origin
  const pathname = urlObj.pathname
  const encoded = encodeOriginBase64url(origin)

  const res = await axios.post(
    `/proxy/oauth2-token/${encoded}${pathname}`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  return res.data.access_token
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

export function buildTemplateFilter(partyId: string, templateId: string): ActiveContractsRequest {
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
