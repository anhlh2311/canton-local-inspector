const LIGHTHOUSE_MAINNET_HOST = 'lighthouse.xyz'

function isLighthouseMainnet(targetOrigin) {
  try {
    return new URL(targetOrigin).hostname === LIGHTHOUSE_MAINNET_HOST
  } catch {
    return false
  }
}

function lighthouseAuthorizationValue(apiKey) {
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!trimmed) return undefined
  const token = trimmed.replace(/^bearer\s+/i, '').trim()
  if (!token) return undefined
  return `Bearer ${token}`
}

/**
 * Attach the Loop Data API key only for lighthouse.xyz.
 * A caller Authorization (Canton ledger JWT) is dropped on that host.
 * Devnet and every other origin are returned unchanged.
 */
export function applyLighthouseAuth(headers, targetOrigin, apiKey = process.env.LIGHTHOUSE_API_KEY) {
  if (!isLighthouseMainnet(targetOrigin)) return headers
  const next = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') continue
    next[key] = value
  }
  const authorization = lighthouseAuthorizationValue(apiKey)
  if (authorization) next.Authorization = authorization
  return next
}
