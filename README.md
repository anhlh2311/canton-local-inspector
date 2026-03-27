# Canton Local Inspector

A dashboard for inspecting Canton Network participant nodes. Connect to local or remote Canton JSON API v2 endpoints to browse synchronizers, parties, packages, and active contracts in real time.

## Features

- **Network Overview** — Node health checks, Canton version, ledger offset, user/package counts across all connected nodes
- **Synchronizer & DSO** — Global synchronizer details, DSO party ID, dynamically discovered active contracts with JSON payload viewer, 2/3/4-column responsive party grid with expand/collapse
- **Parties Explorer** — Browse all users and parties with rights (Admin, ActAs, ReadAs), full-text search across all loaded users, client-side "Show more" pagination
- **Package Manager** — List installed packages with auto-discovered names, templates, and active contract counts per package
- **Contract Explorer** — Query active contracts by template, interface, or contract ID with autocomplete dropdowns for party and template selection. Auto-queries on template selection with refresh button.
- **Settings** — Configure local and remote node connections with per-node auth (shared-secret or OAuth2), auto-refresh intervals, custom colors

### Key UX Details

- **Multi-node switcher** with color-coded health indicators (green/red/yellow)
- **Local + Remote nodes** — Connect to localhost Canton nodes or remote validators (e.g., devnet/mainnet)
- **Dual auth modes** — Shared-secret (HMAC-SHA256 JWT) for local dev, OAuth2 client credentials for remote/production
- **Auto-discovery** — Templates and package names are discovered from the ledger, not hardcoded
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
Name:             Devnet Validator
JSON API URL:     http://146.59.110.100
JSON API Port:    7575
Validator URL:    http://146.59.110.100
Validator Port:   5003
Auth Mode:        OAuth2
Token URL:        https://your-tenant.auth0.com/oauth/token
Client ID:        <your-client-id>
Client Secret:    <your-client-secret>
Audience:         https://your-audience
```

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
- Tokens are cached per node until expiry
- Supports separate validator audience

The app automatically grants `CanReadAsAnyParty` rights to the authenticated user on each node for contract visibility.

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
| `/proxy/remote/{base64url-origin}/*` | Decoded origin URL | Any remote node |
| `/proxy/oauth2-token/{base64url-origin}/*` | Decoded origin URL | OAuth2 token endpoints |

## Project Structure

```
src/
├── api/canton.ts              # API functions, JWT/OAuth2 auth, proxy routing
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

## Production Deployment

For production, replace the Vite dev proxy with a reverse proxy (nginx, Caddy, etc.) that routes API requests to the appropriate Canton node endpoints. Auth credentials should be configured via environment variables rather than stored in localStorage.
