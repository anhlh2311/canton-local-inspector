# CIP-104 Traffic Attribution Page

## Overview

Add a viewer-role page where a user pastes a Canton `UpdateId`, the app fetches the DevNet Lighthouse transaction through the existing Vercel/Express proxy, and CIP-0104 confirming-weight is computed for featured-app parties the user ticks from that transaction’s confirmers.

This page does not use the selected participant node. It is a global-synchronizer calculator, not an ACS explorer.

**Status:** CIP-0104 is not live on MainNet. The page is an as-if calculator. Copy should say that.

## Decisions

| Topic | Choice |
|---|---|
| Shape | New `/traffic` page (option A). Not a Contracts tab. |
| Fetch | Existing `/api/proxy` to `https://lighthouse.devnet.cantonloop.com`. No new serverless route. |
| Lighthouse auth | None. No API key. Do not send `x-lighthouse-client`. |
| Featured apps (v1) | User ticks from this transaction’s unique confirming parties. Nothing is featured until ticked. |
| Featured apps (later) | Same tick list, filled by `resolveFeaturedApps(..., 'featuredAppRight')`. |
| Carry ticks | Optional switch. On: next search checks `remembered ∩ thisTxConfirmers`. Off: empty set. |
| Persistence | Switch + remembered party ids in `localStorage` via Jotai `atomWithStorage` (same pattern as [nodeStore.ts](mdc:src/stores/nodeStore.ts)). |
| `activityWeight` | Always `1.0` in v1. |
| Localnet | Out of scope. Empty-state if Lighthouse is unreachable. |

## Architecture

```
Browser
  TrafficAttributionPage
    → fetchTransaction(updateId)
        GET /api/proxy/{b64(https://lighthouse.devnet.cantonloop.com)}/api/transactions/{updateId}
        → api/proxy.ts (session cookie on Vercel) → Lighthouse
    → uniqueConfirmers(verdict.transaction_views)
    → resolveFeaturedApps({ mode: 'manual', confirmers, remembered, carryTicks })
    → attributeTraffic(verdict.traffic_summary, views, featuredPartyIds)
    → envelope table + per-app totals
```

No changes to [api/proxy.ts](mdc:api/proxy.ts) or `CANTON_ALLOWED_TARGETS`. HTTPS origins are already allowed.

## Components

### Files

| File | Role |
|---|---|
| [src/types/lighthouse.ts](mdc:src/types/lighthouse.ts) | Lighthouse `events` + `transaction` + `verdict` shapes used by the calculator |
| [src/lib/cip104.ts](mdc:src/lib/cip104.ts) | Pure attribution: envelope confirmer union, leftover scale, integer per-app weights |
| [src/lib/featuredApps.ts](mdc:src/lib/featuredApps.ts) | `resolveFeaturedApps` seam (`manual` now, `featuredAppRight` later) |
| [src/api/lighthouse.ts](mdc:src/api/lighthouse.ts) | `fetchTransactionByUpdateId(updateId)` via existing proxy helper |
| [src/stores/cip104Store.ts](mdc:src/stores/cip104Store.ts) | `carryTicks` + `rememberedFeaturedPartyIds` atoms |
| [src/pages/TrafficAttributionPage.tsx](mdc:src/pages/TrafficAttributionPage.tsx) | Input, switch, checkboxes, results |
| [src/lib/cip104.test.ts](mdc:src/lib/cip104.test.ts) | Fixture tests (TX_1 Tradeproposal + carry-ticks cases) |

Wire-up only:

- Route in [App.tsx](mdc:src/App.tsx) inside the existing viewer `<ProtectedRoute>` (same gate as Overview / Contracts).
- Nav item in [Sidebar.tsx](mdc:src/components/layout/Sidebar.tsx): `{ to: '/traffic', icon: Gauge, label: 'Traffic (CIP-104)' }` after Contracts.

Reuse: `ClearableInput`, `Button`, `Card`, `Switch`, `Badge`, `JsonViewer`, `ErrorDisplay`, `EmptyState`, `LoadingSpinner`, `CopyButton`, `IdDisplay`.

### `resolveFeaturedApps` seam

```ts
type FeaturedAppMode = 'manual' | 'featuredAppRight'

function resolveFeaturedApps(input: {
  mode: FeaturedAppMode
  confirmers: string[]          // unique confirming party ids on this tx
  remembered: string[]          // persisted ticks
  carryTicks: boolean
}): string[]
```

- `manual` + `carryTicks === false` → `[]`
- `manual` + `carryTicks === true` → `remembered` filtered to `confirmers`
- `featuredAppRight` → not implemented in v1; function throws or is unreachable. Call site stays `mode: 'manual'` from a constant so a later resolver can swap the constant without changing the page layout.

### Persistence

Jotai keys, defaulting carry **off**:

- `canton-inspector-cip104-carry-ticks`: `boolean`, default `false`
- `canton-inspector-cip104-featured-parties`: `string[]`, default `[]` (full party ids, not hints)

On a successful fetch:

1. Build `confirmers` from the verdict.
2. `checked = resolveFeaturedApps({ mode: 'manual', confirmers, remembered, carryTicks })`.
3. Recalculate attribution from `checked`.

When the user ticks or unticks a confirmer on this transaction:

1. Update `checked` (must stay a subset of `confirmers`).
2. Recalculate immediately.
3. Write remembered as `(remembered − confirmers) ∪ checked`. Parties not on this tx stay remembered; this tx’s ticks replace their membership.

Turning carry **off** does not clear remembered. It only makes the next search start empty. Turning it **on** applies remembered again.

### Attribution (`cip104.ts`)

Confirmers of an envelope = union of `confirming_parties[].parties` across that envelope’s `view_ids`. Empty `view_ids` (mediator tree, root hashes) have no confirmers.

App confirmers of an envelope = envelope confirmers ∩ ticked featured set.

```
total = traffic_summary.total_traffic_cost
app_envelope_traffic = sum(cost of envelopes with num_app_confirmers > 0)

per_app = (envelope_cost * total) / (app_envelope_traffic * num_app_confirmers)
```

Integer division (`Math.trunc` / `//`). Attribute `per_app` to every app confirmer of that envelope. Then `floor(per_app * activityWeight)` with `activityWeight = 1`.

If `app_envelope_traffic === 0` (nothing ticked, or no featured confirmer on any envelope), every featured weight is `0`. Show leftover = `total`. Do not divide by zero.

Sanity: sum of attributed weights equals `total` within integer rounding (gap of a few bytes is expected). Display `total`, `app_envelope_traffic`, `leftover`, and `weight_sum`.

Party labels: hint = substring before `::`. Full id remains the tick key.

### Page layout

1. Title + one-line subtitle: DevNet Lighthouse, as-if CIP-104, does not use the selected node.
2. UpdateId field + Search (Enter submits), modeled on `ContractIdTab` in [ContractsPage.tsx](mdc:src/pages/ContractsPage.tsx).
3. Switch: “Remember featured apps for next search”.
4. After success:
   - Meta: record time, round, submitter hint, total bytes, USD if present, link to `https://lighthouse.devnet.cantonloop.com/transactions/{updateId}`.
   - Featured-app checkboxes: one per unique confirmer, label `hint` + truncated fingerprint. Count of ticked / total.
   - Envelope table: view ids (or “(empty)”), cost, all confirmers (hints), ticked app confirmers, CIP-104 per-app share (or “leftover”).
   - Per-app totals table (hint, full id, weight).
   - Collapsed raw JSON (`JsonViewer`).
5. Note when `events` has no exercise/create keys (privacy): attribution still runs from the verdict.

Support `?updateId=` on the route so a result can be linked.

## Data flow

1. User pastes UpdateId (or lands with `?updateId=`).
2. `fetchTransactionByUpdateId` builds the proxy URL the same way [canton.ts](mdc:src/api/canton.ts) encodes HTTPS origins (`encodeOriginBase64url` of `https://lighthouse.devnet.cantonloop.com`, path `/api/transactions/{id}`).
3. On Vercel, the existing session cookie authorizes `/api/proxy`. Lighthouse sees a headerless GET.
4. Parse `events.verdict`. Reject if `traffic_summary` or `transaction_views.views` is missing.
5. Derive confirmers → apply `resolveFeaturedApps` → `attributeTraffic`.
6. Tick changes re-run step 5 only (no refetch).

Local `yarn dev` uses Vite `/proxy/remote/{encoded}/...` for the same origin so CORS stays consistent with other remote calls.

## Error handling

| Case | UI |
|---|---|
| Empty input | Search disabled |
| Lighthouse 404 | `EmptyState`: transaction not found |
| Proxy 401 | `ErrorDisplay`: sign in to use the proxy (Vercel only) |
| Proxy 502 / network | `ErrorDisplay` with server message |
| 200 but no verdict / traffic_summary | `ErrorDisplay`: response has no traffic summary |
| Zero events besides verdict | Success + muted note, still show views/envelopes |

Do not guess featured apps on error. Leave the last successful result on screen until a new search starts (then clear).

## Testing

The repo has no test runner today. Add Vitest (Vite-native) and `yarn test`. Do not add a browser E2E for v1.

`cip104.test.ts` fixtures (inline JSON, not live network):

- TX_1 Tradeproposal (`1220648c…f4ce`): leftover 21,361; with featured `{kairo-executor, fivenorth-devnet-1}` → AH 19,377, fivenorth 7,945, sum 27,322.
- Sole featured app on one envelope takes ~full `total` (TX_3 Transfer CC pattern).
- No featured ticks → all weights 0, leftover = total, no throw.
- Carry-ticks unit tests on `resolveFeaturedApps`: off → `[]`; on → intersection; remembered party absent from this tx is not checked and is not dropped from storage by the apply step.

## Out of scope (v1)

- Resolving `FeaturedAppRight` from ACS or Scan
- `activityWeight` ≠ 1
- Round issuance / coupon CC
- Configurable Lighthouse host (testnet/mainnet)
- Batch CSV / spreadsheet import
- Localnet without Lighthouse
- Dedicated `/api/lighthouse` function

## Implementation sequence

1. Types + `cip104.ts` + Vitest fixtures
2. `featuredApps.ts` + store atoms
3. `lighthouse.ts` fetch via existing proxy
4. Page + route + sidebar
5. `?updateId=` + carry-ticks persistence check by hand on the 12 CSV UpdateIds
