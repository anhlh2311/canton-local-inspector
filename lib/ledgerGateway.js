export const LEDGER_GATEWAY_SECRET_HEADER = 'x-ledger-gateway-secret'

export function ledgerGatewayHeaders(
  targetOrigin,
  secret = process.env.LEDGER_GATEWAY_SECRET,
  hostsCsv = process.env.LEDGER_GATEWAY_HOSTS,
) {
  const trimmedSecret = secret?.trim()
  const hosts = (hostsCsv ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  if (!trimmedSecret || hosts.length === 0) return {}
  try {
    const host = new URL(targetOrigin).hostname.toLowerCase()
    if (hosts.includes(host)) {
      return { [LEDGER_GATEWAY_SECRET_HEADER]: trimmedSecret }
    }
  } catch {
    /* invalid origin */
  }
  return {}
}

export function jsonApiHeaders(jsonBase, token, secret, hostsCsv) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...ledgerGatewayHeaders(jsonBase, secret, hostsCsv),
  }
}
