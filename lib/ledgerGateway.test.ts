import { describe, expect, it } from 'vitest'
import { LEDGER_GATEWAY_SECRET_HEADER, jsonApiHeaders, ledgerGatewayHeaders } from './ledgerGateway.js'

describe('ledgerGatewayHeaders', () => {
  it('is empty when secret or hosts are missing', () => {
    expect(ledgerGatewayHeaders('https://gw.example', '', 'gw.example')).toEqual({})
    expect(ledgerGatewayHeaders('https://gw.example', 's3cret', '')).toEqual({})
  })

  it('attaches the secret only for configured gateway hosts', () => {
    expect(ledgerGatewayHeaders('https://gw.example/api/json-api', 's3cret', 'gw.example,other.example')).toEqual({
      [LEDGER_GATEWAY_SECRET_HEADER]: 's3cret',
    })
    expect(ledgerGatewayHeaders('https://ledger.internal', 's3cret', 'gw.example')).toEqual({})
  })

  it('matches a token URL path against a gateway hostname', () => {
    const tokenUrl =
      'https://inspector-auth.madeintoilet.com/kairo/auth/realms/catalyst-canton/protocol/openid-connect/token'
    expect(
      ledgerGatewayHeaders(
        tokenUrl,
        's3cret',
        'inspector-ledger.madeintoilet.com,inspector-validator.madeintoilet.com,inspector-auth.madeintoilet.com',
      ),
    ).toEqual({ [LEDGER_GATEWAY_SECRET_HEADER]: 's3cret' })
  })
})

describe('jsonApiHeaders', () => {
  it('attaches bearer plus gateway secret for tenant-prefixed ledger URLs', () => {
    expect(
      jsonApiHeaders(
        'https://inspector-ledger.madeintoilet.com/kairo',
        'jwt-token',
        's3cret',
        'inspector-ledger.madeintoilet.com',
      ),
    ).toEqual({
      Authorization: 'Bearer jwt-token',
      'Content-Type': 'application/json',
      [LEDGER_GATEWAY_SECRET_HEADER]: 's3cret',
    })
  })

  it('omits the gateway secret for non-gateway ledger URLs', () => {
    expect(jsonApiHeaders('https://ledger-api-devnet.kairo.ag/api/json-api', 'jwt-token', 's3cret', 'inspector-ledger.madeintoilet.com')).toEqual({
      Authorization: 'Bearer jwt-token',
      'Content-Type': 'application/json',
    })
  })
})
