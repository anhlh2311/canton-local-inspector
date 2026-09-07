export declare const LEDGER_GATEWAY_SECRET_HEADER: 'x-ledger-gateway-secret'

export declare function ledgerGatewayHeaders(
  targetOrigin: string,
  secret?: string,
  hostsCsv?: string,
): Record<string, string>
