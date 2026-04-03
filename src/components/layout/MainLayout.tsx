import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useEnsureReadPermissions } from '@/hooks/useCantonQuery'

export function MainLayout() {
  useEnsureReadPermissions()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-[280px]">
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onMobileMenuToggle={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
