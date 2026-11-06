import { describe, expect, it } from 'vitest'
import { applyLighthouseAuth } from './lighthouseAuth.js'

describe('applyLighthouseAuth', () => {
  it('leaves non-mainnet requests unchanged, including a caller Authorization', () => {
    const headers = { Authorization: 'Bearer canton-jwt', Host: 'lighthouse.devnet.cantonloop.com' }
    expect(applyLighthouseAuth(headers, 'https://lighthouse.devnet.cantonloop.com', 'lhk_mainnet')).toEqual(headers)
  })

  it('replaces a caller Authorization with the server key on lighthouse.xyz', () => {
    expect(
      applyLighthouseAuth(
        { authorization: 'Bearer canton-jwt', Host: 'lighthouse.xyz' },
        'https://lighthouse.xyz/api/transactions/1220abc',
        'lhk_live',
      ),
    ).toEqual({
      Host: 'lighthouse.xyz',
      Authorization: 'Bearer lhk_live',
    })
  })

  it('strips a caller Authorization on mainnet when no key is configured', () => {
    expect(
      applyLighthouseAuth(
        { Authorization: 'Bearer canton-jwt' },
        'https://Lighthouse.xyz',
        '  ',
      ),
    ).toEqual({})
  })

  it('does not double-prefix a key that already includes Bearer', () => {
    expect(
      applyLighthouseAuth({}, 'https://lighthouse.xyz', 'Bearer lhk_live'),
    ).toEqual({ Authorization: 'Bearer lhk_live' })
  })

  it('leaves an unparseable origin unchanged', () => {
    const headers = { Authorization: 'Bearer canton-jwt' }
    expect(applyLighthouseAuth(headers, 'not a url', 'lhk_live')).toEqual(headers)
  })
})
