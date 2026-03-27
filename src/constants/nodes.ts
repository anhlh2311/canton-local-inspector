import type { NodeConfig } from '@/types/canton'

const defaultAuth = {
  mode: 'shared-secret' as const,
  userId: 'ledger-api-user',
  secret: 'unsafe',
  audience: 'https://canton.network.global',
  issuer: 'unsafe-auth',
}

export const DEFAULT_NODES: NodeConfig[] = [
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

// Template IDs are discovered dynamically from the ledger via wildcard queries.
// No hardcoded templates — they vary by deployment.
