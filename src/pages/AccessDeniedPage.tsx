import { ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'

export function AccessDeniedPage() {
  const { deniedUser, signOut } = useAuth()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-destructive/20 flex items-center justify-center">
            <ShieldX className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-xl">Access Denied</CardTitle>
          <CardDescription>
            {deniedUser ? (
              <>
                Your account <span className="font-medium">{deniedUser.email}</span> has not been
                granted access to Canton Inspector.
              </>
            ) : (
              'You do not have permission to access this application.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground text-center">
            Contact an administrator to request an invitation.
          </p>
          <Button variant="outline" className="w-full" onClick={signOut}>
            Sign out and try a different account
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
