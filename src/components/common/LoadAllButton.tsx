import { useState, useRef, useCallback } from 'react'
import { Download, X, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useQueryClient } from '@tanstack/react-query'
import { streamActiveContractsWs, getAuthToken, buildTemplateFilter, buildAnyPartyTemplateFilter, buildInterfaceFilter } from '@/api/canton'
import { useNodeConfig } from '@/hooks/useCantonQuery'
import type { ActiveContract, ActiveContractsRequest } from '@/types/canton'

// Per-template cooldown tracking (client-side only)
const cooldownMap = new Map<string, number>()
const COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes
const LARGE_STREAM_WARN = 5000 // Show warning for templates with >5000 expected contracts
const MAX_CACHED_CONTRACTS = 50000 // Evict oldest cache if total exceeds this

/** Cache key for WebSocket-streamed contracts in React Query */
export function wsContractsCacheKey(nodeId: string, templateId: string) {
  return ['ws-contracts', nodeId, templateId]
}

interface LoadAllButtonProps {
  /** Full template ID or interface ID (packageHash:Module:Entity) */
  templateId: string
  /** Ledger offset to query at */
  activeAtOffset?: string
  /** Called with the full contract list when streaming completes */
  onLoaded: (contracts: ActiveContract[]) => void
  /** Optional: compact display mode */
  compact?: boolean
  /** Party ID — if provided, filters by party. If omitted, uses filtersForAnyParty. */
  partyId?: string
  /** Approximate expected count (from discovery) — used for large stream warning */
  expectedCount?: number
  /** Filter type: 'template' (default) or 'interface' */
  filterType?: 'template' | 'interface'
}

export function LoadAllButton({ templateId, activeAtOffset, onLoaded, compact, partyId, expectedCount, filterType = 'template' }: LoadAllButtonProps) {
  const node = useNodeConfig()
  const queryClient = useQueryClient()
  const [streaming, setStreaming] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [confirmLarge, setConfirmLarge] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  const cooldownKey = `${node.id}:${templateId}`
  const lastRun = cooldownMap.get(cooldownKey) ?? 0
  const cooldownRemaining = Math.max(0, COOLDOWN_MS - (Date.now() - lastRun))
  const [, forceUpdate] = useState(0)

  const cooldownMin = Math.ceil(cooldownRemaining / 60000)
  const isOnCooldown = cooldownRemaining > 0 && !streaming
  const isLargeStream = (expectedCount ?? 0) > LARGE_STREAM_WARN

  // Check React Query cache first
  const cacheKey = wsContractsCacheKey(node.id, templateId)
  const cached = queryClient.getQueryData<ActiveContract[]>(cacheKey)

  const handleLoad = useCallback(async () => {
    // Large stream confirmation
    if (isLargeStream && !confirmLarge) {
      setConfirmLarge(true)
      return
    }
    setConfirmLarge(false)
    setStreaming(true)
    setProgress(0)
    setError(null)

    try {
      const token = await getAuthToken(node)
      let filter: ActiveContractsRequest
      if (filterType === 'interface' && partyId) {
        filter = { ...buildInterfaceFilter(partyId, templateId), ...(activeAtOffset ? { activeAtOffset } : {}) }
      } else if (partyId) {
        filter = buildTemplateFilter(partyId, templateId, activeAtOffset)
      } else {
        filter = buildAnyPartyTemplateFilter(templateId, activeAtOffset)
      }

      const { promise, cancel } = streamActiveContractsWs(node, token, filter, (count) => {
        setProgress(count)
      })
      cancelRef.current = cancel

      const contracts = await promise
      cooldownMap.set(cooldownKey, Date.now())

      // Evict oldest cache entries if total would exceed limit
      evictIfNeeded(queryClient, node.id, contracts.length)

      // Cache in React Query (5 min stale, 10 min GC)
      queryClient.setQueryData(cacheKey, contracts, {
        updatedAt: Date.now(),
      })

      onLoaded(contracts)
      setTimeout(() => forceUpdate((n) => n + 1), COOLDOWN_MS + 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stream failed')
    } finally {
      setStreaming(false)
      cancelRef.current = null
    }
  }, [node, partyId, templateId, activeAtOffset, onLoaded, cooldownKey, isLargeStream, confirmLarge, cacheKey, queryClient])

  // If cached, load from cache immediately
  const handleLoadFromCache = useCallback(() => {
    if (cached) onLoaded(cached)
  }, [cached, onLoaded])

  const handleCancel = useCallback(() => {
    cancelRef.current?.()
    setConfirmLarge(false)
  }, [])

  if (streaming) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          {progress > 0 ? `${progress.toLocaleString()} loaded...` : 'Connecting...'}
        </Badge>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCancel} title="Cancel">
          <X className="h-3 w-3" />
        </Button>
      </div>
    )
  }

  // Large stream confirmation dialog
  if (confirmLarge) {
    const estMB = Math.round((expectedCount ?? 0) / 1000)
    return (
      <div className="flex items-center gap-1">
        <Badge variant="warning" className="text-[10px] gap-1">
          <AlertTriangle className="h-3 w-3" />
          ~{(expectedCount ?? 0).toLocaleString()} contracts (~{estMB}MB)
        </Badge>
        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={handleLoad}>
          Stream
        </Button>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setConfirmLarge(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="destructive" className="text-[10px] max-w-[300px] truncate" title={error}>
          {error}
        </Badge>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={handleLoad} disabled={isOnCooldown}>
          Retry
        </Button>
      </div>
    )
  }

  // If cached, show "Cached" badge with option to reload
  if (cached) {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className={compact ? 'h-6 text-[10px] px-2 gap-1' : 'h-7 text-xs gap-1'}
          onClick={handleLoadFromCache}
          title="Show cached results"
        >
          {cached.length.toLocaleString()} cached
        </Button>
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className={compact ? 'h-6 text-[10px] px-2 gap-1' : 'h-7 text-xs gap-1'}
      onClick={handleLoad}
      disabled={isOnCooldown}
      title={isOnCooldown ? `Cooldown: ${cooldownMin}m remaining` : 'Stream all contracts via WebSocket (no 200 limit)'}
    >
      <Download className="h-3 w-3" />
      {isOnCooldown ? `${cooldownMin}m` : 'Load All'}
    </Button>
  )
}

/** Evict oldest WS cache entries if adding `newCount` contracts would exceed the limit. */
function evictIfNeeded(queryClient: ReturnType<typeof useQueryClient>, nodeId: string, newCount: number) {
  const cache = queryClient.getQueryCache()
  const wsQueries = cache.findAll({ queryKey: ['ws-contracts', nodeId] })

  let totalContracts = newCount
  const entries: { key: string[]; count: number; updatedAt: number }[] = []

  for (const q of wsQueries) {
    const data = q.state.data as ActiveContract[] | undefined
    if (data) {
      totalContracts += data.length
      entries.push({ key: q.queryKey as string[], count: data.length, updatedAt: q.state.dataUpdatedAt })
    }
  }

  if (totalContracts <= MAX_CACHED_CONTRACTS) return

  // Sort by updatedAt ascending (oldest first), evict until under limit
  entries.sort((a, b) => a.updatedAt - b.updatedAt)
  for (const entry of entries) {
    if (totalContracts <= MAX_CACHED_CONTRACTS) break
    queryClient.removeQueries({ queryKey: entry.key })
    totalContracts -= entry.count
  }
}
