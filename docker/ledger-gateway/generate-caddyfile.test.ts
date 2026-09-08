import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'generate-caddyfile.sh')

function generate(extra: Record<string, string> = {}) {
  const env = {
    ...process.env,
    CADDYFILE_GENERATE_ONLY: '1',
    LEDGER_GATEWAY_SECRET: 'test-secret',
    LEDGER_GATEWAY_HOSTNAME: 'inspector-ledger.example',
    LEDGER_UPSTREAM: 'https://ledger.internal',
    LEDGER_UPSTREAM_HOST: 'ledger.internal',
    VALIDATOR_GATEWAY_HOSTNAME: 'inspector-validator.example',
    VALIDATOR_UPSTREAM: 'https://validator.internal',
    VALIDATOR_UPSTREAM_HOST: 'validator.internal',
    AUTH_GATEWAY_HOSTNAME: 'inspector-auth.example',
    AUTH_UPSTREAM: 'https://keycloak.internal',
    AUTH_UPSTREAM_HOST: 'keycloak.internal',
    GATEWAY_TENANTS: 'sanctum',
    SANCTUM_LEDGER_UPSTREAM: 'https://sanctum-ledger.internal',
    SANCTUM_LEDGER_UPSTREAM_HOST: 'sanctum-ledger.internal',
    SANCTUM_VALIDATOR_UPSTREAM: 'https://sanctum-validator.internal',
    SANCTUM_VALIDATOR_UPSTREAM_HOST: 'sanctum-validator.internal',
    SANCTUM_AUTH_UPSTREAM: 'https://sanctum-auth.internal',
    SANCTUM_AUTH_UPSTREAM_HOST: 'sanctum-auth.internal',
    ...extra,
  }
  return execFileSync('sh', [script], { env, encoding: 'utf8' })
}

describe('generate-caddyfile ACS websocket', () => {
  it('allows ledger ACS websocket upgrades with a jwt.token subprotocol and no secret', () => {
    const out = generate()
    const wsIdx = out.indexOf('@acs_ws')
    const authedIdx = out.indexOf('handle @authed')
    expect(wsIdx).toBeGreaterThan(0)
    expect(authedIdx).toBeGreaterThan(wsIdx)
    expect(out).toContain('header Upgrade *websocket*')
    expect(out).toContain('header Sec-WebSocket-Protocol *jwt.token*')
    expect(out).toContain('path_regexp acs_ws ^(/[a-z0-9]+)?/v2/state/active-contracts$')
    expect(out).toContain('@sanctum_ledger_ws path /sanctum /sanctum/*')
    expect(out.indexOf('handle @acs_ws')).toBeLessThan(authedIdx)
  })
})
