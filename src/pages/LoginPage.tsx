import { Navigate, useSearchParams } from 'react-router-dom'
import { Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'

export function LoginPage() {
  const { isAuthenticated, signIn, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const error = searchParams.get('error')

  if (isAuthenticated) return <Navigate to="/" replace />

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
            <Globe className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Canton Inspector</CardTitle>
          <CardDescription>
            Sign in to access the Canton Network dashboard.
            <br />
            Access is by invitation only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
              {error === 'token_exchange_failed' && 'Authentication failed. Please try again.'}
              {error === 'userinfo_failed' && 'Could not retrieve your Google account info.'}
              {error === 'callback_failed' && 'An error occurred during sign-in.'}
              {!['token_exchange_failed', 'userinfo_failed', 'callback_failed'].includes(error) && `Error: ${error}`}
            </div>
          )}
          <Button
            className="w-full"
            size="lg"
            onClick={signIn}
            disabled={loading}
          >
            <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
