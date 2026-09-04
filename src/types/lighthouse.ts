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
