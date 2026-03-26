import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Globe,
  Users,
  Package,
  FileCode,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/synchronizer', icon: Globe, label: 'Synchronizer & DSO' },
  { to: '/parties', icon: Users, label: 'Parties' },
  { to: '/packages', icon: Package, label: 'Packages' },
  { to: '/contracts', icon: FileCode, label: 'Contracts' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function Sidebar() {
  return (
    <aside className="w-60 border-r border-border bg-card flex flex-col shrink-0">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Globe className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">Canton Inspector</h1>
            <p className="text-[10px] text-muted-foreground">Local Network Dashboard</p>
          </div>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <nav className="p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </ScrollArea>
    </aside>
  )
}
