export declare const LEDGER_GATEWAY_SECRET_HEADER: 'x-ledger-gateway-secret'

export declare function ledgerGatewayHeaders(
  targetOrigin: string,
  secret?: string,
  hostsCsv?: string,
): Record<string, string>

export declare function jsonApiHeaders(
  jsonBase: string,
  token: string,
  secret?: string,
  hostsCsv?: string,
): Record<string, string>
