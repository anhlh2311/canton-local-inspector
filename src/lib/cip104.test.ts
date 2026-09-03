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
