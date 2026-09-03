import { atomWithStorage } from 'jotai/utils'
import type { LighthouseNetwork } from '@/api/lighthouse'

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
