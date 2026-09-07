# Jump-host gateway (ledger, validator, Keycloak)

HTTPS reverse proxy for VPN-only Canton JSON Ledger API, validator API, and the OAuth token URL. Run this on a machine already allowlisted by those services. Local inspector (`yarn dev` / Docker) and Vercel both call the public hostnames; the VPN services never see Vercel or laptop IPs.

```
Browser
  → inspector (Vite / Express / Vercel)
    → https://inspector-ledger.madeintoilet.com      → LEDGER_UPSTREAM
    → https://inspector-validator.madeintoilet.com   → VALIDATOR_UPSTREAM
    → https://inspector-auth.madeintoilet.com        → AUTH_UPSTREAM (token path only)
```

Nginx Proxy Manager terminates TLS and forwards all three hosts to this Caddy container. Caddy requires `X-Ledger-Gateway-Secret`, then routes on `Host`. The inspector attaches that header only for hosts listed in `LEDGER_GATEWAY_HOSTS`. The browser never sees the secret.

The auth site only proxies `POST /auth/realms/*/protocol/openid-connect/token`. Keycloak still issues tokens with the original `iss` (set `Host` to the real Keycloak hostname). Canton audiences stay unchanged.

## Why a shared secret (not Vercel IPs)

Vercel function IPs are not stable unless you buy Static IPs. The gateway authenticates inspector proxies with a shared secret instead of an IP allowlist.

## Run on the whitelist host

```bash
cd docker/ledger-gateway
cp .env.example .env
# set LEDGER_GATEWAY_SECRET, public hostnames, and VPN upstreams
docker compose up -d
```

Put Caddy on the NPM Docker network so NPM can use the container name:

```bash
docker network connect nginx-proxy_canton-dex-network ledger-gateway-ledger-gateway-1
```

In NPM, add three Proxy Hosts (Let’s Encrypt, Force SSL, Websockets on), all forwarding to `http://ledger-gateway:8080` (or `http://172.17.0.1:8080` if you keep published ports and skip the network connect). Do not override Host.

| Domain | Forward to |
|---|---|
| `inspector-ledger.madeintoilet.com` | Caddy → `LEDGER_UPSTREAM` |
| `inspector-validator.madeintoilet.com` | Caddy → `VALIDATOR_UPSTREAM` |
| `inspector-auth.madeintoilet.com` | Caddy → `AUTH_UPSTREAM` (token path only) |

## Inspector env (local `.env.local` and Vercel)

```bash
LEDGER_GATEWAY_HOSTS=inspector-ledger.madeintoilet.com,inspector-validator.madeintoilet.com,inspector-auth.madeintoilet.com
LEDGER_GATEWAY_SECRET=<same secret as the gateway>
CANTON_ALLOWED_TARGETS=https://inspector-ledger.madeintoilet.com,https://inspector-validator.madeintoilet.com,https://inspector-auth.madeintoilet.com
```

Point the node at the gateway hostnames, not the VPN hostnames. Keep the original path on the token URL:

```json
{
  "id": "mainnet",
  "jsonApiUrl": "https://inspector-ledger.madeintoilet.com",
  "validatorApiUrl": "https://inspector-validator.madeintoilet.com"
}
```

```bash
CANTON_NODES_AUTH='{"mainnet":{"tokenUrl":"https://inspector-auth.madeintoilet.com/auth/realms/catalyst-canton/protocol/openid-connect/token","clientId":"...","clientSecret":"...","audience":"...","validatorAudience":"..."}}'
```

Audiences stay the real Canton/Keycloak values. Use server-side `CANTON_NODES_AUTH` (not browser-owned client secrets).

## Load All (WebSocket)

`streamActiveContractsWs` connects from the **browser** to `jsonApiUrl` as `wss://…`. It does not go through the inspector proxy, so it cannot send the gateway secret.

HTTP queries (Overview, Parties, Contracts without Load All) work from local and Vercel.

Load All works only if the user's browser can reach the gateway **and** you allow WebSocket without the secret (not enabled here) or the user is on the VPN. Prefer HTTP queries, or run Load All from a machine that can reach the ledger directly.

## Do not

- Expose Caddy without TLS in front (NPM on 443)
- Put `LEDGER_GATEWAY_SECRET` in any `VITE_*` variable
- Allowlist Vercel IPs on the ledger, validator, or Keycloak — allowlist this jump host only
- Proxy Keycloak admin; only the token path is enabled
