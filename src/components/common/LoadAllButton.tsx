import { useState, useRef, useCallback } from 'react'
import { Download, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { streamActiveContractsWs, getAuthToken, buildTemplateFilter } from '@/api/canton'
import { useNodeConfig } from '@/hooks/useCantonQuery'
import type { ActiveContract } from '@/types/canton'

// Per-template cooldown tracking (client-side only)
const cooldownMap = new Map<string, number>()
const COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

interface LoadAllButtonProps {
  /** Party ID for the query filter */
  partyId: string
  /** Full template ID (packageHash:Module:Entity) */
  templateId: string
  /** Ledger offset to query at */
  activeAtOffset?: string
  /** Called with the full contract list when streaming completes */
  onLoaded: (contracts: ActiveContract[]) => void
  /** Optional: compact display mode */
  compact?: boolean
}

export function LoadAllButton({ partyId, templateId, activeAtOffset, onLoaded, compact }: LoadAllButtonProps) {
  const node = useNodeConfig()
  const [streaming, setStreaming] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const cooldownKey = `${node.id}:${templateId}`
  const lastRun = cooldownMap.get(cooldownKey) ?? 0
  const cooldownRemaining = Math.max(0, COOLDOWN_MS - (Date.now() - lastRun))
  const [, forceUpdate] = useState(0) // to re-render when cooldown expires

  // Refresh cooldown display
  const cooldownMin = Math.ceil(cooldownRemaining / 60000)
  const isOnCooldown = cooldownRemaining > 0 && !streaming

  const handleLoad = useCallback(async () => {
    setStreaming(true)
    setProgress(0)
    setError(null)

    try {
      const token = await getAuthToken(node)
      const filter = buildTemplateFilter(partyId, templateId, activeAtOffset)
      const { promise, cancel } = streamActiveContractsWs(node, token, filter, (count) => {
        setProgress(count)
      })
      cancelRef.current = cancel

      const contracts = await promise
      cooldownMap.set(cooldownKey, Date.now())
      onLoaded(contracts)

      // Schedule re-render when cooldown expires
      setTimeout(() => forceUpdate((n) => n + 1), COOLDOWN_MS + 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stream failed')
    } finally {
      setStreaming(false)
      cancelRef.current = null
    }
  }, [node, partyId, templateId, activeAtOffset, onLoaded, cooldownKey])

  const handleCancel = useCallback(() => {
    cancelRef.current?.()
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

  if (error) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="destructive" className="text-[10px] max-w-[300px] truncate" title={error}>
          {error}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2"
          onClick={handleLoad}
          disabled={isOnCooldown}
        >
          Retry
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
