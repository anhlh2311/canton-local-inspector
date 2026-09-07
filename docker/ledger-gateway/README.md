# Ledger API jump-host gateway

HTTPS reverse proxy for a VPN-only Canton JSON Ledger API. Run this on a machine already allowlisted by the ledger. Local inspector (`yarn dev` / Docker) and Vercel both call this hostname; the ledger never sees Vercel or laptop IPs.

```
Browser
  → inspector proxy (Vite / Express / Vercel)
    → https://ledger-gw.example.com   (this gateway)
      → LEDGER_UPSTREAM               (VPN-only JSON API)
```

The inspector attaches `X-Ledger-Gateway-Secret` only for hosts listed in `LEDGER_GATEWAY_HOSTS`. The browser never sees that secret.

## Why a shared secret (not Vercel IPs)

Vercel function IPs are not stable unless you buy Static IPs. The gateway therefore authenticates inspector proxies with a shared secret instead of an IP allowlist.

## Run on the whitelist host

```bash
cd docker/ledger-gateway
cp .env.example .env
# set LEDGER_UPSTREAM and LEDGER_GATEWAY_SECRET
docker compose up -d
```

Put TLS in front (Caddy, nginx, or a load balancer) so the inspector uses `https://ledger-gw.example.com`.

A second validator/scan-proxy hop is a second compose stack (different `LEDGER_UPSTREAM` and publish port).

## Inspector env (local `.env.local` and Vercel)

```bash
LEDGER_GATEWAY_HOSTS=ledger-gw.example.com
LEDGER_GATEWAY_SECRET=<same secret as the gateway>
CANTON_ALLOWED_TARGETS=https://ledger-gw.example.com
```

Point the mainnet node at the gateway, not the VPN hostname:

```json
{
  "id": "mainnet",
  "name": "MainNet",
  "network": "mainnet",
  "jsonApiUrl": "https://ledger-gw.example.com/api/json-api",
  "validatorApiUrl": "https://validator-gw.example.com"
}
```

Keep Canton OAuth/JWT as-is. The gateway only forwards `Authorization`.

## Load All (WebSocket)

`streamActiveContractsWs` connects from the **browser** to `jsonApiUrl` as `wss://…`. It does not go through the inspector proxy, so it cannot send the gateway secret.

HTTP queries (Overview, Parties, Contracts without Load All) work from local and Vercel.

Load All works only if the user's browser can reach the gateway **and** you allow WebSocket without the secret (not enabled here) or the user is on the VPN. Prefer HTTP queries, or run Load All from a machine that can reach the ledger directly.

## Do not

- Expose this port without TLS
- Put `LEDGER_GATEWAY_SECRET` in any `VITE_*` variable
- Allowlist Vercel IPs on the ledger — allowlist this jump host only
