import { describe, expect, it } from 'vitest'
import { mergeNodeCredentials, publicCredentialFields } from './nodeCredentials.js'

const stored = {
  tokenUrl: 'https://inspector-auth.madeintoilet.com/kairo',
  clientId: 'kairo-client',
  clientSecret: 'existing-secret',
  audience: 'https://kairo-audience',
  validatorAudience: 'https://kairo-validator',
}

describe('mergeNodeCredentials', () => {
  it('keeps the existing secret when the form omits it', () => {
    expect(
      mergeNodeCredentials(stored, {
        tokenUrl:
          'https://inspector-auth.madeintoilet.com/kairo/auth/realms/catalyst-canton/protocol/openid-connect/token',
        clientId: 'kairo-client',
        audience: 'https://kairo-audience',
        validatorAudience: 'https://kairo-validator',
      }),
    ).toEqual({
      tokenUrl:
        'https://inspector-auth.madeintoilet.com/kairo/auth/realms/catalyst-canton/protocol/openid-connect/token',
      clientId: 'kairo-client',
      clientSecret: 'existing-secret',
      audience: 'https://kairo-audience',
      validatorAudience: 'https://kairo-validator',
    })
  })

  it('rejects a first-time save without a secret', () => {
    expect(
      mergeNodeCredentials(null, {
        tokenUrl: 'https://inspector-auth.madeintoilet.com/kairo/oauth/token',
        clientId: 'new-client',
      }),
    ).toBeNull()
  })
})

describe('publicCredentialFields', () => {
  it('omits the secret', () => {
    expect(publicCredentialFields(stored)).toEqual({
      exists: true,
      tokenUrl: stored.tokenUrl,
      clientId: stored.clientId,
      audience: stored.audience,
      validatorAudience: stored.validatorAudience,
    })
  })
})
