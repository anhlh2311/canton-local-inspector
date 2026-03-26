import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ErrorDisplayProps {
  error: Error | string
  className?: string
}

export function ErrorDisplay({ error, className }: ErrorDisplayProps) {
  const message = typeof error === 'string' ? error : error.message
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive", className)}>
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
