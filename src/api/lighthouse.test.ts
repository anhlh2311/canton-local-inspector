import { describe, expect, it } from 'vitest'
import { LIGHTHOUSE_HOSTS, lighthouseExplorerUrl, lighthouseProxyRequestPath } from './lighthouse'

describe('LIGHTHOUSE_HOSTS', () => {
  it('maps devnet and mainnet API origins', () => {
    expect(LIGHTHOUSE_HOSTS.devnet.apiOrigin).toBe('https://lighthouse.devnet.cantonloop.com')
    expect(LIGHTHOUSE_HOSTS.mainnet.apiOrigin).toBe('https://lighthouse.xyz')
  })
})

describe('lighthouseExplorerUrl', () => {
  it('uses the network explorer origin', () => {
    expect(lighthouseExplorerUrl('devnet', 'abc')).toBe(
      'https://lighthouse.devnet.cantonloop.com/transactions/abc',
    )
    expect(lighthouseExplorerUrl('mainnet', 'abc')).toBe(
      'https://lighthouse.xyz/transactions/abc',
    )
  })
})

describe('lighthouseProxyRequestPath', () => {
  it('encodes origin as base64url then appends /api/transactions/{id}', () => {
    const path = lighthouseProxyRequestPath('devnet', '1220abc')
    expect(path.startsWith('/')).toBe(true)
    expect(path.endsWith('/api/transactions/1220abc')).toBe(true)
    expect(path).not.toContain('https://')
  })
})
