import { describe, expect, it } from 'vitest'
import type { AppWeight } from './cip104'
import { organizationOf, sumWeightsByOrganization } from './organizations'

const KAIRO: AppWeight = { partyId: 'kairo-executor::aaa', hint: 'kairo-executor', weight: 29475 }
const DEVNET: AppWeight = { partyId: 'angelhack_devnet::aaa', hint: 'angelhack_devnet', weight: 2585 }
const CBTC: AppWeight = { partyId: 'cbtc-network::bbb', hint: 'cbtc-network', weight: 7939 }

describe('organizationOf', () => {
  it('uses a trimmed label when set, otherwise the party hint', () => {
    expect(organizationOf(KAIRO.partyId, KAIRO.hint, { [KAIRO.partyId]: '  AH  ' })).toBe('AH')
    expect(organizationOf(KAIRO.partyId, KAIRO.hint, {})).toBe('kairo-executor')
  })
})

describe('sumWeightsByOrganization', () => {
  it('rolls featured weights into named organizations', () => {
    const groups = sumWeightsByOrganization([KAIRO, DEVNET, CBTC], {
      [KAIRO.partyId]: 'AH',
      [DEVNET.partyId]: 'AH',
      [CBTC.partyId]: 'Bitsafe',
    })
    expect(groups).toEqual([
      {
        organization: 'AH',
        weight: 32060,
        members: [KAIRO, DEVNET],
      },
      {
        organization: 'Bitsafe',
        weight: 7939,
        members: [CBTC],
      },
    ])
  })

  it('defaults each party to its own hint when no labels are set', () => {
    const groups = sumWeightsByOrganization([CBTC, KAIRO], {})
    expect(groups.map((g) => g.organization)).toEqual(['kairo-executor', 'cbtc-network'])
  })
})
