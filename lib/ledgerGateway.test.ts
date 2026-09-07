import { describe, expect, it } from 'vitest'
import { LEDGER_GATEWAY_SECRET_HEADER, ledgerGatewayHeaders } from './ledgerGateway'

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
})
