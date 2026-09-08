export function mergeNodeCredentials(existing, incoming) {
  const tokenUrl = incoming?.tokenUrl?.trim() || existing?.tokenUrl || ''
  const clientId = incoming?.clientId?.trim() || existing?.clientId || ''
  const clientSecret = incoming?.clientSecret?.trim() || existing?.clientSecret || ''
  const audience = incoming?.audience !== undefined ? incoming.audience : existing?.audience || ''
  const validatorAudience =
    incoming?.validatorAudience !== undefined ? incoming.validatorAudience : existing?.validatorAudience

  if (!tokenUrl || !clientId || !clientSecret) return null

  const creds = { tokenUrl, clientId, clientSecret, audience }
  if (validatorAudience) creds.validatorAudience = validatorAudience
  return creds
}

export function publicCredentialFields(creds) {
  if (!creds) return { exists: false }
  return {
    exists: true,
    tokenUrl: creds.tokenUrl || '',
    clientId: creds.clientId || '',
    audience: creds.audience || '',
    validatorAudience: creds.validatorAudience,
  }
}
