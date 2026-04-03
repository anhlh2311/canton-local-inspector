import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Globe,
  Users,
  Package,
  FileCode,
  Settings,
  Shield,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/synchronizer', icon: Globe, label: 'Synchronizer & DSO' },
  { to: '/parties', icon: Users, label: 'Parties' },
  { to: '/packages', icon: Package, label: 'Packages' },
  { to: '/contracts', icon: FileCode, label: 'Contracts' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-500/20 text-red-400',
  editor: 'bg-blue-500/20 text-blue-400',
  viewer: 'bg-gray-500/20 text-gray-400',
}

export function Sidebar() {
  const { user, isAdmin, signOut } = useAuth()

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

          {/* Admin-only link */}
          {isAdmin && (
            <>
              <div className="px-3 pt-3 pb-1">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Admin</p>
              </div>
              <NavLink
                to="/admin/users"
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )
                }
              >
                <Shield className="h-4 w-4" />
                Users
              </NavLink>
            </>
          )}
        </nav>
      </ScrollArea>

      {/* User info at bottom */}
      {user && (
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2">
            {user.image ? (
              <img src={user.image} alt="" className="h-7 w-7 rounded-full shrink-0" referrerPolicy="no-referrer" />
            ) : (
              <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-[10px] font-bold">
                {user.name?.[0] || user.email[0]}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{user.name}</p>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className={cn('text-[8px] px-1 py-0 capitalize', ROLE_COLORS[user.role])}>
                  {user.role}
                </Badge>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={signOut} title="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </aside>
  )
}
