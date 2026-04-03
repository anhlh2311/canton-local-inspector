import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

export type UserRole = 'admin' | 'editor' | 'viewer'

export interface AppUser {
  id: string
  email: string
  name: string
  image: string
  role: UserRole
}

export interface DeniedUser {
  email: string
  name: string
  image: string
  denied: true
}

interface AuthContextValue {
  user: AppUser | null
  deniedUser: DeniedUser | null
  loading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  isEditor: boolean
  isViewer: boolean
  signIn: () => void
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'

// Mock admin user for local dev (no Google OAuth needed)
const MOCK_ADMIN: AppUser = {
  id: 'local-dev',
  email: 'dev@localhost',
  name: 'Local Developer',
  image: '',
  role: 'admin',
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(isVercel ? null : MOCK_ADMIN)
  const [deniedUser, setDeniedUser] = useState<DeniedUser | null>(null)
  const [loading, setLoading] = useState(isVercel)

  const fetchSession = useCallback(async () => {
    if (!isVercel) return
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' })
      const data = await res.json()
      if (data.user?.denied) {
        setUser(null)
        setDeniedUser(data.user as DeniedUser)
      } else if (data.user) {
        setUser(data.user as AppUser)
        setDeniedUser(null)
      } else {
        setUser(null)
        setDeniedUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch session on mount
  useEffect(() => {
    fetchSession()
  }, [fetchSession])

  // Poll session every 5 minutes (detect role changes, session expiry)
  useEffect(() => {
    if (!isVercel) return
    const interval = setInterval(fetchSession, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchSession])

  const signIn = useCallback(() => {
    window.location.href = '/api/auth/google-login'
  }, [])

  const signOut = useCallback(async () => {
    if (!isVercel) return
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setUser(null)
    setDeniedUser(null)
    window.location.href = '/login'
  }, [])

  const value: AuthContextValue = {
    user,
    deniedUser,
    loading,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isEditor: user?.role === 'admin' || user?.role === 'editor',
    isViewer: !!user,
    signIn,
    signOut,
    refreshSession: fetchSession,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
