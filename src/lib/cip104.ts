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
