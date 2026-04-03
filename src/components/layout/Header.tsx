import { NodeSelector } from './NodeSelector'
import { RefreshCw, Moon, Sun, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useQueryClient } from '@tanstack/react-query'
import { useTheme } from '@/hooks/useTheme'

interface HeaderProps {
  onMobileMenuToggle?: () => void
}

export function Header({ onMobileMenuToggle }: HeaderProps) {
  const queryClient = useQueryClient()
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        {/* Mobile hamburger */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden shrink-0"
          onClick={onMobileMenuToggle}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <NodeSelector />
      </div>
      <div className="flex items-center gap-1 md:gap-2 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
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
