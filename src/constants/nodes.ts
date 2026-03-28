import type { NodeConfig, AuthConfig } from '@/types/canton'

const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'

const defaultAuth: AuthConfig = {
  mode: 'shared-secret',
  userId: 'ledger-api-user',
  secret: 'unsafe',
  audience: 'https://canton.network.global',
  issuer: 'unsafe-auth',
}

/** Local development nodes (Canton Quickstart) */
const LOCAL_NODES: NodeConfig[] = [
  {
    id: 'trading-partner',
    name: 'Trading Partner',
    jsonApiUrl: 'http://localhost',
    jsonApiPort: 1975,
    validatorApiUrl: 'http://localhost',
    validatorApiPort: 1903,
    ledgerApiPort: 1901,
    color: '#3b82f6',
    auth: { ...defaultAuth },
  },
  {
    id: 'app-user',
    name: 'App User',
    jsonApiUrl: 'http://localhost',
    jsonApiPort: 2975,
    validatorApiUrl: 'http://localhost',
    validatorApiPort: 2903,
    ledgerApiPort: 2901,
    color: '#22c55e',
    auth: { ...defaultAuth },
  },
  {
    id: 'app-provider',
    name: 'App Provider',
    jsonApiUrl: 'http://localhost',
    jsonApiPort: 3975,
    validatorApiUrl: 'http://localhost',
    validatorApiPort: 3903,
    ledgerApiPort: 3901,
    color: '#f59e0b',
    auth: { ...defaultAuth },
  },
  {
    id: 'super-validator',
    name: 'Super Validator',
    jsonApiUrl: 'http://localhost',
    jsonApiPort: 4975,
    validatorApiUrl: 'http://localhost',
    validatorApiPort: 4903,
    ledgerApiPort: 4901,
    color: '#a855f7',
    auth: { ...defaultAuth },
  },
]

/** Build a pre-configured node from Vercel environment variables */
function getVercelNode(): NodeConfig | null {
  const jsonApiUrl = import.meta.env.VITE_JSON_API_URL
  const validatorApiUrl = import.meta.env.VITE_VALIDATOR_API_URL
  if (!jsonApiUrl) return null

  const authMode = import.meta.env.VITE_AUTH_MODE || 'oauth2'
  const auth: AuthConfig = authMode === 'shared-secret'
    ? { ...defaultAuth }
    : {
        mode: 'oauth2',
        // On Vercel these are handled server-side — client doesn't need the actual secrets
        tokenUrl: '',
        clientId: '',
        clientSecret: '',
        audience: import.meta.env.VITE_AUDIENCE || '',
        validatorAudience: import.meta.env.VITE_VALIDATOR_AUDIENCE || undefined,
      }

  return {
    id: 'vercel-node',
    name: import.meta.env.VITE_NODE_NAME || 'Remote Validator',
    jsonApiUrl,
    jsonApiPort: 0,
    validatorApiUrl: validatorApiUrl || '',
    validatorApiPort: 0,
    ledgerApiPort: 0,
    color: import.meta.env.VITE_NODE_COLOR || '#ec4899',
    auth,
  }
}

/** Default nodes based on deployment environment */
export const DEFAULT_NODES: NodeConfig[] = (() => {
  if (isVercel) {
    const vercelNode = getVercelNode()
    return vercelNode ? [vercelNode] : []
  }
  return LOCAL_NODES
})()

// Template IDs are discovered dynamically from the ledger via wildcard queries.
// No hardcoded templates — they vary by deployment.
