import { Navigate } from 'react-router-dom'
import { useAuth, type UserRole } from '@/context/AuthContext'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

const ROLE_LEVEL: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
}

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: UserRole
}

export function ProtectedRoute({ children, requiredRole = 'viewer' }: ProtectedRouteProps) {
  const { user, deniedUser, loading, isAuthenticated } = useAuth()

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <LoadingSpinner text="Checking authentication..." />
      </div>
    )
  }

  // Not authenticated at all
  if (!isAuthenticated && !deniedUser) {
    return <Navigate to="/login" replace />
  }

  // Authenticated but denied (not invited)
  if (deniedUser) {
    return <Navigate to="/access-denied" replace />
  }

  // Authenticated but insufficient role
  if (user && ROLE_LEVEL[user.role] < ROLE_LEVEL[requiredRole]) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
        <div className="text-4xl">403</div>
        <h2 className="text-xl font-semibold">Insufficient Permissions</h2>
        <p className="text-muted-foreground text-sm">
          This page requires <span className="font-medium capitalize">{requiredRole}</span> access.
          Your role is <span className="font-medium capitalize">{user.role}</span>.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
