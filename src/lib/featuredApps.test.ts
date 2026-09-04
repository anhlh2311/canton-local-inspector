import { describe, expect, it } from 'vitest'
import { featuredAppCandidates, nextRemembered, resolveFeaturedApps } from './featuredApps'

const A = 'ah::1'
const B = 'bitsafe::2'
const C = 'other::3'
const DSO = 'DSO::eee'

describe('featuredAppCandidates', () => {
  it('omits the DSO party', () => {
    expect(featuredAppCandidates([A, DSO, B])).toEqual([A, B])
  })
})

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

  it('never carries the DSO party as a featured app', () => {
    expect(resolveFeaturedApps({
      mode: 'manual',
      confirmers: [A, DSO],
      remembered: [A, DSO],
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

  it('strips the DSO party from remembered featured apps', () => {
    expect(nextRemembered([DSO, C], [A, DSO], [A, DSO])).toEqual([C, A])
  })
})
