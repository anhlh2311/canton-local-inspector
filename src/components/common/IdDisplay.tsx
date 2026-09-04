import { cn, truncateId } from '@/lib/utils'
import { CopyButton } from './CopyButton'

interface IdDisplayProps {
  id: string
  truncate?: number
  className?: string
  label?: string
  mono?: boolean
}

export function IdDisplay({ id, truncate = 12, className, label, mono = true }: IdDisplayProps) {
  return (
    <div className={cn("flex gap-1 min-w-0 text-sm", truncate ? "items-center" : "items-start", className)}>
      {label && <span className="text-muted-foreground text-xs shrink-0">{label}: </span>}
      <span className={cn(truncate ? "truncate" : "break-all", mono && "font-mono")} title={id}>
        {truncate ? truncateId(id, truncate) : id}
      </span>
      <CopyButton text={id} className="shrink-0 h-6 w-6" />
    </div>
  )
}
