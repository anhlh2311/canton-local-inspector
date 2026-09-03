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
