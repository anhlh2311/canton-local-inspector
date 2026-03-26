import { Routes, Route } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { OverviewPage } from '@/pages/OverviewPage'
import { SynchronizerPage } from '@/pages/SynchronizerPage'
import { PartiesPage } from '@/pages/PartiesPage'
import { PackagesPage } from '@/pages/PackagesPage'
import { ContractsPage } from '@/pages/ContractsPage'
import { SettingsPage } from '@/pages/SettingsPage'

export function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/synchronizer" element={<SynchronizerPage />} />
        <Route path="/parties" element={<PartiesPage />} />
        <Route path="/packages" element={<PackagesPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
