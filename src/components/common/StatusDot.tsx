import { cn } from '@/lib/utils'

interface StatusDotProps {
  status: 'online' | 'offline' | 'checking'
  className?: string
}

export function StatusDot({ status, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        status === 'online' && "bg-success",
        status === 'offline' && "bg-destructive",
        status === 'checking' && "bg-warning animate-pulse",
        className
      )}
    />
  )
}
