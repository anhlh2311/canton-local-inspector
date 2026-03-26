# Canton Local Inspector

A dashboard for inspecting Canton Network participant nodes. Connect to local or remote Canton JSON API v2 endpoints to browse synchronizers, parties, packages, and active contracts in real time.

## Features

- **Network Overview** — Node health checks, Canton version, ledger offset, user/package counts across all connected nodes
- **Synchronizer & DSO** — Global synchronizer details, DSO party ID, dynamically discovered active contracts (AmuletRules, MiningRounds, etc.) with JSON payload viewer
- **Parties Explorer** — Browse all users and parties with rights (Admin, ActAs, ReadAs), searchable across all loaded users, client-side pagination
- **Package Manager** — List installed packages with auto-discovered names, templates, and active contract counts per package
- **Contract Explorer** — Query active contracts by template, interface, or contract ID with autocomplete dropdowns for party and template selection
- **Settings** — Configure node connections (URL, ports, colors), auto-refresh intervals, add/remove custom nodes

### Key UX Details

- **Multi-node switcher** with color-coded health indicators (green/red/yellow)
- **Auto-discovery** — Templates and package names are discovered from the ledger, not hardcoded
- **Keyboard navigation** — Arrow keys + Enter to select from autocomplete dropdowns
- **Copy-friendly** — Every ID (party, contract, package, template) has a one-click copy button
- **Auto-refresh** — Configurable polling interval (5s / 15s / 30s / 60s / off)
- **Dark theme** with indigo accent

## Tech Stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4 + shadcn/ui (Radix primitives)
- React Query (TanStack Query) for server state & caching
- Jotai for client state
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

| Node             | JSON API | Validator API | Ledger gRPC | Color  |
|------------------|----------|---------------|-------------|--------|
| Trading Partner  | :1975    | :1903         | :1901       | Blue   |
| App User         | :2975    | :2903         | :2901       | Green  |
| App Provider     | :3975    | :3903         | :3901       | Amber  |
| Super Validator  | :4975    | :4903         | :4901       | Purple |

Nodes can be added, edited, or removed in the Settings page. Custom nodes also need a proxy entry in `vite.config.ts` for local development.

## Authentication

Uses Canton's shared-secret auth mode by default:

- **Secret**: `unsafe`
- **Issuer**: `unsafe-auth`
- **User**: `ledger-api-user`
- **Audience**: `https://canton.network.global`

JWTs are signed with HMAC-SHA256 via the `jose` library and cached for 24 hours. The app automatically grants `CanReadAsAnyParty` rights to the user on each node for contract visibility.

## Canton API Endpoints Used

### JSON API v2 (Participant)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/version` | GET | Health check, version info |
| `/v2/state/connected-synchronizers` | GET | List connected synchronizers |
| `/v2/state/active-contracts` | POST | Query active contracts (template, interface, or wildcard filter) |
| `/v2/state/ledger-end` | GET | Current ledger offset |
| `/v2/users` | GET | List users (paginated) |
| `/v2/users/{id}/rights` | POST | Grant read permissions |
| `/v2/parties/participant-id` | GET | Get participant namespace |
| `/v2/packages` | GET | List installed package IDs |

### Validator API (Scan Proxy)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/validator/v0/scan-proxy/dso-party-id` | GET | Get DSO party ID |

## Project Structure

```
src/
├── api/canton.ts              # All Canton API functions, JWT generation
├── types/canton.ts            # TypeScript interfaces for API responses
├── constants/nodes.ts         # Default node configurations
├── stores/nodeStore.ts        # Jotai atoms (selected node, health, refresh interval)
├── hooks/useCantonQuery.ts    # React Query hooks for all API calls
├── components/
│   ├── ui/                    # shadcn/ui primitives (button, card, tabs, etc.)
│   ├── common/                # Shared components (AutocompleteInput, IdDisplay, JsonViewer, etc.)
│   └── layout/                # Sidebar, Header, NodeSelector, MainLayout
├── pages/
│   ├── OverviewPage.tsx       # Network overview with stats and health
│   ├── SynchronizerPage.tsx   # DSO details and discovered contracts
│   ├── PartiesPage.tsx        # User/party browser with pagination
│   ├── PackagesPage.tsx       # Package list with template discovery
│   ├── ContractsPage.tsx      # Contract query explorer (3 tabs)
│   └── SettingsPage.tsx       # Node and preference configuration
├── App.tsx                    # Route definitions
└── main.tsx                   # Entry point with providers
```

## Production Deployment

For production, replace the Vite dev proxy with a reverse proxy (nginx, Caddy, etc.) that routes `/v2/*` and `/api/*` requests to the appropriate Canton node endpoints. The JWT shared-secret should also be configured via environment variables rather than hardcoded.
