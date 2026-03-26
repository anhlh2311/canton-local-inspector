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

function createJsonApiClient(node: NodeConfig, token?: string) {
  // Use Vite proxy to avoid CORS: /proxy/json/{nodeId}/... -> localhost:{port}/...
  return axios.create({
    baseURL: `/proxy/json/${node.id}`,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 30000,
  })
}

function createValidatorApiClient(node: NodeConfig, token?: string) {
  // Use Vite proxy to avoid CORS: /proxy/validator/{nodeId}/... -> localhost:{port}/...
  return axios.create({
    baseURL: `/proxy/validator/${node.id}`,
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
  const res = await client.post('/v2/state/active-contracts', requestWithOffset)
  return res.data
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
  const client = createJsonApiClient(node, token)

  // Get ledger end offset
  const ledgerEnd = await client.get('/v2/state/ledger-end')
  const offset = ledgerEnd.data.offset

  // Query all active contracts via wildcard
  const res = await client.post('/v2/state/active-contracts', {
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
    activeAtOffset: offset,
  })

  // Build package map from contract events
  const packageMap: Record<string, PackageInfo> = {}

  for (const c of res.data as ActiveContract[]) {
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

// ---- JWT Token Generation (for shared-secret auth) ----

import { SignJWT } from 'jose'

let cachedToken: { token: string; expiresAt: number } | null = null

export async function generateSharedSecretToken(
  userId: string = 'ledger-api-user',
  audience: string = 'https://canton.network.global',
  secret: string = 'unsafe',
): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token
  }

  const secretKey = new TextEncoder().encode(secret)
  const token = await new SignJWT({
    sub: userId,
    aud: audience,
    iss: 'unsafe-auth',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secretKey)

  cachedToken = { token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }
  return token
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
