# API Reference

Complete reference for all API endpoints, client functions, and React Query hooks.

## Canton JSON API v2 Endpoints

Endpoints used on Canton participant nodes.

| Endpoint | Method | Purpose |
| -------- | ------ | ------- |
| `/v2/version` | GET | Node version and health check |
| `/v2/state/connected-synchronizers` | GET | List connected synchronizers |
| `/v2/state/active-contracts` | POST | Query active contracts (HTTP, 200-element limit) |
| `/v2/state/active-contracts` | WebSocket | Stream active contracts (no limit) |
| `/v2/state/ledger-end` | GET | Current ledger offset |
| `/v2/users` | GET | List users (paginated, 500/batch) |
| `/v2/users/{id}/rights` | POST | Grant CanActAs/CanReadAs/CanReadAsAnyParty |
| `/v2/parties` | GET | List all parties including external (paginated) |
| `/v2/parties/party` | GET | Look up specific party by ID |
| `/v2/parties/participant-id` | GET | Get participant namespace fingerprint |
| `/v2/packages` | GET | List installed package IDs |
| `/v2/packages/{id}/status` | GET | Check package registration status |
| `/v2/events/events-by-contract-id` | POST | Look up contract create/archive events by contract ID |

## Validator / Scan Proxy Endpoints

Endpoints on the Validator API (separate port/URL from JSON API).

| Endpoint | Method | Purpose |
| -------- | ------ | ------- |
| `/api/validator/v0/scan-proxy/dso-party-id` | GET | Get DSO party ID |
| `/api/validator/v0/scan-proxy/amulet-rules` | GET | AmuletRules contract with template ID |
| `/api/validator/v0/scan-proxy/open-and-issuing-mining-rounds` | GET | Mining round contracts and template IDs |

## Vercel Serverless Functions

All functions are in the `api/` directory. Each is fully self-contained (no cross-file imports).

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| POST | `/api/auth/token` | None | OAuth2 client credentials exchange |
| POST | `/api/auth/credentials` | None | Save OAuth2 credentials to Redis |
| GET | `/api/auth/credentials?nodeId=x` | None | Check if credentials exist |
| DELETE | `/api/auth/credentials?nodeId=x` | None | Remove credentials from Redis |
| GET | `/api/proxy/{encoded}/{path}` | Passthrough | Forward requests to Canton APIs |
| GET | `/api/templates?network=x` | None | Serve cached template index |
| GET | `/api/templates?meta=true` | None | Serve cron job metadata |
| GET | `/api/cron/index-templates` | CRON_SECRET | Cron-triggered template indexing |
| POST | `/api/cron/index-templates` | Same-origin | Manual template index trigger |

### Redis Keys

| Key | Type | Purpose |
| --- | ---- | ------- |
| `canton:templates:{network}` | JSON | Cached template index per network |
| `canton:creds:{nodeId}` | JSON | OAuth2 credentials for dynamic nodes |
| `canton:cron:meta` | JSON | Last cron run metadata |
| `canton:cron:lock` | String | Distributed lock (120s TTL) |
| `canton:cron:lastRunTs` | Number | Cooldown timestamp |

## Client API Functions

Exported from `src/api/canton.ts`.

### Credential Management

| Function | Parameters | Returns | Description |
| -------- | ---------- | ------- | ----------- |
| `saveNodeCredentials` | `nodeId, creds` | `void` | Save OAuth2 credentials to Redis |
| `deleteNodeCredentials` | `nodeId` | `void` | Remove credentials from Redis |

### Template Index

| Function | Parameters | Returns | Description |
| -------- | ---------- | ------- | ----------- |
| `fetchTemplateIndex` | `network` | `TemplateIndex` | Get cached template index from Redis |
| `fetchCronMeta` | none | `CronMeta` | Get cron job run metadata |
| `triggerIndexRefresh` | `force?, nodes?` | `object` | Manually trigger cron indexing |

### Active Contracts

| Function | Parameters | Returns | Description |
| -------- | ---------- | ------- | ----------- |
| `getActiveContracts` | `node, token, request` | `ActiveContractsResponse` | HTTP query (200 limit, throws isLimitError) |
| `streamActiveContractsWs` | `node, token, request, onProgress?` | `{promise, cancel}` | WebSocket stream (no limit) |
| `getEventsByContractId` | `node, token, contractId` | `unknown` | Look up contract events by ID (no party/template needed) |
| `discoverAllContracts` | `node, token, partyId` | `ActiveContract[]` | Multi-strategy discovery |

### Authentication

| Function | Parameters | Returns | Description |
| -------- | ---------- | ------- | ----------- |
| `getAuthToken` | `node` | `string` | Get JSON API token (cached) |
| `getValidatorAuthToken` | `node` | `string` | Get Validator API token (cached) |

### Filter Builders

| Function | Parameters | Returns | Description |
| -------- | ---------- | ------- | ----------- |
| `buildTemplateFilter` | `partyId, templateId, offset?` | `ActiveContractsRequest` | Filter by party + template |
| `buildAnyPartyTemplateFilter` | `templateId, offset?` | `ActiveContractsRequest` | Filter by template (all parties) |
| `buildInterfaceFilter` | `partyId, interfaceId` | `ActiveContractsRequest` | Filter by party + interface |

### Other

| Function | Parameters | Returns | Description |
| -------- | ---------- | ------- | ----------- |
| `getVersion` | `node` | `VersionResponse` | Node version info |
| `getConnectedSynchronizers` | `node, token` | `ConnectedSynchronizersResponse` | List synchronizers |
| `getLedgerEnd` | `node, token` | `LedgerEndResponse` | Current ledger offset |
| `listUsers` | `node, token, pageSize?, pageToken?` | `UsersResponse` | List users (one page) |
| `listAllUsers` | `node, token, opts?` | `UsersResponse` | Auto-paginate all users |
| `listParties` | `node, token, pageSize?, pageToken?` | `PartyResponse` | List parties (one page) |
| `getParticipantId` | `node, token` | `ParticipantIdResponse` | Participant fingerprint |
| `listPackages` | `node, token` | `PackagesResponse` | List package IDs |
| `grantReadAsAnyParty` | `node, token, userId?` | `void` | Grant CanReadAsAnyParty right |
| `getDsoPartyId` | `node, token?` | `DsoPartyResponse` | DSO party via Scan Proxy |
| `checkNodeHealth` | `node` | `NodeHealth` | Quick health check |

## React Query Hooks

Exported from `src/hooks/useCantonQuery.ts`.

### Node and Permissions

| Hook | Query Key | Stale Time | Description |
| ---- | --------- | ---------- | ----------- |
| `useNodeConfig()` | n/a (Jotai) | n/a | Current selected node config |
| `useEnsureReadPermissions()` | `['ensure-permissions', nodeId]` | Infinity | Auto-grant CanReadAsAnyParty |

### Ledger State

| Hook | Query Key | Stale Time | Refetch |
| ---- | --------- | ---------- | ------- |
| `useVersion()` | `['version', nodeId]` | 60s | none |
| `useLedgerEnd()` | `['ledger-end', nodeId]` | default | refreshInterval |
| `useConnectedSynchronizers()` | `['synchronizers', nodeId]` | default | refreshInterval |

### Users and Parties

| Hook | Query Key | Stale Time | Refetch |
| ---- | --------- | ---------- | ------- |
| `useAllUsers()` | `['all-users', nodeId]` | 30s | refreshInterval |
| `useFlatUsers()` | (wraps useAllUsers) | 30s | refreshInterval |
| `usePaginatedParties(pageSize)` | `['parties-paginated', nodeId, pageSize]` | 120s | none |
| `useParticipantId()` | `['participant-id', nodeId]` | 60s | none |

### Contracts and Templates

| Hook | Query Key | Stale Time | Notes |
| ---- | --------- | ---------- | ----- |
| `useActiveContracts(request, key?)` | `['active-contracts', nodeId, key, request]` | default | No retry on limit errors |
| `useDiscoverTemplates(partyId)` | `['discover-templates', nodeId, partyId]` | 30s | Uses Redis index on Vercel |
| `usePackages()` | `['packages', nodeId]` | default | refreshInterval |
| `usePackageDiscovery(partyId)` | `['package-discovery', nodeId, partyId]` | 60s | Groups by package |

### Validator and DSO

| Hook | Query Key | Stale Time | Notes |
| ---- | --------- | ---------- | ----- |
| `useDsoPartyId()` | `['dso-party', nodeId]` | 60s | Validator API token |
| `useNodeHealth()` | `['health', nodeId]` | default | 30s refetch |

### Template Index (Vercel Only)

| Hook | Query Key | Stale Time | Notes |
| ---- | --------- | ---------- | ----- |
| `useTemplateIndex()` | `['template-index', network]` | 60s | enabled: isVercel |
| `useCronMeta()` | `['cron-meta']` | 30s | enabled: isVercel |

### WebSocket Contract Cache

Managed by `LoadAllButton` via `queryClient.setQueryData()`:

| Cache Key | Max Size | Stale | GC | Description |
| --------- | -------- | ----- | -- | ----------- |
| `['ws-contracts', nodeId, templateId]` | 50,000 total | 5 min | 10 min | Streamed contracts per template |

## Active Contracts Filter Types

The Canton JSON API supports three filter types in the `cumulative` array.

### TemplateFilter

Query contracts of a specific template:

```json
{
  "identifierFilter": {
    "TemplateFilter": {
      "value": {
        "templateId": "<packageHash>:<Module>:<Entity>",
        "includeCreatedEventBlob": false
      }
    }
  }
}
```

### WildcardFilter

Query all contracts regardless of template:

```json
{
  "identifierFilter": {
    "WildcardFilter": {
      "value": {
        "includeCreatedEventBlob": false
      }
    }
  }
}
```

### InterfaceFilter

Query contracts implementing a specific interface:

```json
{
  "identifierFilter": {
    "InterfaceFilter": {
      "value": {
        "interfaceId": "<packageHash>:<Module>:<Interface>",
        "includeCreatedEventBlob": false,
        "includeInterfaceView": true
      }
    }
  }
}
```

### Party Scoping

Filters can be scoped to specific parties or all parties:

```json
{
  "filter": {
    "filtersByParty": {
      "<partyId>": { "cumulative": [ ...filters ] }
    }
  }
}
```

```json
{
  "filter": {
    "filtersForAnyParty": {
      "cumulative": [ ...filters ]
    }
  }
}
```

## Environment Variables

### Public (VITE_ prefix, bundled in client)

| Variable | Description |
| -------- | ----------- |
| `VITE_DEPLOY_ENV` | `"vercel"` or `"local"` (default) |
| `VITE_NODES` | JSON array of node configs (single line) |

### Server-Side Only

| Variable | Description |
| -------- | ----------- |
| `CANTON_NODES_AUTH` | JSON map of OAuth2 credentials per node ID |
| `CANTON_ALLOWED_TARGETS` | Comma-separated proxy allowlist |
| `KV_REST_API_URL` | Upstash Redis URL |
| `KV_REST_API_TOKEN` | Upstash Redis token |
| `CRON_SECRET` | Bearer token for cron endpoint auth |
