# Canton Local Inspector

A dashboard for inspecting Canton Network participant nodes. Connect to local or remote Canton JSON API v2 endpoints to browse synchronizers, parties, packages, and active contracts in real time.

## Features

- **Network Overview** — Node health checks, Canton version, ledger offset, user/package counts across all connected nodes
- **Synchronizer & DSO** — Global synchronizer details, DSO party ID, dynamically discovered active contracts with JSON payload viewer, responsive multi-column party grid with expand/collapse
- **Parties Explorer** — Three tabs: **Users** (local users from `/v2/users`, fast default), **Network Parties** (all parties from `/v2/parties`, paginated 200/page, opt-in for large networks), and **Party Lookup** (check specific party existence by ID). Local/Remote badges, rights, annotations.
- **Package Manager** — List installed packages with auto-discovered names, templates, and active contract counts per package
- **Contract Explorer** — Query active contracts by template, interface, or contract ID with autocomplete dropdowns for party and template selection. Auto-queries on selection with refresh button.
- **Settings** — Configure local and remote node connections with per-node auth (shared-secret or OAuth2), auto-refresh intervals, custom colors

### Key UX Details

- **Multi-node switcher** with color-coded health indicators (green/red/yellow)
- **Local + Remote nodes** — Connect to localhost Canton nodes or remote validators (devnet/mainnet)
- **Dual auth modes** — Shared-secret (HMAC-SHA256 JWT) for local dev, OAuth2 client credentials for remote/production
- **Separate validator audience** — OAuth2 nodes can use a different audience for the Validator API vs the JSON API
- **Auto-discovery** — Templates and package names are discovered from the ledger, not hardcoded. Handles nodes with >200 contracts via paginated per-package fallback.
- **Autocomplete inputs** — Keyboard-navigable dropdowns (Arrow keys + Enter) for party and template selection
- **Copy-friendly** — Every ID (party, contract, package, template) has a one-click copy button
- **Clearable inputs** — X button on all search and form fields
- **Auto-refresh** — Configurable polling interval (5s / 15s / 30s / 60s / off)
- **Dark theme** with indigo accent, color-coded badges (indigo for templates, amber for packages, green for refresh)

## Tech Stack

- React 19 + TypeScript + Vite 8
- Tailwind CSS v4 + shadcn/ui (Radix primitives)
- React Query (TanStack Query) for server state & caching
- Jotai for client state (with localStorage persistence)
- Axios for HTTP
- jose for JWT signing (HS256 shared-secret auth)

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

Nodes can be added, edited, or removed in the Settings page.

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

The JSON API URL supports path prefixes (e.g., `/api/json-api`) for servers that don't serve the Canton API at the root.

Remote nodes are automatically proxied through Vite's dev server to avoid CORS. No manual proxy configuration needed.

## Authentication

### Shared Secret (Local Development)

Default for local Canton nodes:

- **User**: `ledger-api-user`
- **Secret**: `unsafe`
- **Issuer**: `unsafe-auth`
- **Audience**: `https://canton.network.global`

JWTs are signed with HMAC-SHA256 via the `jose` library and cached per node for 24 hours.

### OAuth2 (Remote / Production)

For remote validators using OAuth2 (Auth0, etc.):

- Client credentials grant (`grant_type=client_credentials`)
- Token endpoint is proxied through Vite to avoid CORS
- Tokens are cached per node until expiry, keyed by `{nodeId}:{json|validator}`
- Supports separate `validatorAudience` for the Validator/Scan Proxy API

The app automatically grants `CanReadAsAnyParty` rights to the authenticated user on each node for contract visibility (shared-secret mode only).

## Contract Discovery & Pagination

Canton's JSON API limits active contract responses to 200 elements per request. The inspector handles this automatically:

1. **Phase 1**: Wildcard query — if total contracts for the party < 200, returns everything in one shot
2. **Phase 2**: If the wildcard hits the 200 limit (common for DSO parties on devnet/mainnet), discovers template IDs by querying individual user parties (which typically have far fewer contracts). User parties act as a "template directory".
3. **Phase 3**: Queries each discovered template individually against the original target party — per-template counts are usually well under 200.

If all parties exceed the limit, the UI falls back to manual template entry in the Contract Explorer.

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
├── api/canton.ts              # API functions, JWT/OAuth2 auth, proxy routing, contract pagination
├── types/canton.ts            # TypeScript types (NodeConfig, AuthConfig, API responses)
├── constants/nodes.ts         # Default node configurations
├── stores/nodeStore.ts        # Jotai atoms (selected node, health, refresh interval)
├── hooks/useCantonQuery.ts    # React Query hooks for all API calls
├── components/
│   ├── ui/                    # shadcn/ui primitives (button, card, tabs, etc.)
│   ├── common/                # AutocompleteInput, SearchInput, ClearableInput, IdDisplay, JsonViewer, etc.
│   └── layout/                # Sidebar, Header, NodeSelector, MainLayout
├── pages/
│   ├── OverviewPage.tsx       # Network overview with stats and health
│   ├── SynchronizerPage.tsx   # DSO details, discovered contracts, party grid
│   ├── PartiesPage.tsx        # User/party browser with search and pagination
│   ├── PackagesPage.tsx       # Package list with template discovery
│   ├── ContractsPage.tsx      # Contract query explorer (3 tabs, autocomplete)
│   └── SettingsPage.tsx       # Node config with auth forms (shared-secret / OAuth2)
├── App.tsx                    # Route definitions
└── main.tsx                   # Entry point with providers
```

## Vercel Deployment

The app supports deployment to Vercel with secure server-side auth. OAuth2 client secrets never reach the browser.

### Architecture

| Component | Local Dev | Vercel Production |
|-----------|-----------|-------------------|
| API Proxy | Vite dev proxy (`/proxy/remote/...`) | Serverless function (`/api/proxy/...`) |
| OAuth2 Token | Client-side via Vite proxy | Serverless function (`/api/auth/token`) |
| Client Secret | In browser (dev only) | Vercel env var (server-side only) |
| Node Config | 4 local quickstart nodes | Pre-configured from `VITE_*` env vars |

### Environment Variables

Set these in Vercel project settings:

**Public (bundled in client — safe to expose):**
```bash
VITE_DEPLOY_ENV=vercel
VITE_NODE_NAME=Devnet Validator
VITE_NODE_COLOR=#ec4899
VITE_JSON_API_URL=http://146.59.110.100:7575/api/json-api
VITE_VALIDATOR_API_URL=http://146.59.110.100:5003
VITE_AUTH_MODE=oauth2
```

**Secret (server-side only — never in client bundle):**
```bash
CANTON_JSON_API_URL=http://146.59.110.100:7575/api/json-api
CANTON_VALIDATOR_API_URL=http://146.59.110.100:5003
CANTON_OAUTH2_TOKEN_URL=https://your-tenant.auth0.com/oauth/token
CANTON_OAUTH2_CLIENT_ID=your-client-id
CANTON_OAUTH2_CLIENT_SECRET=your-client-secret
CANTON_OAUTH2_AUDIENCE=https://your-api-audience
CANTON_OAUTH2_VALIDATOR_AUDIENCE=https://your-validator-audience
```

### Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy (will prompt for env vars on first deploy)
vercel

# Or link to existing project and deploy
vercel --prod
```

### Serverless Functions

| Function | Purpose |
|----------|---------|
| `/api/auth/token` | OAuth2 client credentials exchange — reads `CANTON_OAUTH2_*` secrets |
| `/api/proxy/[...path]` | Forwards requests to Canton APIs — validates against allowed target URLs |

### Local Development

Local dev is unaffected. `VITE_DEPLOY_ENV` defaults to `local` (or is unset), which uses the Vite proxy as before. To test Vercel functions locally:

```bash
vercel dev
```
