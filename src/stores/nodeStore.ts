import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { NodeConfig, NodeHealth } from '@/types/canton'
import { DEFAULT_NODES } from '@/constants/nodes'

export const nodesAtom = atomWithStorage<NodeConfig[]>('canton-inspector-nodes', DEFAULT_NODES)

export const selectedNodeIdAtom = atomWithStorage<string>('canton-inspector-selected-node', DEFAULT_NODES[0].id)

export const selectedNodeAtom = atom((get) => {
  const nodes = get(nodesAtom)
  const selectedId = get(selectedNodeIdAtom)
  return nodes.find(n => n.id === selectedId) ?? nodes[0]
})

export const nodeHealthMapAtom = atom<Record<string, NodeHealth>>({})

export const authTokensAtom = atomWithStorage<Record<string, string>>('canton-inspector-tokens', {})

export const refreshIntervalAtom = atomWithStorage<number>('canton-inspector-refresh', 15000)

export type Theme = 'dark' | 'light'
export const themeAtom = atomWithStorage<Theme>('canton-inspector-theme', 'dark')

/** When true, expanding a package on the Packages page auto-queries active contracts for counts. */
export const autoQueryContractsAtom = atomWithStorage<boolean>('canton-inspector-auto-query-contracts', false)
