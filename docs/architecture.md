# System Architecture

Canton Local Inspector is a React dashboard for inspecting Canton Network participant nodes. It connects to Canton JSON API v2, Validator Scan Proxy, and WebSocket streaming endpoints to browse synchronizers, parties, packages, and active contracts.

## High-Level Architecture

```mermaid
graph TB
    subgraph Canton["Canton Participant Nodes"]
        JSON["JSON API v2<br/>/v2/state, /v2/users, /v2/packages"]
        VAL["Validator API<br/>/api/validator/v0/scan-proxy/*"]
        WS["WebSocket<br/>/v2/state/active-contracts"]
    end

    subgraph Vercel["Vercel Platform"]
        PROXY["Proxy Function<br/>/api/proxy/{encoded}/{path}"]
        AUTH["Auth Function<br/>/api/auth/token"]
        CREDS["Credentials Function<br/>/api/auth/credentials"]
        TMPL["Templates Function<br/>/api/templates"]
        CRON["Cron Function<br/>/api/cron/index-templates"]
    end

    subgraph Redis["Upstash Redis"]
        R_TMPL["canton:templates:{network}"]
        R_CREDS["canton:creds:{nodeId}"]
        R_META["canton:cron:meta"]
        R_LOCK["canton:cron:lock"]
    end

    subgraph Browser["Browser Client"]
        REACT["React 19 + TypeScript"]
        RQ["React Query Cache"]
        JOTAI["Jotai State<br/>(localStorage)"]
        NATIVE_WS["Native WebSocket"]
    end

    Browser -->|HTTP via proxy| PROXY --> JSON
    Browser -->|HTTP via proxy| PROXY --> VAL
    Browser -->|Direct wss://| WS
    AUTH -->|Token exchange| JSON
    CREDS -->|CRUD| Redis
    TMPL -->|Read| Redis
    CRON -->|WebSocket stream| WS
    CRON -->|Write index| Redis
    CRON -->|Auth tokens| AUTH
```

## Deployment Modes

```mermaid
graph LR
    subgraph Local["Local Development"]
        VITE["Vite Dev Server<br/>localhost:5173"]
        VPROXY["Vite Proxy Plugin"]
        LOCAL_CANTON["Canton Nodes<br/>localhost:1975-4975"]
    end

    subgraph Cloud["Vercel Production"]
        CDN["Vercel CDN<br/>Static Assets"]
        FN["Serverless Functions<br/>/api/*"]
        REMOTE["Remote Canton Nodes<br/>HTTPS endpoints"]
    end

    VITE --> VPROXY --> LOCAL_CANTON
    CDN --> FN --> REMOTE
```

| Component | Local Dev | Vercel Production |
| --------- | --------- | ----------------- |
| API Proxy | Vite dev proxy (`/proxy/remote/...`) | Serverless function (`/api/proxy/...`) |
| OAuth2 Token | Client-side via Vite proxy | Serverless function (`/api/auth/token`) |
| Client Secrets | In browser (dev only) | Upstash Redis (server-side) |
| Template Index | Live discovery on demand | Cron job + Redis cache |
| WebSocket | Direct `ws://localhost:port` | Direct `wss://remote-host` |
| Node Config | Quickstart local nodes | `VITE_NODES` env var |

## Authentication Architecture

```mermaid
flowchart TD
    START["getAuthToken(node)"] --> CHECK_CACHE{"Cached token<br/>still valid?"}
    CHECK_CACHE -->|Yes| RETURN_CACHED["Return cached token"]
    CHECK_CACHE -->|No| CHECK_MODE{"Auth mode?"}

    CHECK_MODE -->|shared-secret| JWT["Sign JWT with jose<br/>HS256, sub=userId<br/>aud, iss from config"]
    JWT --> CACHE_24H["Cache 24 hours"]

    CHECK_MODE -->|oauth2| IS_VERCEL{"Running on<br/>Vercel?"}
    IS_VERCEL -->|Yes| SERVER_TOKEN["POST /api/auth/token<br/>Server looks up credentials"]
    IS_VERCEL -->|No| VITE_PROXY["POST via Vite proxy<br/>Client has credentials"]

    SERVER_TOKEN --> LOOKUP{"Credential lookup"}
    LOOKUP -->|1st| ENV["CANTON_NODES_AUTH<br/>env var"]
    LOOKUP -->|2nd| KV["Upstash Redis<br/>canton:creds:{nodeId}"]
    LOOKUP -->|3rd| LEGACY["Legacy CANTON_OAUTH2_*<br/>env vars"]

    ENV --> EXCHANGE["POST to tokenUrl<br/>client_credentials grant"]
    KV --> EXCHANGE
    LEGACY --> EXCHANGE
    VITE_PROXY --> EXCHANGE

    EXCHANGE --> CACHE_1H["Cache 1 hour"]
    CACHE_24H --> DONE["Return token"]
    CACHE_1H --> DONE
```

### Validator Token

The Validator/Scan Proxy API may require a different audience than the JSON API. `getValidatorAuthToken()` handles this:

- If `validatorAudience` is configured: fetches a separate token with that audience
- Otherwise: reuses the main JSON API token
- Cached separately under key `{nodeId}:validator`

## Template Discovery

```mermaid
flowchart TD
    START["discoverTemplateIds(node, token, partyId, offset)"] --> S0

    subgraph S0["Strategy 0: Redis Index"]
        S0_CHECK{"Vercel + index<br/>available?"}
        S0_CHECK -->|Yes| S0_LOAD["fetchTemplateIndex(network)"]
        S0_LOAD --> S0_DONE["Return indexed templates"]
        S0_CHECK -->|No| S0_INFER{"Infer network<br/>from node name?"}
        S0_INFER -->|Found| S0_LOAD
        S0_INFER -->|No| S1_START
    end

    subgraph S1["Strategy 1: Scan Proxy"]
        S1_START["GET amulet-rules<br/>GET mining-rounds"]
        S1_START --> S1_EXTRACT["Extract template IDs<br/>Learn package patterns"]
    end

    S1_EXTRACT --> S2_START

    subgraph S2["Strategy 2: filtersForAnyParty"]
        S2_START["POST active-contracts<br/>WildcardFilter for all parties"]
        S2_START --> S2_CHECK{"Success?"}
        S2_CHECK -->|Yes| S2_LEARN["Learn from contracts<br/>Return templates"]
        S2_CHECK -->|413 limit| S3_START
    end

    subgraph S3["Strategy 3: Per-User Wildcards"]
        S3_START["Fetch 20 users<br/>Try wildcard per party"]
        S3_START --> S3_CHECK{"Any party<br/>under 200?"}
        S3_CHECK -->|Yes| S3_LEARN["Learn from contracts"]
        S3_CHECK -->|All over 200| S4_START
    end

    subgraph S4["Strategy 4: Cross-Network Construction"]
        S4_START["Use learned Module:Entity patterns<br/>Combine with node's package IDs"]
        S4_START --> S4_CONSTRUCT["constructTemplateIds(node)"]
    end

    S0_DONE --> RESULT["Template IDs"]
    S2_LEARN --> RESULT
    S3_LEARN --> RESULT
    S4_CONSTRUCT --> RESULT
```

### Cross-Network Pattern Learning

Template discovery learns `packageName` to `Module:Entity` mappings from every successful query. These are namespaced by network to prevent mixing:

```text
knownTemplatePatterns = {
  "devnet": {
    "splice-amulet": ["Splice.Amulet:Amulet", "Splice.Round:OpenMiningRound", ...],
    "splice-wallet": ["Splice.Wallet.Install:WalletAppInstall"]
  },
  "mainnet": {
    "splice-amulet": ["Splice.Amulet:Amulet", ...],
    "kairo-dex-simple-escrow-v3": ["Kairo.Escrow.TradeProposal:TradeProposal", ...]
  }
}
```

## Cron-Based Template Indexing

```mermaid
sequenceDiagram
    participant Trigger as Vercel Cron / Manual UI
    participant Cron as /api/cron/index-templates
    participant Redis as Upstash Redis
    participant Canton as Canton Node (WebSocket)

    Trigger->>Cron: GET (cron) or POST (manual)
    Cron->>Cron: Validate auth (CRON_SECRET or same-origin)
    Cron->>Redis: Check cooldown (canton:cron:lastRunTs)
    alt Cooldown active
        Cron-->>Trigger: 429 Too Many Requests
    end
    Cron->>Redis: Acquire lock (canton:cron:lock, 120s TTL)
    alt Lock held
        Cron-->>Trigger: 409 Conflict
    end

    loop Each network group
        Cron->>Canton: WebSocket connect (wss://.../v2/state/active-contracts)
        Cron->>Canton: Send wildcard filter
        Canton-->>Cron: Stream contracts (no limit)
        Cron->>Cron: Extract unique templates
        alt WebSocket fails
            Cron->>Canton: HTTP fallback (filtersForAnyParty)
            alt HTTP 413
                Cron->>Canton: Per-user-party wildcards
            end
        end
        Cron->>Redis: Store canton:templates:{network}
    end

    Cron->>Redis: Store canton:cron:meta + lastRunTs
    Cron->>Redis: Release lock
    Cron-->>Trigger: 200 OK with results
```

## WebSocket Streaming

```mermaid
flowchart TD
    HTTP["HTTP POST /v2/state/active-contracts"] --> CHECK{"Response?"}
    CHECK -->|Success| SHOW["Display contracts"]
    CHECK -->|413 Limit Error| LIMIT["Show '200+ contracts'<br/>+ Load All button"]

    LIMIT -->|User clicks| LARGE_CHECK{"Expected count<br/>> 5,000?"}
    LARGE_CHECK -->|Yes| CONFIRM["Show warning:<br/>'~26,000 contracts (~26MB)'<br/>Stream / Cancel"]
    LARGE_CHECK -->|No| STREAM
    CONFIRM -->|Stream| STREAM

    STREAM["Open WebSocket<br/>wss://node/v2/state/active-contracts"] --> PROGRESS["Stream contracts<br/>Progress: '1,240 loaded...'"]
    PROGRESS --> COMPLETE["Stream complete"]
    COMPLETE --> CACHE["Cache in React Query<br/>['ws-contracts', nodeId, templateId]"]
    CACHE --> DISPLAY["Display all contracts"]
    CACHE --> COOLDOWN["5-minute cooldown<br/>per template"]

    STREAM -->|Cancel| PARTIAL["Return partial results"]
    STREAM -->|Timeout 120s| PARTIAL
```

### Mixed Content Handling

WebSocket connections from an HTTPS page to a non-TLS Canton node (`ws://`) are blocked by browser security. The system detects this and shows a clear error message instead of failing silently.

## State Management

```mermaid
graph TB
    subgraph Jotai["Jotai Atoms (localStorage)"]
        NODES["nodesAtom<br/>NodeConfig[]"]
        SELECTED["selectedNodeIdAtom<br/>string"]
        DERIVED["selectedNodeAtom<br/>(derived)"]
        THEME["themeAtom<br/>'dark' | 'light'"]
        REFRESH["refreshIntervalAtom<br/>number (ms)"]
        AUTO_Q["autoQueryContractsAtom<br/>boolean"]
    end

    subgraph ReactQuery["React Query Cache (in-memory)"]
        HTTP_CACHE["HTTP Query Cache<br/>active-contracts, users,<br/>packages, ledger-end"]
        WS_CACHE["WebSocket Contract Cache<br/>['ws-contracts', nodeId, templateId]<br/>Max 50,000 contracts total"]
        INDEX_CACHE["Template Index Cache<br/>['template-index', network]"]
    end

    NODES --> DERIVED
    SELECTED --> DERIVED
    DERIVED -->|nodeId in queryKey| HTTP_CACHE
    DERIVED -->|nodeId in queryKey| WS_CACHE
    DERIVED -->|network in queryKey| INDEX_CACHE
```

### React Query Cache Eviction

The WebSocket contract cache enforces a 50,000-contract cap across all cached templates per node:

```text
Before caching new stream (e.g., 3,631 AmuletAllocation contracts):
  1. Count total cached contracts for this node
  2. If total + new > 50,000:
     a. Sort existing entries by updatedAt (oldest first)
     b. Evict oldest entries until under limit
  3. Store new entry
```

## Project Structure

```text
canton-local-inspector/
  src/
    api/canton.ts              Client API (auth, proxy, discovery, WebSocket streaming)
    types/canton.ts            TypeScript interfaces
    constants/nodes.ts         Node config from env vars
    stores/nodeStore.ts        Jotai atoms (persisted to localStorage)
    hooks/useCantonQuery.ts    React Query hooks
    components/
      ui/                      shadcn/ui primitives
      common/                  AutocompleteInput, LoadAllButton, JsonViewer, CopyButton, etc.
      layout/                  Sidebar, Header, NodeSelector
    pages/
      OverviewPage.tsx         Network health and stats
      SynchronizerPage.tsx     DSO contracts and party grid
      PartiesPage.tsx          Users, network parties, party lookup
      PackagesPage.tsx         Packages with template counts
      ContractsPage.tsx        Contract explorer (3 query modes)
      SettingsPage.tsx         Node config, auth, template index status

  api/                         Vercel Serverless Functions
    auth/token.ts              OAuth2 token exchange
    auth/credentials.ts        Dynamic node credential CRUD
    cron/index-templates.ts    Daily template indexing (WebSocket)
    proxy.ts                   Canton API proxy
    templates.ts               Cached template index reader

  docs/                        Documentation
  vercel.json                  Deployment config with cron schedule
```
