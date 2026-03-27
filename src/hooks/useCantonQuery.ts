import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { selectedNodeAtom, refreshIntervalAtom } from '@/stores/nodeStore'
import * as api from '@/api/canton'
import type { ActiveContract, ActiveContractsRequest, NodeConfig } from '@/types/canton'

async function getToken(node: NodeConfig) {
  return api.getAuthToken(node)
}

export function useNodeConfig(): NodeConfig {
  return useAtomValue(selectedNodeAtom)
}

// Grant CanReadAsAnyParty on first connect to each node (needed for contract queries)
const grantedNodes = new Set<string>()
export function useEnsureReadPermissions() {
  const node = useNodeConfig()
  return useQuery({
    queryKey: ['ensure-permissions', node.id],
    queryFn: async () => {
      if (grantedNodes.has(node.id)) return true
      const token = await getToken(node)
      await api.grantReadAsAnyParty(node, token)
      grantedNodes.add(node.id)
      return true
    },
    staleTime: Infinity,
  })
}

export function useVersion() {
  const node = useNodeConfig()
  return useQuery({
    queryKey: ['version', node.id],
    queryFn: () => api.getVersion(node),
    staleTime: 60000,
  })
}

export function useConnectedSynchronizers() {
  const node = useNodeConfig()
  const refetchInterval = useAtomValue(refreshIntervalAtom)
  return useQuery({
    queryKey: ['synchronizers', node.id],
    queryFn: async () => {
      const token = await getToken(node)
      return api.getConnectedSynchronizers(node, token)
    },
    refetchInterval,
  })
}

export function useLedgerEnd() {
  const node = useNodeConfig()
  const refetchInterval = useAtomValue(refreshIntervalAtom)
  return useQuery({
    queryKey: ['ledger-end', node.id],
    queryFn: async () => {
      const token = await getToken(node)
      return api.getLedgerEnd(node, token)
    },
    refetchInterval,
  })
}

// All users — auto-paginates through all pages, shared cache across all screens
// Fetched once, auto-refreshed on interval, invalidated by the refresh button
export function useAllUsers() {
  const node = useNodeConfig()
  const refetchInterval = useAtomValue(refreshIntervalAtom)
  return useQuery({
    queryKey: ['all-users', node.id],
    queryFn: async () => {
      const token = await getToken(node)
      return api.listAllUsers(node, token, { batchSize: 500 })
    },
    staleTime: 30000,
    refetchInterval,
  })
}

// Convenience wrapper returning flat array
export function useFlatUsers() {
  const query = useAllUsers()
  const users = query.data?.users ?? []
  return {
    ...query,
    users,
    totalLoaded: users.length,
  }
}

export function useParticipantId() {
  const node = useNodeConfig()
  return useQuery({
    queryKey: ['participant-id', node.id],
    queryFn: async () => {
      const token = await getToken(node)
      return api.getParticipantId(node, token)
    },
    staleTime: 60000,
  })
}

export function usePackages() {
  const node = useNodeConfig()
  const refetchInterval = useAtomValue(refreshIntervalAtom)
  return useQuery({
    queryKey: ['packages', node.id],
    queryFn: async () => {
      const token = await getToken(node)
      return api.listPackages(node, token)
    },
    refetchInterval,
  })
}

export function useDsoPartyId() {
  const node = useNodeConfig()
  return useQuery({
    queryKey: ['dso-party', node.id],
    queryFn: async () => {
      const token = await api.getValidatorAuthToken(node)
      return api.getDsoPartyId(node, token)
    },
    staleTime: 60000,
  })
}

export function useActiveContracts(request: ActiveContractsRequest | null, key?: string) {
  const node = useNodeConfig()
  return useQuery({
    queryKey: ['active-contracts', node.id, key, request],
    queryFn: async () => {
      const token = await getToken(node)
      return api.getActiveContracts(node, token, request!)
    },
    enabled: !!request,
  })
}

// Discover all active contracts for a party, then group by template
// Uses paginated discovery to handle nodes with >200 contracts
export function useDiscoverTemplates(partyId: string | undefined) {
  const node = useNodeConfig()
  return useQuery({
    queryKey: ['discover-templates', node.id, partyId],
    queryFn: async () => {
      const token = await getToken(node)
      const contracts = await api.discoverAllContracts(node, token, partyId!)
      // Group contracts by templateId
      const templateMap: Record<string, { templateId: string; packageName: string; count: number }> = {}
      for (const c of contracts as ActiveContract[]) {
        const evt = c?.contractEntry?.JsActiveContract?.createdEvent
        if (!evt?.templateId) continue
        const tid = evt.templateId
        if (!templateMap[tid]) {
          templateMap[tid] = {
            templateId: tid,
            packageName: evt.packageName ?? '',
            count: 0,
          }
        }
        templateMap[tid].count++
      }
      return Object.values(templateMap).sort((a, b) => b.count - a.count)
    },
    enabled: !!partyId,
    staleTime: 30000,
  })
}

export function usePackageDiscovery(partyId: string | undefined) {
  const node = useNodeConfig()
  return useQuery({
    queryKey: ['package-discovery', node.id, partyId],
    queryFn: async () => {
      const token = await getToken(node)
      return api.discoverPackageInfo(node, token, partyId!)
    },
    enabled: !!partyId,
    staleTime: 60000,
  })
}

export function useNodeHealth() {
  const node = useNodeConfig()
  return useQuery({
    queryKey: ['health', node.id],
    queryFn: () => api.checkNodeHealth(node),
    refetchInterval: 30000,
  })
}
