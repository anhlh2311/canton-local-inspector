# Data Flows

Detailed sequence diagrams for the key data flows in Canton Local Inspector.

## Contract Query Flow

The primary user interaction: querying active contracts for a party and template.

```mermaid
sequenceDiagram
    actor User
    participant UI as React UI
    participant RQ as React Query
    participant API as canton.ts
    participant Proxy as Proxy (Vite/Vercel)
    participant Canton as Canton Node

    User->>UI: Select party + template
    UI->>RQ: useActiveContracts(filter)
    RQ->>API: getActiveContracts(node, token, request)
    API->>API: Fetch ledger-end offset (if not provided)
    API->>Proxy: POST /v2/state/active-contracts
    Proxy->>Canton: Forward request

    alt Under 200 contracts
        Canton-->>Proxy: JSON array of contracts
        Proxy-->>API: Response
        API-->>RQ: Contract data
        RQ-->>UI: Display contracts
    else Over 200 contracts (413)
        Canton-->>Proxy: 413 Content Too Large
        Proxy-->>API: Error response
        API->>API: Set isLimitError = true
        API-->>RQ: Throw limit error
        RQ-->>UI: Show "200+ contracts" + Load All button
    end

    opt User clicks Load All
        User->>UI: Click "Load All"
        UI->>API: streamActiveContractsWs(node, token, filter)
        API->>Canton: WebSocket wss://node/v2/state/active-contracts
        API->>Canton: Send filter JSON
        loop Stream contracts
            Canton-->>API: Contract frame
            API-->>UI: onProgress(count)
        end
        Canton-->>API: Close connection (code 1000)
        API-->>RQ: setQueryData(['ws-contracts', nodeId, templateId])
        RQ-->>UI: Display all contracts
    end
```

## Synchronizer Page Load

The Synchronizer page uses the cached template index and queries contracts per template.

```mermaid
sequenceDiagram
    actor User
    participant Page as SynchronizerPage
    participant Hook as useDiscoverTemplates
    participant API as canton.ts
    participant Redis as /api/templates
    participant Canton as Canton Node

    User->>Page: Navigate to /synchronizer
    Page->>Hook: useDiscoverTemplates(dsoPartyId)

    alt Vercel deployment
        Hook->>API: fetchTemplateIndex(network)
        API->>Redis: GET /api/templates?network=mainnet
        Redis-->>API: Cached template list (from cron)
        API-->>Hook: Template entries (zero Canton API calls)
    else Local development
        Hook->>API: discoverAllContracts(node, token, partyId)
        API->>Canton: Wildcard query / per-party discovery
        Canton-->>API: Contract data
        API-->>Hook: Grouped by template
    end

    Hook-->>Page: Template list with names
    Page->>Page: Filter to splice-* packages (DSO relevant)
    Page-->>User: Display template cards

    User->>Page: Click template card
    Page->>Canton: POST active-contracts (TemplateFilter)

    alt Under 200
        Canton-->>Page: Contract array
        Page-->>User: Display contracts in scrollable list
    else Over 200
        Canton-->>Page: 413 error
        Page-->>User: Show "Load All" button
    end
```

## Proxy Routing

How API requests reach Canton nodes in different environments.

```mermaid
sequenceDiagram
    participant Browser
    participant ViteProxy as Vite Dev Proxy
    participant VercelProxy as /api/proxy
    participant Canton as Canton Node

    Note over Browser,Canton: Local Development (localhost nodes)
    Browser->>ViteProxy: /proxy/json/{nodeId}/v2/users
    ViteProxy->>Canton: http://localhost:{port}/v2/users
    Canton-->>ViteProxy: Response
    ViteProxy-->>Browser: Response

    Note over Browser,Canton: Local Development (remote nodes)
    Browser->>ViteProxy: /proxy/remote/{base64url-origin}/v2/users
    ViteProxy->>ViteProxy: Decode base64url origin
    ViteProxy->>Canton: http://remote-host:port/v2/users
    Canton-->>ViteProxy: Response
    ViteProxy-->>Browser: Response

    Note over Browser,Canton: Vercel Production (remote nodes)
    Browser->>VercelProxy: /api/proxy/{base64url-origin}/path/v2/users
    VercelProxy->>VercelProxy: Decode origin, validate allowlist
    VercelProxy->>Canton: https://remote-host/path/v2/users
    Canton-->>VercelProxy: Response
    VercelProxy-->>Browser: Response

    Note over Browser,Canton: WebSocket (all environments)
    Browser->>Canton: wss://remote-host/v2/state/active-contracts
    Note right of Browser: Direct connection,<br/>no proxy needed<br/>(WebSocket has no CORS)
    Canton-->>Browser: Stream contract frames
```

## OAuth2 Token Exchange

How tokens are obtained for remote Canton nodes with OAuth2 authentication.

```mermaid
sequenceDiagram
    participant Client as Browser
    participant TokenFn as /api/auth/token
    participant Redis as Upstash Redis
    participant OAuth as OAuth2 Provider

    Client->>TokenFn: POST {nodeId, audience}

    TokenFn->>TokenFn: Check CANTON_NODES_AUTH env var
    alt Found in env
        TokenFn->>TokenFn: Use env credentials
    else Not in env
        TokenFn->>Redis: GET canton:creds:{nodeId}
        alt Found in Redis
            Redis-->>TokenFn: {tokenUrl, clientId, clientSecret, audience}
        else Not found
            TokenFn-->>Client: 500 No credentials configured
        end
    end

    TokenFn->>OAuth: POST tokenUrl (client_credentials grant)
    OAuth-->>TokenFn: {access_token, expires_in}
    TokenFn-->>Client: {access_token, expires_in, token_type}
```

## Dynamic Node Credential Storage

How OAuth2 credentials for dynamically-added nodes are securely stored.

```mermaid
sequenceDiagram
    actor User
    participant Settings as SettingsPage
    participant API as canton.ts
    participant CredFn as /api/auth/credentials
    participant Redis as Upstash Redis

    User->>Settings: Add remote node with OAuth2

    Note over User,Settings: User enters: tokenUrl, clientId,<br/>clientSecret, audience

    User->>Settings: Click Save
    Settings->>API: saveNodeCredentials(nodeId, creds)
    API->>CredFn: POST /api/auth/credentials
    CredFn->>Redis: SET canton:creds:{nodeId}
    Redis-->>CredFn: OK
    CredFn-->>API: {ok: true}
    API-->>Settings: Success

    Note over Settings: Node config saved to localStorage<br/>WITHOUT clientSecret<br/>(only _hasServerCredentials flag)

    User->>Settings: Delete node
    Settings->>API: deleteNodeCredentials(nodeId)
    API->>CredFn: DELETE /api/auth/credentials?nodeId=xxx
    CredFn->>Redis: DEL canton:creds:{nodeId}
```

## Cron Template Indexing

The daily cron job that pre-builds the template index.

```mermaid
sequenceDiagram
    participant Cron as Vercel Cron
    participant Fn as index-templates.ts
    participant Redis as Upstash Redis
    participant WS as Canton WebSocket
    participant HTTP as Canton HTTP API

    Cron->>Fn: GET /api/cron/index-templates
    Fn->>Fn: Validate Authorization: Bearer CRON_SECRET
    Fn->>Redis: GET canton:cron:lastRunTs
    Fn->>Fn: Check 5-min cooldown
    Fn->>Redis: SET canton:cron:lock (NX, 120s TTL)

    Fn->>Fn: Parse VITE_NODES + POST body nodes
    Fn->>Fn: Group by network, skip localhost

    par Index devnet
        Fn->>Fn: Get auth token for devnet node
        Fn->>WS: Connect ws://devnet-host/v2/state/active-contracts
        Fn->>WS: Send wildcard filter
        WS-->>Fn: Stream all contracts (3,232 on devnet)
        Fn->>Fn: Extract unique templates (56)
        Fn->>Redis: SET canton:templates:devnet
    and Index mainnet
        Fn->>Fn: Get auth token for mainnet node
        Fn->>WS: Connect wss://mainnet-host/v2/state/active-contracts
        Fn->>WS: Send wildcard filter
        WS-->>Fn: Stream all contracts (48,529 on mainnet)
        Fn->>Fn: Extract unique templates (44)
        Fn->>Redis: SET canton:templates:mainnet
    end

    Fn->>Redis: SET canton:cron:meta
    Fn->>Redis: SET canton:cron:lastRunTs
    Fn->>Redis: DEL canton:cron:lock
    Fn-->>Cron: 200 OK {results}
```

## WebSocket Contract Cache Lifecycle

How streamed contracts are cached and evicted in React Query.

```mermaid
flowchart TD
    STREAM["WebSocket stream completes<br/>e.g., 3,631 AmuletAllocation contracts"] --> COUNT["Count total cached contracts<br/>for this node"]
    COUNT --> CHECK{"total + new ><br/>50,000?"}
    CHECK -->|No| STORE["setQueryData(<br/>['ws-contracts', nodeId, templateId],<br/>contracts)"]
    CHECK -->|Yes| EVICT["Sort cached entries by updatedAt<br/>Evict oldest until under limit"]
    EVICT --> STORE

    STORE --> PERSIST["Cache persists across<br/>page navigation"]
    PERSIST --> STALE{"Stale after<br/>5 minutes?"}
    STALE -->|Yes| REFETCHABLE["User can re-stream<br/>(cooldown expired)"]
    STALE -->|No| FRESH["Serve from cache<br/>on revisit"]

    PERSIST --> GC{"Unused for<br/>10 minutes?"}
    GC -->|Yes| REMOVE["Garbage collected<br/>by React Query"]
    GC -->|No| KEEP["Keep in memory"]
```
