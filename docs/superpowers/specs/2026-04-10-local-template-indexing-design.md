# Local Template Indexing & Docker Compose Deployment

## Overview

Bring the Vercel cron-based template indexing capability to local development by introducing a PostgreSQL-backed storage layer and an Express server that serves the production build, handles API routes, and runs an in-process cron job every 10 minutes. Packaged as a Docker Compose setup (app + PostgreSQL) to replace `yarn dev`.

**Constraint:** Zero changes to the existing Vercel deployment path. All new behavior is gated behind `VITE_DEPLOY_ENV=local`.

## Architecture

### Current State (Vercel)

```
Vercel Cron (daily) → /api/cron/index-templates → Upstash Redis
Frontend → /api/templates → Upstash Redis → template list
```

### New State (Local Docker)

```
In-process node-cron (every 10 min) → indexing logic → PostgreSQL
Express server → /api/templates → PostgreSQL → template list
Express server → serves dist/ static files (Vite build output)
Express server → /api/proxy, /api/auth/token (same as Vercel handlers)
```

### Container Layout

```
docker-compose.yml
├── app (Node.js 22 Alpine)
│   ├── Express server (port 3000)
│   ├── Serves dist/ static files
│   ├── API routes: /api/templates, /api/cron/index-templates, /api/proxy, /api/auth/token
│   └── node-cron: runs indexing every 10 minutes
└── postgres (PostgreSQL 16 Alpine)
    ├── port 5432
    └── database: canton_inspector
```

## Storage Abstraction

A thin `TemplateStorage` interface allows the indexing logic and API routes to work against either Redis (Vercel) or PostgreSQL (local) without code duplication.

### Interface

```typescript
interface TemplateStorage {
  // Template index
  getTemplateIndex(network: string): Promise<TemplateIndex | null>
  setTemplateIndex(network: string, data: TemplateIndex): Promise<void>

  // Cron metadata
  getCronMeta(): Promise<CronMeta | null>
  setCronMeta(meta: CronMeta): Promise<void>

  // Cooldown
  getLastRunTimestamp(): Promise<number | null>
  setLastRunTimestamp(ts: number): Promise<void>

  // Lock
  acquireLock(ttlSeconds: number): Promise<boolean>
  releaseLock(): Promise<void>

  // OAuth2 credentials (for dynamic nodes)
  getCredentials(nodeId: string): Promise<NodeAuthConfig | null>
}
```

### Implementations

- **`RedisStorage`** — wraps existing `@upstash/redis` calls (extract from current inline code in `index-templates.ts` and `templates.ts`)
- **`PostgresStorage`** — uses `pg` library against the Docker PostgreSQL instance

### PostgreSQL Schema

```sql
CREATE TABLE IF NOT EXISTS template_index (
  network TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cron_meta (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cron_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ
);
```

- `template_index`: one row per network, `data` contains `{ updatedAt, network, templates[] }`
- `cron_meta`: singleton row for last run metadata
- `cron_state`: key-value for `lastRunTs` and `lock` (with TTL via `expires_at`)

### Storage Factory

```typescript
function getStorage(): TemplateStorage {
  if (process.env.DATABASE_URL) return new PostgresStorage(process.env.DATABASE_URL)
  return new RedisStorage() // Existing Upstash Redis
}
```

The factory checks for `DATABASE_URL` (set by docker-compose) to decide. On Vercel, `DATABASE_URL` is never set, so Redis is used. This avoids coupling to `VITE_DEPLOY_ENV` in backend code.

## Express Server (`server/index.ts`)

A new `server/` directory at the project root (not inside `src/` which is frontend-only):

```
server/
├── index.ts          # Express app entry point
├── storage/
│   ├── interface.ts  # TemplateStorage interface
│   ├── redis.ts      # RedisStorage (extracted from existing code)
│   └── postgres.ts   # PostgresStorage (new)
├── routes/
│   ├── templates.ts  # GET /api/templates
│   ├── indexer.ts    # GET/POST /api/cron/index-templates
│   ├── proxy.ts      # ALL /api/proxy/*
│   └── token.ts      # POST /api/auth/token
├── cron.ts           # node-cron scheduler
└── db-init.ts        # PostgreSQL schema initialization
```

### Server Entry Point

- Initializes PostgreSQL schema on startup (`db-init.ts`)
- Mounts API routes under `/api`
- Serves `dist/` as static files with SPA fallback (`index.html` for non-API routes)
- Starts `node-cron` schedule: `*/10 * * * *` (every 10 minutes)
- Runs initial indexing on startup (after a 5-second delay to let postgres stabilize)
- Listens on port 3000

### Route Adaptation

The existing Vercel handlers use `(req: VercelRequest, res: VercelResponse)`. The Express server will adapt these by:
1. Extracting the core logic from each handler into shared functions
2. Creating Express route handlers that call the shared functions
3. The shared functions accept the `TemplateStorage` instance, decoupling from Redis

**Key difference from Vercel handlers:**
- `proxy.ts`: No localhost rejection (local proxy should forward to localhost Canton nodes)
- `proxy.ts`: No session cookie auth check (local mode uses mock admin)
- `token.ts`: Reads `CANTON_NODES_AUTH` from env (no Redis credential lookup needed locally)
- `index-templates.ts`: No CRON_SECRET auth required (local cron is in-process)
- `index-templates.ts`: Does NOT skip localhost nodes (primary use case for local indexing)

## Indexing Behavior Changes for Local

The current cron handler (`api/cron/index-templates.ts`) skips localhost nodes:
```typescript
if (netNodes.every((n) => isLocalhost(n.jsonApiUrl))) {
  results[network] = { status: 'skipped', ... }
}
```

The local Express version removes this skip — localhost Canton nodes are the primary target for local indexing. Remote nodes (devnet, mainnet) are also indexed if configured in `VITE_NODES`.

## Frontend Changes

Minimal. The `useDiscoverTemplates` hook currently checks `VITE_DEPLOY_ENV === 'vercel'` to decide whether to fetch from the template index API. Change this to:

```typescript
// Before: only use index on Vercel
if (isVercel) {
  const index = await api.fetchTemplateIndex(networkKey)
  ...
}

// After: use index when available (both Vercel and local Docker)
const index = await api.fetchTemplateIndex(networkKey)
if (index.templates.length > 0) {
  return index.templates.map(...)
}
// Fall back to live discovery only if index is empty
```

This way the frontend tries the index API first regardless of deploy env. If the index is empty (e.g., running `yarn dev` without Docker), it falls back to live discovery as today.

Similarly, update `useTemplateIndex` and `useCronMeta` hooks to remove the `enabled: isVercel` gate.

The `/api/templates` endpoint path stays the same — the Express server serves it at the same URL, so no route changes needed in the frontend.

## Docker Setup

### Dockerfile

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build
RUN npx tsx --version > /dev/null  # Ensure tsx is available

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
```

The server runs via `tsx` (TypeScript execution without a separate compile step). The `.env` file is NOT baked into the image — it's mounted at runtime via docker-compose `env_file`.

### docker-compose.yml

```yaml
version: "3.8"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: canton_inspector
      POSTGRES_USER: canton
      POSTGRES_PASSWORD: canton
    ports:
      - "5433:5432"  # Offset to avoid conflict with host postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U canton -d canton_inspector"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql://canton:canton@postgres:5432/canton_inspector
      VITE_DEPLOY_ENV: local
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

### .dockerignore

```
node_modules
dist
.git
*.md
```

## New Dependencies

- `express` + `@types/express` — HTTP server
- `pg` + `@types/pg` — PostgreSQL client
- `node-cron` + `@types/node-cron` — In-process cron scheduler
- `tsx` (dev dependency) — Run TypeScript server directly (alternative: compile with tsc)

## Environment Variables

### New (local Docker only)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://canton:canton@postgres:5432/canton_inspector` | PostgreSQL connection (set by docker-compose) |
| `CRON_SCHEDULE` | `*/10 * * * *` | Indexing interval (configurable) |
| `PORT` | `3000` | Express server port |

### Existing (unchanged)

All existing env vars (`VITE_NODES`, `CANTON_NODES_AUTH`, etc.) work as-is. The `.env` file is mounted into the Docker container.

## What Does NOT Change

- `vercel.json` — untouched
- `api/` directory — all Vercel serverless functions remain as-is
- `vite.config.ts` — untouched (still works for `yarn dev`)
- `yarn dev` — still works for quick local development without Docker
- Vercel deployment — no behavioral changes whatsoever
- `package.json` scripts — `dev`, `build`, `lint`, `preview` unchanged

## New package.json Scripts

```json
{
  "docker:build": "docker compose build",
  "docker:up": "docker compose up -d",
  "docker:down": "docker compose down",
  "docker:logs": "docker compose logs -f app"
}
```

## Testing Plan

1. **Unit**: Storage abstraction — verify PostgresStorage and RedisStorage produce same results
2. **Integration**: Run `docker compose up`, verify:
   - App accessible at http://localhost:3000
   - Template indexing runs on startup and every 10 minutes
   - `/api/templates?network=...` returns indexed templates
   - Contract explorer uses indexed templates (no live discovery fallback)
   - Proxy routes work for both localhost and remote Canton nodes
   - Token exchange works for OAuth2 nodes
3. **Regression**: Verify `yarn dev` still works without Docker/PostgreSQL
4. **Production**: Deploy to Vercel, verify no behavioral changes (cron still uses Redis, all routes work)

## Build Sequence

1. Create storage abstraction (`server/storage/`)
2. Refactor `api/cron/index-templates.ts` to extract shared indexing logic
3. Create Express server with routes
4. Create PostgreSQL schema init
5. Create `node-cron` scheduler
6. Update frontend hooks to use index regardless of deploy env
7. Create Dockerfile and docker-compose.yml
8. Add `.dockerignore` and npm scripts
9. Test end-to-end locally
