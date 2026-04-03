import type { NodeConfig, AuthConfig } from '@/types/canton'

const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'

const defaultSharedSecretAuth: AuthConfig = {
  mode: 'shared-secret',
  userId: 'ledger-api-user',
  secret: 'unsafe',
  audience: 'https://canton.network.global',
  issuer: 'unsafe-auth',
}

/**
 * Parse nodes from VITE_NODES environment variable (JSON array).
 *
 * Format:
 * VITE_NODES='[
 *   {"id":"node1","name":"My Node","jsonApiUrl":"http://localhost","jsonApiPort":1975,
 *    "validatorApiUrl":"http://localhost","validatorApiPort":1903,"color":"#3b82f6",
 *    "authMode":"shared-secret"},
 *   {"id":"devnet","name":"Devnet","jsonApiUrl":"http://1.2.3.4:7575/api/json-api",
 *    "validatorApiUrl":"http://1.2.3.4:5003","color":"#ec4899",
 *    "authMode":"oauth2","audience":"https://my-audience","validatorAudience":"https://my-val-audience"}
 * ]'
 */
function parseNodesFromEnv(): NodeConfig[] | null {
  let raw = import.meta.env.VITE_NODES as string | undefined
  if (!raw) return null

  // Strip surrounding quotes that .env parsers may include
  raw = raw.trim()
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    raw = raw.slice(1, -1)
  }

  try {
    const nodes = JSON.parse(raw) as Record<string, unknown>[]
    return nodes.map((n, i) => {
      const authMode = (n.authMode as string) || 'shared-secret'
      const auth: AuthConfig = authMode === 'oauth2'
        ? {
            mode: 'oauth2',
            tokenUrl: (n.tokenUrl as string) || '',
            clientId: (n.clientId as string) || '',
            clientSecret: (n.clientSecret as string) || '',
            audience: (n.audience as string) || '',
            validatorAudience: (n.validatorAudience as string) || undefined,
          }
        : {
            mode: 'shared-secret',
            userId: (n.userId as string) || 'ledger-api-user',
            secret: (n.secret as string) || 'unsafe',
            audience: (n.audience as string) || 'https://canton.network.global',
            issuer: (n.issuer as string) || 'unsafe-auth',
          }

      return {
        id: (n.id as string) || `env-node-${i}`,
        name: (n.name as string) || `Node ${i + 1}`,
        network: (n.network as string as NodeConfig['network']) || undefined,
        _preconfigured: true,
        jsonApiUrl: (n.jsonApiUrl as string) || 'http://localhost',
        jsonApiPort: Number(n.jsonApiPort) || 0,
        validatorApiUrl: (n.validatorApiUrl as string) || '',
        validatorApiPort: Number(n.validatorApiPort) || 0,
        ledgerApiPort: Number(n.ledgerApiPort) || 0,
        color: (n.color as string) || '#6366f1',
        auth,
        adminUser: (n.adminUser as string) || undefined,
        globalSynchronizerId: (n.globalSynchronizerId as string) || undefined,
      }
    })
  } catch (e) {
    console.warn('[Canton Inspector] Failed to parse VITE_NODES:', e)
    return null
  }
}

/** Parse a single node from individual VITE_* env vars (legacy/simple format) */
function parseSingleNodeFromEnv(): NodeConfig | null {
  const jsonApiUrl = import.meta.env.VITE_JSON_API_URL
  if (!jsonApiUrl) return null

  const authMode = (import.meta.env.VITE_AUTH_MODE as string) || 'oauth2'
  const auth: AuthConfig = authMode === 'shared-secret'
    ? {
        mode: 'shared-secret' as const,
        userId: (import.meta.env.VITE_AUTH_USER_ID as string) || 'ledger-api-user',
        secret: (import.meta.env.VITE_AUTH_SECRET as string) || 'unsafe',
        audience: (import.meta.env.VITE_AUDIENCE as string) || 'https://canton.network.global',
        issuer: (import.meta.env.VITE_AUTH_ISSUER as string) || 'unsafe-auth',
      }
    : {
        mode: 'oauth2' as const,
        tokenUrl: (import.meta.env.VITE_AUTH_TOKEN_URL as string) || '',
        clientId: (import.meta.env.VITE_AUTH_CLIENT_ID as string) || '',
        clientSecret: (import.meta.env.VITE_AUTH_CLIENT_SECRET as string) || '',
        audience: (import.meta.env.VITE_AUDIENCE as string) || '',
        validatorAudience: (import.meta.env.VITE_VALIDATOR_AUDIENCE as string) || undefined,
      }

  return {
    id: 'env-node',
    name: import.meta.env.VITE_NODE_NAME || 'Remote Validator',
    _preconfigured: true,
    jsonApiUrl,
    jsonApiPort: Number(import.meta.env.VITE_JSON_API_PORT) || 0,
    validatorApiUrl: import.meta.env.VITE_VALIDATOR_API_URL || '',
    validatorApiPort: Number(import.meta.env.VITE_VALIDATOR_API_PORT) || 0,
    ledgerApiPort: 0,
    color: import.meta.env.VITE_NODE_COLOR || '#ec4899',
    auth,
  }
}

/** Fallback local quickstart nodes (used when no env vars are set) */
const QUICKSTART_NODES: NodeConfig[] = [
  {
    id: 'trading-partner',
    name: 'Trading Partner',
    network: 'local',
    _preconfigured: true,
    jsonApiUrl: 'http://localhost',
    jsonApiPort: 1975,
    validatorApiUrl: 'http://localhost',
    validatorApiPort: 1903,
    ledgerApiPort: 1901,
    color: '#3b82f6',
    auth: { ...defaultSharedSecretAuth },
  },
  {
    id: 'app-user',
    name: 'App User',
    network: 'local',
    _preconfigured: true,
    jsonApiUrl: 'http://localhost',
    jsonApiPort: 2975,
    validatorApiUrl: 'http://localhost',
    validatorApiPort: 2903,
    ledgerApiPort: 2901,
    color: '#22c55e',
    auth: { ...defaultSharedSecretAuth },
  },
  {
    id: 'app-provider',
    name: 'App Provider',
    network: 'local',
    _preconfigured: true,
    jsonApiUrl: 'http://localhost',
    jsonApiPort: 3975,
    validatorApiUrl: 'http://localhost',
    validatorApiPort: 3903,
    ledgerApiPort: 3901,
    color: '#f59e0b',
    auth: { ...defaultSharedSecretAuth },
  },
  {
    id: 'super-validator',
    name: 'Super Validator',
    network: 'local',
    _preconfigured: true,
    jsonApiUrl: 'http://localhost',
    jsonApiPort: 4975,
    validatorApiUrl: 'http://localhost',
    validatorApiPort: 4903,
    ledgerApiPort: 4901,
    color: '#a855f7',
    auth: { ...defaultSharedSecretAuth },
  },
]

/**
 * Default nodes resolution order:
 * 1. VITE_NODES (JSON array) — supports multiple nodes of any type
 * 2. VITE_JSON_API_URL (single node) — simple format for one remote node
 * 3. Quickstart local nodes (fallback when no env vars set, local dev only)
 */
export const DEFAULT_NODES: NodeConfig[] = (() => {
  // Priority 1: VITE_NODES JSON array
  const nodesFromJson = parseNodesFromEnv()
  if (nodesFromJson && nodesFromJson.length > 0) return nodesFromJson

  // Priority 2: Single node from individual VITE_* vars
  const singleNode = parseSingleNodeFromEnv()
  if (singleNode) return [singleNode]

  // Priority 3: Quickstart fallback (local dev only)
  if (!isVercel) return QUICKSTART_NODES

  return []
})()

// Template IDs are discovered dynamically from the ledger via wildcard queries.
// No hardcoded templates — they vary by deployment.
