import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { MainLayout } from '@/components/layout/MainLayout'
import { LoginPage } from '@/pages/LoginPage'
import { AccessDeniedPage } from '@/pages/AccessDeniedPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { SynchronizerPage } from '@/pages/SynchronizerPage'
import { PartiesPage } from '@/pages/PartiesPage'
import { PackagesPage } from '@/pages/PackagesPage'
import { ContractsPage } from '@/pages/ContractsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { UsersPage } from '@/pages/admin/UsersPage'

export function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/access-denied" element={<AccessDeniedPage />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/synchronizer" element={<SynchronizerPage />} />
          <Route path="/parties" element={<PartiesPage />} />
          <Route path="/packages" element={<PackagesPage />} />
          <Route path="/contracts" element={<ContractsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Admin routes */}
        <Route element={<ProtectedRoute requiredRole="admin"><MainLayout /></ProtectedRoute>}>
          <Route path="/admin/users" element={<UsersPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
