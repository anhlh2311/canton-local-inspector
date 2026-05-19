import { useEffect } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { selectedNodeAtom, refreshIntervalAtom, nodesAtom } from '@/stores/nodeStore'
import * as api from '@/api/canton'
import type { ActiveContract, ActiveContractsRequest, NodeConfig } from '@/types/canton'

const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'

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
      await api.grantReadAsAnyParty(node, token, node.adminUser)
      grantedNodes.add(node.id)
      return true
    },
    staleTime: Infinity,
  })
}

/** Fetch server-stored nodes on mount and merge into local node list. */
let serverNodesFetched = false
export function useServerNodes() {
  const setNodes = useSetAtom(nodesAtom)
  useEffect(() => {
    if (!isVercel || serverNodesFetched) return
    serverNodesFetched = true
    api.fetchServerNodes().then((serverNodes) => {
      if (!serverNodes.length) return
      setNodes((prev) => {
        const localOnly = prev.filter((n) => !serverNodes.some((sn) => sn.id === n.id))
        return [...localOnly, ...serverNodes]
      })
    }).catch(() => {
      // Server nodes unavailable — keep local state as-is
    })
  }, [setNodes])
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

/** Paginated parties — fetches 200 per page, used by Parties Explorer.
 *  NOT auto-refreshed to avoid hammering the server on large nodes. */
export function usePaginatedParties(pageSize: number = 200) {
  const node = useNodeConfig()
  return useInfiniteQuery({
    queryKey: ['parties-paginated', node.id, pageSize],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const token = await getToken(node)
      return api.listParties(node, token, pageSize, pageParam)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken || undefined,
    staleTime: 120000, // 2 min — don't refetch aggressively
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
    retry: (failureCount, error) => {
      // Don't retry 200-limit errors — they won't succeed on retry
      if ((error as { isLimitError?: boolean }).isLimitError) return false
      return failureCount < 2
    },
  })
}

// Discover templates for a party.
// On Vercel: uses the cached template index (no API calls).
// On local dev: falls back to live discovery via discoverAllContracts.
export function useDiscoverTemplates(partyId: string | undefined) {
  const node = useNodeConfig()
  const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'
  return useQuery({
    queryKey: ['discover-templates', node.id, partyId],
    queryFn: async () => {
      // On Vercel: use the cached template index — zero active-contracts queries
      if (isVercel) {
        const networkKey = node.network || node.id
        let index = await api.fetchTemplateIndex(networkKey)
        // Fallback: infer network from node name
        if ((!index.updatedAt || index.templates.length === 0) && !node.network) {
          const nameLower = node.name.toLowerCase()
          const inferred = ['mainnet', 'testnet', 'devnet'].find((n) => nameLower.includes(n))
          if (inferred) {
            const inferredIndex = await api.fetchTemplateIndex(inferred)
            if (inferredIndex.updatedAt && inferredIndex.templates.length > 0) index = inferredIndex
          }
        }
        if (index.templates.length > 0) {
          return index.templates.map((t) => ({
            templateId: t.templateId,
            packageName: t.packageName,
            count: 0, // No count from index — counts come from live queries when user clicks
          }))
        }
      }

      // Local dev fallback: live discovery
      const token = await getToken(node)
      const contracts = await api.discoverAllContracts(node, token, partyId!)
      const templateMap: Record<string, { templateId: string; packageName: string; count: number }> = {}
      for (const c of contracts as ActiveContract[]) {
        const evt = c?.contractEntry?.JsActiveContract?.createdEvent
        if (!evt?.templateId) continue
        const rawTid = evt.templateId as string
        const pkgName = (evt.packageName as string) ?? ''
        // Convert to #packageName:Module:Entity format
        let tid = rawTid
        if (pkgName) {
          const colonIdx = rawTid.indexOf(':')
          if (colonIdx > 0) tid = `#${pkgName}:${rawTid.slice(colonIdx + 1)}`
        }
        if (!templateMap[tid]) {
          templateMap[tid] = {
            templateId: tid,
            packageName: pkgName,
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

/** Pre-built template index from cron job (Vercel only). */
export function useTemplateIndex() {
  const node = useNodeConfig()
  const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'
  return useQuery({
    queryKey: ['template-index', node.network || node.id],
    queryFn: () => api.fetchTemplateIndex(node.network || node.id),
    staleTime: 60000,
    enabled: isVercel,
  })
}

/** Cron job metadata — last run time, per-node status. */
export function useCronMeta() {
  const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'
  return useQuery({
    queryKey: ['cron-meta'],
    queryFn: () => api.fetchCronMeta(),
    staleTime: 30000,
    enabled: isVercel,
  })
}
