# CIP-104 Traffic Attribution Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/traffic` page that fetches a Lighthouse transaction by UpdateId (DevNet or MainNet) through the existing proxy and computes CIP-0104 confirming-weight for user-ticked featured confirmers.

**Architecture:** Pure `attributeTraffic` + `resolveFeaturedApps` in `src/lib`. `src/api/lighthouse.ts` maps network → HTTPS origin and calls existing `/api/proxy` (Vercel) or `/proxy/remote` (Vite). The page does not use the selected Canton node. Featured-app ticks and network persist via Jotai `atomWithStorage`.

**Tech Stack:** React 19, React Router 7, Jotai, Axios, Vitest, existing shadcn/ui (`Select`, `Switch`, `Card`)

## Global Constraints

- CIP-0104 is not live on MainNet; page copy must call this an as-if calculator.
- Featured apps in v1 are only parties the user ticks. Nothing is featured until ticked.
- `FEATURED_APP_MODE` stays `'manual'`. Do not implement ACS/`FeaturedAppRight` lookup.
- `activityWeight` is always `1`.
- Lighthouse hosts are a fixed map only: DevNet `https://lighthouse.devnet.cantonloop.com`, MainNet `https://lighthouse.xyz`. Path `{origin}/api/transactions/{updateId}`. No free-form URL.
- Do not send Lighthouse credentials or `x-lighthouse-client`.
- Do not modify `api/proxy.ts` or `CANTON_ALLOWED_TARGETS`.
- TypeScript: `verbatimModuleSyntax` — use `import type` for types. No enums (`erasableSyntaxOnly`).
- Commits: subject + body only. No `Co-authored-by` trailers.

## File Map

### New files

| File | Responsibility |
|------|----------------|
| `src/types/lighthouse.ts` | Lighthouse verdict / traffic / view types |
| `src/lib/cip104.ts` | Envelope confirmer union, leftover scale, integer per-app weights |
| `src/lib/cip104.test.ts` | Attribution fixtures (TX_1 Tradeproposal, sole-app, zero ticks) |
| `src/lib/featuredApps.ts` | `resolveFeaturedApps` + `nextRemembered` + `FEATURED_APP_MODE` |
| `src/lib/featuredApps.test.ts` | Carry-ticks and remembered-set tests |
| `src/api/lighthouse.ts` | Host map, proxy URL, `fetchTransactionByUpdateId` |
| `src/api/lighthouse.test.ts` | Host map and path builder tests |
| `src/stores/cip104Store.ts` | Network, carry-ticks, remembered party ids |
| `src/pages/TrafficAttributionPage.tsx` | UI |
| `vitest.config.ts` | Vitest + `@/` alias |

### Modified files

| File | Change |
|------|--------|
| `package.json` | `vitest` devDep, `"test": "vitest run"` |
| `src/App.tsx` | `/traffic` route in viewer `ProtectedRoute` |
| `src/components/layout/Sidebar.tsx` | Nav item after Contracts |

---

### Task 1: Vitest runner

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: none
- Produces: `yarn test` runs Vitest against `src/**/*.test.ts` with `@/` → `src/`

- [ ] **Step 1: Install Vitest**

```bash
cd /Users/lehoanganh/Working/FETCH/Angelhack/Canton/canton-local-inspector
yarn add -D vitest
```

- [ ] **Step 2: Add test script**

In `package.json` `"scripts"`, add:

```json
"test": "vitest run"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
```

- [ ] **Step 4: Smoke-run Vitest**

Run: `yarn test`

Expected: Vitest starts and reports no test files (exit 1 is OK if it says "No test files found"; if it exits 0 with 0 files, that is also OK). Do not add a dummy test.

- [ ] **Step 5: Commit**

```bash
git add package.json yarn.lock vitest.config.ts
git commit -m "$(cat <<'EOF'
chore: add Vitest runner for CIP-104 unit tests

EOF
)"
```

---

### Task 2: Attribution engine

**Files:**
- Create: `src/types/lighthouse.ts`
- Create: `src/lib/cip104.ts`
- Test: `src/lib/cip104.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `partyHint(partyId: string): string`
  - `uniqueConfirmers(views: TransactionView[]): string[]`
  - `attributeTraffic(input: AttributeTrafficInput): AttributionResult`
  - Types: `TrafficSummary`, `TransactionView`, `ConfirmingPartyGroup`, `AttributeTrafficInput`, `EnvelopeAttribution`, `AppWeight`, `AttributionResult`

- [ ] **Step 1: Write types `src/types/lighthouse.ts`**

```ts
export interface ConfirmingPartyGroup {
  parties: string[]
  threshold: number
}

export interface TransactionView {
  view_id: number
  informees: string[]
  sub_views: number[]
  confirming_parties: ConfirmingPartyGroup[] | null
}

export interface EnvelopeTrafficSummary {
  view_ids: number[]
  traffic_cost: number
}

export interface TrafficSummary {
  total_traffic_cost: number
  envelope_traffic_summaries: EnvelopeTrafficSummary[]
}

export interface TransactionViews {
  views: TransactionView[]
}

export interface LighthouseVerdict {
  update_id: string
  record_time: string
  submitting_parties: string[] | null
  traffic_summary: TrafficSummary | null
  transaction_views: TransactionViews | null
}

export interface LighthouseTransaction {
  update_id: string
  record_time: string
  round: number
  traffic_cost: { bytes: number; cost_usd?: number; source?: string } | null
}

export interface LighthouseTransactionResponse {
  events: Record<string, unknown> & { verdict?: LighthouseVerdict }
  transaction: LighthouseTransaction
}
```

- [ ] **Step 2: Write failing tests `src/lib/cip104.test.ts`**

Use short party ids. Numbers must match integer CIP-104.

```ts
import { describe, expect, it } from 'vitest'
import { attributeTraffic, partyHint, uniqueConfirmers } from './cip104'
import type { TrafficSummary, TransactionView } from '@/types/lighthouse'

const KAIRO = 'kairo-executor::aaa'
const FIVE = 'fivenorth-devnet-1::bbb'
const USER = 'user::ccc'
const FAUCET = 'kairo-faucet-0::ddd'
const DSO = 'DSO::eee'

function groups(parties: string[]): TransactionView['confirming_parties'] {
  return [{ parties, threshold: parties.length }]
}

const tx1Views: TransactionView[] = [
  { view_id: 0, informees: [], sub_views: [], confirming_parties: groups([FIVE, KAIRO, FAUCET, USER]) },
  { view_id: 1, informees: [], sub_views: [], confirming_parties: groups([DSO, USER]) },
  { view_id: 2, informees: [], sub_views: [], confirming_parties: groups([DSO, USER]) },
  { view_id: 3, informees: [], sub_views: [], confirming_parties: groups([DSO, USER]) },
  { view_id: 4, informees: [], sub_views: [], confirming_parties: groups([DSO, USER]) },
  { view_id: 5, informees: [], sub_views: [], confirming_parties: groups([DSO, USER]) },
  { view_id: 6, informees: [], sub_views: [], confirming_parties: groups([DSO, USER]) },
  { view_id: 7, informees: [], sub_views: [], confirming_parties: groups([DSO, USER]) },
  { view_id: 8, informees: [], sub_views: [], confirming_parties: groups([DSO, USER]) },
  { view_id: 9, informees: [], sub_views: [], confirming_parties: groups([DSO, USER]) },
  { view_id: 10, informees: [], sub_views: [], confirming_parties: groups([USER, KAIRO, FAUCET]) },
]

const tx1Summary: TrafficSummary = {
  total_traffic_cost: 27324,
  envelope_traffic_summaries: [
    { view_ids: [0], traffic_cost: 3468 },
    { view_ids: [], traffic_cost: 5085 },
    { view_ids: [1, 2, 3, 4, 5, 7, 8], traffic_cost: 9673 },
    { view_ids: [10], traffic_cost: 2495 },
    { view_ids: [6, 9], traffic_cost: 6456 },
    { view_ids: [], traffic_cost: 147 },
  ],
}

describe('partyHint', () => {
  it('returns the prefix before ::', () => {
    expect(partyHint(KAIRO)).toBe('kairo-executor')
  })
})

describe('uniqueConfirmers', () => {
  it('unions confirming parties across views', () => {
    const ids = uniqueConfirmers(tx1Views)
    expect(ids).toEqual(expect.arrayContaining([KAIRO, FIVE, USER, FAUCET, DSO]))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('attributeTraffic TX_1 Tradeproposal', () => {
  it('redistributes leftover onto featured envelopes and splits co-confirmers', () => {
    const result = attributeTraffic({
      traffic: tx1Summary,
      views: tx1Views,
      featuredPartyIds: [KAIRO, FIVE],
      activityWeight: 1,
    })
    expect(result.total).toBe(27324)
    expect(result.appEnvelopeTraffic).toBe(5963)
    expect(result.leftover).toBe(21361)
    expect(result.weights.find((w) => w.partyId === KAIRO)?.weight).toBe(19377)
    expect(result.weights.find((w) => w.partyId === FIVE)?.weight).toBe(7945)
    expect(result.weightSum).toBe(27322)
  })

  it('returns zero weights when nothing is ticked', () => {
    const result = attributeTraffic({
      traffic: tx1Summary,
      views: tx1Views,
      featuredPartyIds: [],
      activityWeight: 1,
    })
    expect(result.appEnvelopeTraffic).toBe(0)
    expect(result.leftover).toBe(27324)
    expect(result.weights).toEqual([])
    expect(result.weightSum).toBe(0)
  })
})

describe('attributeTraffic sole featured app', () => {
  it('credits the whole request to the only featured confirmer', () => {
    const views: TransactionView[] = [
      { view_id: 0, informees: [], sub_views: [], confirming_parties: groups([KAIRO, USER, DSO]) },
    ]
    const traffic: TrafficSummary = {
      total_traffic_cost: 8572,
      envelope_traffic_summaries: [
        { view_ids: [], traffic_cost: 1537 },
        { view_ids: [], traffic_cost: 147 },
        { view_ids: [0], traffic_cost: 6888 },
      ],
    }
    const result = attributeTraffic({
      traffic,
      views,
      featuredPartyIds: [KAIRO],
      activityWeight: 1,
    })
    expect(result.weights[0]?.weight).toBe(8572)
    expect(result.weightSum).toBe(8572)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn test src/lib/cip104.test.ts`

Expected: FAIL — `Cannot find module './cip104'` or `partyHint is not a function`.

- [ ] **Step 4: Implement `src/lib/cip104.ts`**

```ts
import type {
  ConfirmingPartyGroup,
  EnvelopeTrafficSummary,
  TrafficSummary,
  TransactionView,
} from '@/types/lighthouse'

export interface AttributeTrafficInput {
  traffic: TrafficSummary
  views: TransactionView[]
  featuredPartyIds: string[]
  activityWeight: number
}

export interface EnvelopeAttribution {
  viewIds: number[]
  cost: number
  confirmers: string[]
  appConfirmers: string[]
  perApp: number
  leftover: boolean
}

export interface AppWeight {
  partyId: string
  hint: string
  weight: number
}

export interface AttributionResult {
  total: number
  appEnvelopeTraffic: number
  leftover: number
  weightSum: number
  envelopes: EnvelopeAttribution[]
  weights: AppWeight[]
}

export function partyHint(partyId: string): string {
  const i = partyId.indexOf('::')
  return i === -1 ? partyId : partyId.slice(0, i)
}

function viewConfirmers(view: TransactionView): string[] {
  const groups: ConfirmingPartyGroup[] = view.confirming_parties ?? []
  const out = new Set<string>()
  for (const g of groups) {
    for (const p of g.parties ?? []) out.add(p)
  }
  return [...out]
}

export function uniqueConfirmers(views: TransactionView[]): string[] {
  const out = new Set<string>()
  for (const v of views) {
    for (const p of viewConfirmers(v)) out.add(p)
  }
  return [...out]
}

function envelopeConfirmers(
  envelope: EnvelopeTrafficSummary,
  viewsById: Map<number, TransactionView>,
): string[] {
  const out = new Set<string>()
  for (const vid of envelope.view_ids ?? []) {
    const view = viewsById.get(vid)
    if (!view) continue
    for (const p of viewConfirmers(view)) out.add(p)
  }
  return [...out]
}

export function attributeTraffic(input: AttributeTrafficInput): AttributionResult {
  const featured = new Set(input.featuredPartyIds)
  const viewsById = new Map(input.views.map((v) => [v.view_id, v]))
  const total = input.traffic.total_traffic_cost
  const weightByParty = new Map<string, number>()

  const envelopes: EnvelopeAttribution[] = input.traffic.envelope_traffic_summaries.map((env) => {
    const confirmers = envelopeConfirmers(env, viewsById)
    const appConfirmers = confirmers.filter((p) => featured.has(p))
    return {
      viewIds: env.view_ids ?? [],
      cost: env.traffic_cost,
      confirmers,
      appConfirmers,
      perApp: 0,
      leftover: appConfirmers.length === 0,
    }
  })

  const appEnvelopeTraffic = envelopes
    .filter((e) => !e.leftover)
    .reduce((s, e) => s + e.cost, 0)

  if (appEnvelopeTraffic > 0) {
    for (const e of envelopes) {
      if (e.leftover) continue
      const n = e.appConfirmers.length
      const perApp = Math.trunc((e.cost * total) / (appEnvelopeTraffic * n))
      const weighted = Math.floor(perApp * input.activityWeight)
      e.perApp = weighted
      for (const p of e.appConfirmers) {
        weightByParty.set(p, (weightByParty.get(p) ?? 0) + weighted)
      }
    }
  }

  const weights: AppWeight[] = [...weightByParty.entries()]
    .map(([partyId, weight]) => ({ partyId, hint: partyHint(partyId), weight }))
    .sort((a, b) => b.weight - a.weight)

  const weightSum = weights.reduce((s, w) => s + w.weight, 0)
  return {
    total,
    appEnvelopeTraffic,
    leftover: total - appEnvelopeTraffic,
    weightSum,
    envelopes,
    weights,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test src/lib/cip104.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/types/lighthouse.ts src/lib/cip104.ts src/lib/cip104.test.ts
git commit -m "$(cat <<'EOF'
feat: add CIP-104 integer traffic attribution

EOF
)"
```

---

### Task 3: Featured-app resolver seam

**Files:**
- Create: `src/lib/featuredApps.ts`
- Test: `src/lib/featuredApps.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `FEATURED_APP_MODE: FeaturedAppMode` (`'manual'`)
  - `resolveFeaturedApps(input: ResolveFeaturedAppsInput): string[]`
  - `nextRemembered(remembered: string[], confirmers: string[], checked: string[]): string[]`

- [ ] **Step 1: Write failing tests `src/lib/featuredApps.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { nextRemembered, resolveFeaturedApps } from './featuredApps'

const A = 'ah::1'
const B = 'bitsafe::2'
const C = 'other::3'

describe('resolveFeaturedApps manual', () => {
  it('returns empty when carryTicks is off', () => {
    expect(resolveFeaturedApps({
      mode: 'manual',
      confirmers: [A, B],
      remembered: [A],
      carryTicks: false,
    })).toEqual([])
  })

  it('intersects remembered with this tx confirmers when carry is on', () => {
    expect(resolveFeaturedApps({
      mode: 'manual',
      confirmers: [A, B],
      remembered: [A, C],
      carryTicks: true,
    })).toEqual([A])
  })

  it('does not drop a remembered party that is absent from this tx', () => {
    const applied = resolveFeaturedApps({
      mode: 'manual',
      confirmers: [A],
      remembered: [A, C],
      carryTicks: true,
    })
    expect(applied).toEqual([A])
    expect(nextRemembered([A, C], [A], applied)).toEqual([C, A])
  })
})

describe('nextRemembered', () => {
  it('replaces this tx membership and keeps other remembered ids', () => {
    expect(nextRemembered([A, C], [A, B], [B])).toEqual([C, B])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test src/lib/featuredApps.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/featuredApps.ts`**

```ts
export type FeaturedAppMode = 'manual' | 'featuredAppRight'

export const FEATURED_APP_MODE: FeaturedAppMode = 'manual'

export interface ResolveFeaturedAppsInput {
  mode: FeaturedAppMode
  confirmers: string[]
  remembered: string[]
  carryTicks: boolean
}

export function resolveFeaturedApps(input: ResolveFeaturedAppsInput): string[] {
  if (input.mode === 'featuredAppRight') {
    throw new Error('featuredAppRight resolver is not implemented')
  }
  if (!input.carryTicks) return []
  const confirmerSet = new Set(input.confirmers)
  return input.remembered.filter((p) => confirmerSet.has(p))
}

export function nextRemembered(
  remembered: string[],
  confirmers: string[],
  checked: string[],
): string[] {
  const confirmerSet = new Set(confirmers)
  const kept = remembered.filter((p) => !confirmerSet.has(p))
  return [...kept, ...checked]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test src/lib/featuredApps.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/featuredApps.ts src/lib/featuredApps.test.ts
git commit -m "$(cat <<'EOF'
feat: add manual featured-app tick resolver with carry-ticks

EOF
)"
```

---

### Task 4: Persistence store

**Files:**
- Create: `src/stores/cip104Store.ts`

**Interfaces:**
- Consumes: none (Jotai `atomWithStorage` like [src/stores/nodeStore.ts](mdc:src/stores/nodeStore.ts))
- Produces:
  - `lighthouseNetworkAtom` `'devnet' | 'mainnet'`, key `canton-inspector-cip104-network`, default `'devnet'`
  - `carryTicksAtom` `boolean`, key `canton-inspector-cip104-carry-ticks`, default `false`
  - `rememberedFeaturedPartyIdsAtom` `string[]`, key `canton-inspector-cip104-featured-parties`, default `[]`
  - `export type LighthouseNetwork = 'devnet' | 'mainnet'`

- [ ] **Step 1: Create `src/stores/cip104Store.ts`**

```ts
import { atomWithStorage } from 'jotai/utils'

export type LighthouseNetwork = 'devnet' | 'mainnet'

export const lighthouseNetworkAtom = atomWithStorage<LighthouseNetwork>(
  'canton-inspector-cip104-network',
  'devnet',
)

export const carryTicksAtom = atomWithStorage<boolean>(
  'canton-inspector-cip104-carry-ticks',
  false,
)

export const rememberedFeaturedPartyIdsAtom = atomWithStorage<string[]>(
  'canton-inspector-cip104-featured-parties',
  [],
)
```

No unit test (storage atoms). Typecheck via later page import.

- [ ] **Step 2: Commit**

```bash
git add src/stores/cip104Store.ts
git commit -m "$(cat <<'EOF'
feat: persist CIP-104 network, carry-ticks, and featured parties

EOF
)"
```

---

### Task 5: Lighthouse client

**Files:**
- Create: `src/api/lighthouse.ts`
- Test: `src/api/lighthouse.test.ts`

**Interfaces:**
- Consumes: `LighthouseNetwork` from the store file (re-export from `lighthouse.ts` to avoid a store import in API tests — define `LighthouseNetwork` in `src/api/lighthouse.ts` and import that type in the store instead).

**Correction for type consistency:** move `LighthouseNetwork` to `src/api/lighthouse.ts`. Change Task 4's store to:

```ts
import { atomWithStorage } from 'jotai/utils'
import type { LighthouseNetwork } from '@/api/lighthouse'

export const lighthouseNetworkAtom = atomWithStorage<LighthouseNetwork>(
  'canton-inspector-cip104-network',
  'devnet',
)
```

If Task 4 already landed with the type in the store, move the type in this task: delete the store export, add it to `lighthouse.ts`, update the store import. Do not leave two competing type names.

- Produces:
  - `LIGHTHOUSE_HOSTS: Record<LighthouseNetwork, { apiOrigin: string; explorerOrigin: string }>`
  - `lighthouseExplorerUrl(network, updateId): string`
  - `lighthouseProxyRequestPath(network, updateId): string` — path after `/api/proxy` or `/proxy/remote`, i.e. `/{b64origin}/api/transactions/{id}`
  - `fetchTransactionByUpdateId(updateId, network): Promise<LighthouseTransactionResponse>`
  - throws `Error` with message `Transaction not found on this network` on HTTP 404
  - throws `Error` with message `Response has no traffic summary` when `events.verdict.traffic_summary` or `transaction_views` is missing

- [ ] **Step 1: If Task 4 exported `LighthouseNetwork` from the store, move it**

Update `src/stores/cip104Store.ts` to import the type from `@/api/lighthouse` after Step 3. Until then, write tests against functions that will live in `src/api/lighthouse.ts`.

- [ ] **Step 2: Write failing tests `src/api/lighthouse.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { LIGHTHOUSE_HOSTS, lighthouseExplorerUrl, lighthouseProxyRequestPath } from './lighthouse'

describe('LIGHTHOUSE_HOSTS', () => {
  it('maps devnet and mainnet API origins', () => {
    expect(LIGHTHOUSE_HOSTS.devnet.apiOrigin).toBe('https://lighthouse.devnet.cantonloop.com')
    expect(LIGHTHOUSE_HOSTS.mainnet.apiOrigin).toBe('https://lighthouse.xyz')
  })
})

describe('lighthouseExplorerUrl', () => {
  it('uses the network explorer origin', () => {
    expect(lighthouseExplorerUrl('devnet', 'abc')).toBe(
      'https://lighthouse.devnet.cantonloop.com/transactions/abc',
    )
    expect(lighthouseExplorerUrl('mainnet', 'abc')).toBe(
      'https://lighthouse.xyz/transactions/abc',
    )
  })
})

describe('lighthouseProxyRequestPath', () => {
  it('encodes origin as base64url then appends /api/transactions/{id}', () => {
    const path = lighthouseProxyRequestPath('devnet', '1220abc')
    expect(path.startsWith('/')).toBe(true)
    expect(path.endsWith('/api/transactions/1220abc')).toBe(true)
    expect(path).not.toContain('https://')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn test src/api/lighthouse.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/api/lighthouse.ts`**

Mirror [src/api/canton.ts](mdc:src/api/canton.ts) `encodeOriginBase64url` + `isVercel` remote path. Do not send extra headers.

```ts
import axios, { isAxiosError } from 'axios'
import type { LighthouseTransactionResponse } from '@/types/lighthouse'

export type LighthouseNetwork = 'devnet' | 'mainnet'

export const LIGHTHOUSE_HOSTS: Record<LighthouseNetwork, { apiOrigin: string; explorerOrigin: string }> = {
  devnet: {
    apiOrigin: 'https://lighthouse.devnet.cantonloop.com',
    explorerOrigin: 'https://lighthouse.devnet.cantonloop.com',
  },
  mainnet: {
    apiOrigin: 'https://lighthouse.xyz',
    explorerOrigin: 'https://lighthouse.xyz',
  },
}

const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'

function encodeOriginBase64url(origin: string): string {
  return btoa(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function lighthouseExplorerUrl(network: LighthouseNetwork, updateId: string): string {
  return `${LIGHTHOUSE_HOSTS[network].explorerOrigin}/transactions/${updateId}`
}

export function lighthouseProxyRequestPath(network: LighthouseNetwork, updateId: string): string {
  const encoded = encodeOriginBase64url(LIGHTHOUSE_HOSTS[network].apiOrigin)
  return `/${encoded}/api/transactions/${encodeURIComponent(updateId)}`
}

function lighthouseProxyUrl(network: LighthouseNetwork, updateId: string): string {
  const rest = lighthouseProxyRequestPath(network, updateId)
  if (isVercel) return `/api/proxy${rest}`
  return `/proxy/remote${rest}`
}

export async function fetchTransactionByUpdateId(
  updateId: string,
  network: LighthouseNetwork,
): Promise<LighthouseTransactionResponse> {
  try {
    const res = await axios.get<LighthouseTransactionResponse>(
      lighthouseProxyUrl(network, updateId),
      { timeout: 30000 },
    )
    const data = res.data
    const verdict = data.events?.verdict
    if (!verdict?.traffic_summary || !verdict.transaction_views?.views) {
      throw new Error('Response has no traffic summary')
    }
    return data
  } catch (err) {
    if (err instanceof Error && err.message === 'Response has no traffic summary') throw err
    if (isAxiosError(err) && err.response?.status === 404) {
      throw new Error('Transaction not found on this network')
    }
    if (isAxiosError(err) && err.response?.status === 401) {
      throw new Error('Sign in to use the proxy')
    }
    if (isAxiosError(err) && err.response?.status === 502) {
      const details = (err.response.data as { details?: string } | undefined)?.details
      throw new Error(details ? `Proxy request failed: ${details}` : 'Proxy request failed')
    }
    throw err instanceof Error ? err : new Error('Failed to fetch transaction')
  }
}
```

- [ ] **Step 5: Point the store at `LighthouseNetwork` from this file**

`src/stores/cip104Store.ts` must import `type { LighthouseNetwork } from '@/api/lighthouse'` and must not export its own copy of the type.

- [ ] **Step 6: Run tests**

Run: `yarn test src/api/lighthouse.test.ts src/lib/cip104.test.ts src/lib/featuredApps.test.ts`

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api/lighthouse.ts src/api/lighthouse.test.ts src/stores/cip104Store.ts
git commit -m "$(cat <<'EOF'
feat: fetch Lighthouse transactions via existing proxy

EOF
)"
```

---

### Task 6: Traffic page, route, and sidebar

**Files:**
- Create: `src/pages/TrafficAttributionPage.tsx`
- Modify: `src/App.tsx` — add `/traffic` next to `/contracts`
- Modify: `src/components/layout/Sidebar.tsx` — import `Gauge` from `lucide-react`; add `{ to: '/traffic', icon: Gauge, label: 'Traffic (CIP-104)' }` immediately after the Contracts item

**Interfaces:**
- Consumes: `fetchTransactionByUpdateId`, `lighthouseExplorerUrl`, `LighthouseNetwork`, `attributeTraffic`, `uniqueConfirmers`, `partyHint`, `FEATURED_APP_MODE`, `resolveFeaturedApps`, `nextRemembered`, store atoms
- Produces: `/traffic` viewer page

- [ ] **Step 1: Add the route in `src/App.tsx`**

Import:

```ts
import { TrafficAttributionPage } from '@/pages/TrafficAttributionPage'
```

Inside the first `<ProtectedRoute><MainLayout /></ProtectedRoute>` block, after the contracts route:

```tsx
<Route path="/traffic" element={<TrafficAttributionPage />} />
```

- [ ] **Step 2: Add the nav item in `src/components/layout/Sidebar.tsx`**

Add `Gauge` to the `lucide-react` import. In `navItems`, after Contracts:

```ts
{ to: '/traffic', icon: Gauge, label: 'Traffic (CIP-104)' },
```

- [ ] **Step 3: Create `src/pages/TrafficAttributionPage.tsx`**

Behavior required by the spec:

- Subtitle: as-if CIP-104 calculator; does not use the selected Canton node.
- Network `Select` (DevNet / MainNet) bound to `lighthouseNetworkAtom`. Changing network clears `result` / `searchError`. If `?updateId=` is present, refetch after the network change.
- UpdateId `ClearableInput` + Search button (disabled when empty or searching). Enter submits.
- Switch labeled `Remember featured apps for next search` bound to `carryTicksAtom`.
- On search: clear previous result first; fetch; `confirmers = uniqueConfirmers(views)`; `checked = resolveFeaturedApps({ mode: FEATURED_APP_MODE, confirmers, remembered, carryTicks })`; run `attributeTraffic` with `activityWeight: 1`.
- Ticking a checkbox updates `checked` (subset of confirmers), recomputes attribution, writes `rememberedFeaturedPartyIdsAtom` via `nextRemembered`.
- Success meta: network, record time, round, submitter hint, total bytes, USD if present, explorer `Link`/`<a target="_blank">`.
- Checkboxes: one per confirmer, label `partyHint` + truncated fingerprint (`truncateId`). Show `ticked / total`.
- Envelope table columns: views (`(empty)` if none), cost, confirmer hints, ticked app confirmer hints, per-app share or `leftover`.
- Per-app totals table: hint, full id (`IdDisplay`), weight.
- `<details>` raw JSON via `JsonViewer` on the full response.
- If `events` has no keys other than `verdict`, show muted note: events hidden (privacy); attribution uses the verdict.
- Errors: `ErrorDisplay` for thrown messages. 404 uses `EmptyState` with title `Transaction not found` and description including the network.
- Support `useSearchParams`: on mount, if `network` is `devnet` or `mainnet`, set the atom; if `updateId` is non-empty, set the input and search. After a successful search, `setSearchParams` to `{ updateId, network }` (`replace: true`).

Full page (keep this structure; do not add ACS/node hooks):

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAtom } from 'jotai'
import { Gauge, RefreshCw, Search } from 'lucide-react'
import { fetchTransactionByUpdateId, lighthouseExplorerUrl, type LighthouseNetwork } from '@/api/lighthouse'
import { ClearableInput } from '@/components/common/ClearableInput'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { IdDisplay } from '@/components/common/IdDisplay'
import { JsonViewer } from '@/components/common/JsonViewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { attributeTraffic, uniqueConfirmers, partyHint } from '@/lib/cip104'
import { FEATURED_APP_MODE, nextRemembered, resolveFeaturedApps } from '@/lib/featuredApps'
import {
  carryTicksAtom,
  lighthouseNetworkAtom,
  rememberedFeaturedPartyIdsAtom,
} from '@/stores/cip104Store'
import type { LighthouseTransactionResponse } from '@/types/lighthouse'
import { truncateId } from '@/lib/utils'

function isLighthouseNetwork(v: string | null): v is LighthouseNetwork {
  return v === 'devnet' || v === 'mainnet'
}

function hasVisibleEvents(events: LighthouseTransactionResponse['events']): boolean {
  return Object.keys(events).some((k) => k !== 'verdict')
}

export function TrafficAttributionPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [network, setNetwork] = useAtom(lighthouseNetworkAtom)
  const [carryTicks, setCarryTicks] = useAtom(carryTicksAtom)
  const [remembered, setRemembered] = useAtom(rememberedFeaturedPartyIdsAtom)

  const [updateId, setUpdateId] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [response, setResponse] = useState<LighthouseTransactionResponse | null>(null)
  const [checked, setChecked] = useState<string[]>([])

  const verdict = response?.events.verdict
  const views = verdict?.transaction_views?.views ?? []
  const traffic = verdict?.traffic_summary
  const confirmers = useMemo(() => uniqueConfirmers(views), [views])

  const attribution = useMemo(() => {
    if (!traffic) return null
    return attributeTraffic({
      traffic,
      views,
      featuredPartyIds: checked,
      activityWeight: 1,
    })
  }, [traffic, views, checked])

  const runSearch = useCallback(async (id: string, net: LighthouseNetwork) => {
    const trimmed = id.trim()
    if (!trimmed) return
    setSearching(true)
    setSearchError(null)
    setNotFound(false)
    setResponse(null)
    setChecked([])
    try {
      const data = await fetchTransactionByUpdateId(trimmed, net)
      const v = data.events.verdict
      const nextConfirmers = uniqueConfirmers(v?.transaction_views?.views ?? [])
      const nextChecked = resolveFeaturedApps({
        mode: FEATURED_APP_MODE,
        confirmers: nextConfirmers,
        remembered,
        carryTicks,
      })
      setResponse(data)
      setChecked(nextChecked)
      setSearchParams({ updateId: trimmed, network: net }, { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch transaction'
      if (message === 'Transaction not found on this network') {
        setNotFound(true)
      } else {
        setSearchError(message)
      }
    } finally {
      setSearching(false)
    }
  }, [carryTicks, remembered, setSearchParams])

  useEffect(() => {
    const qNet = searchParams.get('network')
    const qId = searchParams.get('updateId')
    if (isLighthouseNetwork(qNet) && qNet !== network) setNetwork(qNet)
    if (qId && !response && !searching && !searchError && !notFound) {
      setUpdateId(qId)
      void runSearch(qId, isLighthouseNetwork(qNet) ? qNet : network)
    }
    // Intentionally mount-only for query-param bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onToggleParty(partyId: string, isOn: boolean) {
    const next = isOn
      ? [...checked, partyId]
      : checked.filter((p) => p !== partyId)
    setChecked(next)
    setRemembered(nextRemembered(remembered, confirmers, next))
  }

  function onNetworkChange(next: LighthouseNetwork) {
    setNetwork(next)
    setResponse(null)
    setSearchError(null)
    setNotFound(false)
    setChecked([])
    const qId = searchParams.get('updateId')?.trim() || updateId.trim()
    if (qId) void runSearch(qId, next)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Traffic (CIP-104)</h2>
        <p className="text-muted-foreground text-sm mt-1">
          As-if CIP-0104 confirming-weight calculator. Uses Lighthouse, not the selected Canton node.
          Rewards are not live on MainNet.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-40">
              <label className="text-xs text-muted-foreground mb-1 block">Network</label>
              <Select value={network} onValueChange={(v) => onNetworkChange(v as LighthouseNetwork)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="devnet">DevNet</SelectItem>
                  <SelectItem value="mainnet">MainNet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[16rem]">
              <label className="text-xs text-muted-foreground mb-1 block">UpdateId</label>
              <ClearableInput
                placeholder="Paste UpdateId..."
                value={updateId}
                onChange={(v) => { setUpdateId(v); setNotFound(false) }}
                onSubmit={() => void runSearch(updateId, network)}
              />
            </div>
            <Button
              size="sm"
              onClick={() => void runSearch(updateId, network)}
              disabled={searching || !updateId.trim()}
            >
              {searching ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-1.5" />}
              {searching ? 'Searching...' : 'Search'}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={carryTicks} onCheckedChange={setCarryTicks} id="carry-ticks" />
            <label htmlFor="carry-ticks" className="text-xs text-muted-foreground">
              Remember featured apps for next search
            </label>
          </div>
        </CardContent>
      </Card>

      {searchError && <ErrorDisplay error={searchError} />}
      {notFound && (
        <EmptyState
          icon={Gauge}
          title="Transaction not found"
          description={`No transaction with this UpdateId on ${network}.`}
        />
      )}

      {response && verdict && traffic && attribution && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Transaction</CardTitle>
              <CardDescription className="flex flex-wrap gap-2 items-center">
                <Badge variant="outline" className="text-[10px]">{network}</Badge>
                <span className="text-xs">round {response.transaction.round}</span>
                <span className="text-xs">{verdict.record_time}</span>
                <span className="text-xs">{attribution.total.toLocaleString()} B</span>
                {response.transaction.traffic_cost?.cost_usd != null && (
                  <span className="text-xs">${response.transaction.traffic_cost.cost_usd}</span>
                )}
                <a
                  className="text-xs text-primary underline"
                  href={lighthouseExplorerUrl(network, response.transaction.update_id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Lighthouse
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div>Submitter: {partyHint(verdict.submitting_parties?.[0] ?? 'unknown')}</div>
              <div>
                App envelopes {attribution.appEnvelopeTraffic.toLocaleString()} B · leftover {attribution.leftover.toLocaleString()} B · attributed {attribution.weightSum.toLocaleString()} B
              </div>
              {!hasVisibleEvents(response.events) && (
                <p>Events hidden (privacy). Attribution uses the mediator verdict.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Featured apps</CardTitle>
              <CardDescription>
                {checked.length} / {confirmers.length} ticked. Nothing is featured until you tick it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {confirmers.map((partyId) => (
                <label key={partyId} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked.includes(partyId)}
                    onChange={(e) => onToggleParty(partyId, e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">{partyHint(partyId)}</span>
                    <span className="block font-mono text-[10px] text-muted-foreground">{truncateId(partyId, 12)}</span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Envelopes</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-2">Views</th>
                    <th className="p-2 text-right">Cost</th>
                    <th className="p-2">Confirmers</th>
                    <th className="p-2">Featured</th>
                    <th className="p-2 text-right">Per app</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.envelopes.map((e, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 font-mono">{e.viewIds.length ? e.viewIds.join(', ') : '(empty)'}</td>
                      <td className="p-2 text-right font-mono">{e.cost.toLocaleString()}</td>
                      <td className="p-2">{e.confirmers.map(partyHint).join(', ') || '—'}</td>
                      <td className="p-2">{e.appConfirmers.map(partyHint).join(', ') || '—'}</td>
                      <td className="p-2 text-right font-mono">{e.leftover ? 'leftover' : e.perApp.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Per-app weights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {attribution.weights.length === 0 && (
                <p className="text-xs text-muted-foreground">Tick featured confirmers to attribute leftover traffic.</p>
              )}
              {attribution.weights.map((w) => (
                <div key={w.partyId} className="flex items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium">{w.hint}</div>
                    <IdDisplay id={w.partyId} truncate={12} />
                  </div>
                  <span className="font-mono">{w.weight.toLocaleString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <details>
            <summary className="text-xs text-muted-foreground cursor-pointer">Raw JSON</summary>
            <JsonViewer data={response} />
          </details>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `yarn build`

Expected: `tsc -b` succeeds (or at least `TrafficAttributionPage` has no type errors). If `tsc` fails on unused vars, remove them (`noUnusedLocals` is on). The mount `useEffect` may warn; keep the eslint disable comment.

- [ ] **Step 5: Run unit tests**

Run: `yarn test`

Expected: all existing unit tests PASS.

- [ ] **Step 6: Manual check (yarn dev)**

1. Open `/traffic`. Confirm sidebar link. Confirm subtitle mentions as-if / not the selected node.
2. DevNet UpdateId `1220648c76365556bec1ffb543cf4dfb30a97ebc17ecbe0a76566ad319ed2f51f4ce`. Tick `kairo-executor` and `fivenorth-devnet-1`. Expect weights 19,377 and 7,945.
3. Turn carry on, search a second UpdateId from the CIP-104 CSV that shares those parties — they stay ticked if they confirm.
4. Turn carry off, search again — empty ticks.
5. Reload the page — network, carry switch, and remembered ticks survive.
6. Switch to MainNet with a garbage id — empty state “not found on mainnet”.
7. Open `/traffic?updateId=1220648c76365556bec1ffb543cf4dfb30a97ebc17ecbe0a76566ad319ed2f51f4ce&network=devnet` — auto-fetches.

- [ ] **Step 7: Commit**

```bash
git add src/pages/TrafficAttributionPage.tsx src/App.tsx src/components/layout/Sidebar.tsx
git commit -m "$(cat <<'EOF'
feat: add CIP-104 traffic attribution page

EOF
)"
```

---

## Self-review

**Spec coverage**

| Spec item | Task |
|-----------|------|
| `/traffic` page, viewer route, sidebar | 6 |
| Proxy fetch, no new serverless route | 5 |
| DevNet / MainNet host map | 5 |
| User-ticked confirmers | 6 |
| `resolveFeaturedApps` manual + later seam | 3 |
| Carry-ticks switch | 6 |
| localStorage network + carry + remembered | 4 |
| Integer CIP-104 leftover scale | 2 |
| Zero ticks → no divide by zero | 2 |
| 404 / 401 / 502 / missing verdict | 5 + 6 |
| Privacy (no events) note | 6 |
| `?updateId=` + `?network=` | 6 |
| Vitest fixtures TX_1 / sole app / carry | 1–3 |
| Out of scope FAR / activityWeight / CSV | not in plan |

**Placeholders:** none. **Types:** `LighthouseNetwork` lives in `src/api/lighthouse.ts`; store imports it.
