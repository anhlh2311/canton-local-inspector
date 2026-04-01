# Canton Local Inspector

A dashboard for inspecting Canton Network participant nodes. Connect to local or remote Canton JSON API v2 endpoints to browse synchronizers, parties, packages, and active contracts in real time.

## Features

- **Network Overview** — Node health checks, Canton version, ledger offset, user/package counts across all connected nodes
- **Synchronizer & DSO** — Global synchronizer details, DSO party ID, dynamically discovered active contracts with JSON payload viewer, responsive multi-column party grid with expand/collapse
- **Parties Explorer** — Three tabs: **Users** (local users from `/v2/users`, fast default), **Network Parties** (all parties from `/v2/parties`, paginated 200/page, opt-in for large networks), and **Party Lookup** (check specific party existence by ID). Local/Remote badges, rights, annotations.
- **Package Manager** — List installed packages with auto-discovered names, templates, and active contract counts per package
- **Contract Explorer** — Query active contracts by template, interface, or contract ID with autocomplete dropdowns for party and template selection. Auto-queries on selection with refresh button.
- **Settings** — Configure local and remote node connections with per-node auth (shared-secret or OAuth2), auto-refresh intervals, custom colors. Template index status with manual refresh.
- **Dark/Light Theme** — Toggle between dark and light modes with instant switching

### Key UX Details

- **Multi-node switcher** with color-coded health indicators (green/red/yellow)
- **Local + Remote nodes** — Connect to localhost Canton nodes or remote validators (devnet/mainnet)
- **Dual auth modes** — Shared-secret (HMAC-SHA256 JWT) for local dev, OAuth2 client credentials for remote/production
- **Separate validator audience** — OAuth2 nodes can use a different audience for the Validator API vs the JSON API
- **Auto-discovery** — Templates and package names are discovered from the ledger, not hardcoded
- **Cron-based template indexing** — Background job pre-builds template index in Upstash Redis, solving the 200-contract discovery limit on mainnet
- **Autocomplete inputs** — Keyboard-navigable dropdowns (Arrow keys + Enter) for party and template selection
- **Copy-friendly** — Every ID (party, contract, package, template) has a one-click copy button
- **Auto-refresh** — Configurable polling interval (5s / 15s / 30s / 60s / off)
- **Secure credential storage** — OAuth2 client secrets for dynamically-added nodes are stored server-side in Upstash Redis, never in the browser

## Tech Stack

- React 19 + TypeScript + Vite 8
- Tailwind CSS v4 + shadcn/ui (Radix primitives)
- React Query (TanStack Query) for server state & caching
- Jotai for client state (with localStorage persistence)
- Axios for HTTP
- jose for JWT signing (HS256 shared-secret auth)
- Upstash Redis for server-side credential and template index storage
- Vercel Serverless Functions for secure OAuth2 token exchange and API proxy
- Vercel Cron for scheduled template indexing

## Prerequisites

- Node.js 18+
- Yarn
- A running Canton network (e.g., via the [Canton Quickstart](https://github.com/digital-asset/canton-quickstart))

## Getting Started

```bash
# Install dependencies
yarn

# Start dev server (with Vite proxy for CORS)
yarn dev

# Build for production
yarn build
```

The dev server starts at `http://localhost:5173` and proxies API requests to Canton nodes to avoid CORS issues.

## Default Node Configuration

| Node             | JSON API | Validator API | Ledger gRPC | Auth           | Color  |
|------------------|----------|---------------|-------------|----------------|--------|
| Trading Partner  | :1975    | :1903         | :1901       | Shared Secret  | Blue   |
| App User         | :2975    | :2903         | :2901       | Shared Secret  | Green  |
| App Provider     | :3975    | :3903         | :3901       | Shared Secret  | Amber  |
| Super Validator  | :4975    | :4903         | :4901       | Shared Secret  | Purple |

Nodes can be added, edited, or removed in the Settings page. Additional nodes can be configured via the `VITE_NODES` environment variable.

## Adding a Remote Node

Click **"Remote Node"** in Settings to add a remote validator. Example configuration:

```
Name:               Devnet Validator
JSON API URL:       http://146.59.110.100:7575/api/json-api
JSON API Port:      0  (port already in URL)
Validator URL:      http://146.59.110.100
Validator Port:     5003
Auth Mode:          OAuth2
Token URL:          https://your-tenant.auth0.com/oauth/token
Client ID:          <your-client-id>
Client Secret:      <your-client-secret>
Audience:           https://your-api-audience
Validator Audience: https://your-validator-audience  (optional, for separate validator auth)
```

On Vercel deployments, OAuth2 client secrets are stored securely in Upstash Redis — never in the browser's localStorage.

## Authentication

### Shared Secret (Local Development)

Default for local Canton nodes:

- **User**: `ledger-api-user`
- **Secret**: `unsafe`
- **Issuer**: `unsafe-auth`
- **Audience**: `https://canton.network.global`

JWTs are signed with HMAC-SHA256 via the `jose` library and cached per node for 24 hours.

### OAuth2 (Remote / Production)

For remote validators using OAuth2 (Auth0, Keycloak, etc.):

- Client credentials grant (`grant_type=client_credentials`)
- On Vercel: tokens are exchanged server-side via `/api/auth/token` — secrets never reach the browser
- On local dev: token endpoint is proxied through Vite to avoid CORS
- Tokens are cached per node until expiry, keyed by `{nodeId}:{json|validator}`
- Supports separate `validatorAudience` for the Validator/Scan Proxy API

The app automatically grants `CanReadAsAnyParty` rights to the authenticated user on each node for contract visibility (shared-secret mode only).

## Template Discovery & Indexing

Canton's JSON API limits active contract responses to 200 elements per request. The inspector uses a multi-strategy approach to discover all templates:

### Cron-Based Indexing (Vercel)

A daily cron job pre-builds a template index for each configured node and caches it in Upstash Redis:

1. **Scan Proxy** — Queries `amulet-rules` and `open-and-issuing-mining-rounds` endpoints (no 200 limit) to discover core Splice templates
2. **`filtersForAnyParty` Wildcard** — Single JSON API query covering all visible parties
3. **Per-User-Party Wildcards** — Fallback for nodes where the wildcard exceeds 200 total contracts

The index can also be refreshed manually via the "Refresh Index Now" button in Settings.

### Live Discovery Fallback

When the cron index is unavailable (local dev, or first deploy before the cron runs):

1. **Cached Index** — Checks Redis for pre-built template index (Vercel only)
2. **Scan Proxy** — Core Splice templates via the Validator API
3. **`filtersForAnyParty` Wildcard** — Single-shot coverage
4. **Per-User-Party Wildcards** — Probes individual parties, stops on first success
5. **Cross-Network Construction** — Uses `packageName` and `Module:Entity` patterns learned from any node to construct template IDs on other nodes

### Contract Querying

Once templates are discovered, the Contract Explorer queries each template individually per party — per-template counts are typically well under 200.

## Canton API Endpoints Used

### JSON API v2 (Participant)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/version` | GET | Health check, version info |
| `/v2/state/connected-synchronizers` | GET | List connected synchronizers |
| `/v2/state/active-contracts` | POST | Query active contracts (template, interface, or wildcard filter) |
| `/v2/state/ledger-end` | GET | Current ledger offset |
| `/v2/users` | GET | List users (auto-paginates, 500/batch) |
| `/v2/users/{id}/rights` | POST | Grant read permissions |
| `/v2/parties` | GET | List ALL parties (including external) |
| `/v2/parties/party?parties=X` | GET | Look up specific party by ID |
| `/v2/parties/participant-id` | GET | Get participant namespace |
| `/v2/packages` | GET | List installed package IDs |

### Validator API (Scan Proxy)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/validator/v0/scan-proxy/dso-party-id` | GET | Get DSO party ID |
| `/api/validator/v0/scan-proxy/amulet-rules` | GET | AmuletRules contract and template ID |
| `/api/validator/v0/scan-proxy/open-and-issuing-mining-rounds` | GET | Mining round contracts and template IDs |

## Vite Proxy Architecture

The dev server proxies all Canton API requests to avoid CORS:

| Proxy Path | Target | Purpose |
|------------|--------|---------|
| `/proxy/json/{nodeId}/*` | `localhost:{port}` | Local node JSON API |
| `/proxy/validator/{nodeId}/*` | `localhost:{port}` | Local node Validator API |
| `/proxy/remote/{base64url-origin}/*` | Decoded origin URL | Any remote node (HTTP/HTTPS) |
| `/proxy/oauth2-token/{base64url-origin}/*` | Decoded origin URL | OAuth2 token endpoints |

The remote and OAuth2 proxies use a custom Vite plugin (`dynamicProxyPlugin`) that decodes the target origin from the URL path and forwards requests using Node.js native `http`/`https` modules.

## Project Structure

```
src/
├── api/canton.ts              # API functions, JWT/OAuth2 auth, proxy routing, template discovery
├── types/canton.ts            # TypeScript types (NodeConfig, AuthConfig, API responses)
├── constants/nodes.ts         # Default node configurations from env vars
├── stores/nodeStore.ts        # Jotai atoms (selected node, health, refresh interval, theme)
├── hooks/useCantonQuery.ts    # React Query hooks for all API calls
├── components/
│   ├── ui/                    # shadcn/ui primitives (button, card, tabs, etc.)
│   ├── common/                # AutocompleteInput, SearchInput, ClearableInput, IdDisplay, JsonViewer, CopyButton
│   └── layout/                # Sidebar, Header, NodeSelector, MainLayout
├── pages/
│   ├── OverviewPage.tsx       # Network overview with stats and health
│   ├── SynchronizerPage.tsx   # DSO details, discovered contracts, party grid
│   ├── PartiesPage.tsx        # User/party browser with search and pagination
│   ├── PackagesPage.tsx       # Package list with template discovery
│   ├── ContractsPage.tsx      # Contract query explorer (3 tabs, autocomplete)
│   └── SettingsPage.tsx       # Node config, auth forms, template index status
├── App.tsx                    # Route definitions
└── main.tsx                   # Entry point with providers

api/                           # Vercel Serverless Functions (each fully self-contained)
├── auth/
│   ├── token.ts               # OAuth2 client credentials exchange
│   └── credentials.ts         # CRUD for node OAuth2 credentials in Redis
├── cron/
│   └── index-templates.ts     # Scheduled template indexing job
├── proxy.ts                   # Canton API proxy with target allowlist
└── templates.ts               # Serve cached template index from Redis
```

## Vercel Deployment

The app supports deployment to Vercel with secure server-side auth, API proxying, credential storage, and cron-based template indexing.

### Architecture

| Component | Local Dev | Vercel Production |
|-----------|-----------|-------------------|
| API Proxy | Vite dev proxy (`/proxy/remote/...`) | Serverless function (`/api/proxy/...`) |
| OAuth2 Token | Client-side via Vite proxy | Serverless function (`/api/auth/token`) |
| Client Secrets | In browser (dev only) | Upstash Redis (server-side) |
| Template Index | Live discovery on demand | Cron job + Redis cache |
| Node Config | Quickstart local nodes | `VITE_NODES` env var |

### Environment Variables

Set these in Vercel project settings:

**Public (bundled in client — safe to expose):**
```bash
VITE_DEPLOY_ENV=vercel

# Multi-node config (JSON array — must be single line for dotenv)
VITE_NODES='[{"id":"devnet","name":"Devnet","jsonApiUrl":"http://1.2.3.4:7575/api/json-api","validatorApiUrl":"http://1.2.3.4:5003","color":"#ec4899","authMode":"oauth2","audience":"https://your-audience","validatorAudience":"https://your-val-audience"}]'
```

**Secret (server-side only — never in client bundle):**
```bash
# OAuth2 credentials per node (JSON map keyed by node ID)
CANTON_NODES_AUTH='{"devnet":{"tokenUrl":"https://your-tenant.auth0.com/oauth/token","clientId":"your-id","clientSecret":"your-secret","audience":"https://your-audience","validatorAudience":"https://your-val-audience"}}'

# Proxy allowed targets
CANTON_ALLOWED_TARGETS=http://1.2.3.4:7575/api/json-api,http://1.2.3.4:5003

# Upstash Redis (auto-set when linking via Vercel Marketplace)
KV_REST_API_URL=<your-url>
KV_REST_API_TOKEN=<your-token>

# Cron job security (generate with: openssl rand -base64 24)
CRON_SECRET=<your-random-secret>
```

### Serverless Functions

| Function | Purpose |
|----------|---------|
| `POST /api/auth/token` | OAuth2 client credentials exchange — looks up secrets from env vars or Redis |
| `POST/GET/DELETE /api/auth/credentials` | Manage OAuth2 credentials for dynamic nodes in Redis |
| `GET /api/proxy/{base64url-origin}/{path}` | Forward requests to Canton APIs — validates allowed targets, blocks localhost |
| `GET /api/templates?nodeId=xxx` | Serve cached template index from Redis |
| `GET /api/cron/index-templates` | Cron-triggered template indexing (secured by `CRON_SECRET`) |

### Cron Jobs

| Schedule | Path | Purpose |
|----------|------|---------|
| `0 3 * * *` (daily at 3 AM UTC) | `/api/cron/index-templates` | Index templates for all configured nodes |

On Vercel's free tier, cron jobs run once per day. Upgrade to Pro for more frequent scheduling. You can also trigger indexing manually via the "Refresh Index Now" button in Settings.

### Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy (will prompt for env vars on first deploy)
vercel

# Or link to existing project and deploy
vercel --prod
```

### Post-Deploy Setup

1. **Upstash Redis** — Create via Vercel Marketplace (Storage tab). Auto-sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
2. **CRON_SECRET** — Generate and add: `openssl rand -base64 24`
3. **First Index** — Go to Settings and click "Refresh Index Now" to build the initial template index.

### Local Development

Local dev is unaffected. `VITE_DEPLOY_ENV` defaults to `local` (or is unset), which uses the Vite proxy. To test Vercel functions locally:

```bash
vercel dev
```
