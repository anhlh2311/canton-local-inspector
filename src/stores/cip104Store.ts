import { atomWithStorage } from 'jotai/utils'
import type { LighthouseNetwork } from '@/api/lighthouse'

export const lighthouseNetworkAtom = atomWithStorage<LighthouseNetwork>(
  'canton-inspector-cip104-network',
  'devnet',
  undefined,
  { getOnInit: true },
)

export const carryTicksAtom = atomWithStorage<boolean>(
  'canton-inspector-cip104-carry-ticks',
  false,
  undefined,
  { getOnInit: true },
)

export const rememberedFeaturedPartyIdsAtom = atomWithStorage<string[]>(
  'canton-inspector-cip104-featured-parties',
  [],
  undefined,
  { getOnInit: true },
)

export const groupByOrganizationAtom = atomWithStorage<boolean>(
  'canton-inspector-cip104-group-by-org',
  false,
  undefined,
  { getOnInit: true },
)

export const partyOrganizationLabelsAtom = atomWithStorage<Record<string, string>>(
  'canton-inspector-cip104-org-labels',
  {},
  undefined,
  { getOnInit: true },
)
