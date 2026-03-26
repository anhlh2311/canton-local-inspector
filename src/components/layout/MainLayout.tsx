import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useEnsureReadPermissions } from '@/hooks/useCantonQuery'

export function MainLayout() {
  // Automatically grant CanReadAsAnyParty on the selected node
  useEnsureReadPermissions()

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
