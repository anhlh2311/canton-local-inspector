import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))

function composeConfig(files: string[]) {
  const args = files.flatMap((f) => ['-f', f]).concat(['config'])
  return execFileSync('docker', ['compose', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
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
    },
  })
}

describe('docker compose standalone nginx', () => {
  it('keeps the NPM network external when used without the standalone overlay', () => {
    const out = composeConfig(['docker-compose.yml'])
    expect(out).toMatch(/nginx-proxy_canton-network/)
    expect(out).toMatch(/external:\s*true/)
    expect(out).not.toMatch(/nginx-proxy-manager/)
  })

  it('adds Nginx Proxy Manager and creates the edge network on a new server', () => {
    const out = composeConfig(['docker-compose.yml', 'docker-compose.standalone.yml'])
    expect(out).toMatch(/nginx-proxy-manager/)
    expect(out).toMatch(/jc21\/nginx-proxy-manager/)
    expect(out).toMatch(/published: "?80"?/)
    expect(out).toMatch(/published: "?443"?/)
    expect(out).toMatch(/published: "?81"?/)
    expect(out).toMatch(/nginx-proxy_canton-network/)
    expect(out).not.toMatch(/external:\s*true/)
  })
})
