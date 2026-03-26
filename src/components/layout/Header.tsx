import { NodeSelector } from './NodeSelector'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useQueryClient } from '@tanstack/react-query'

export function Header() {
  const queryClient = useQueryClient()

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-4">
        <NodeSelector />
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => queryClient.invalidateQueries()}
          title="Refresh all data"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
