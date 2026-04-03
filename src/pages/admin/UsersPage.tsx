import { useState, useEffect } from 'react'
import { Shield, UserPlus, Trash2, Mail, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth, type UserRole } from '@/context/AuthContext'

interface UserRecord {
  id: string
  email: string
  name: string
  image: string
  role: UserRole
  createdAt: string
  lastLoginAt: string
}

interface InviteRecord {
  email: string
  role: 'editor' | 'viewer'
  invitedBy: string
  createdAt: string
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-500/20 text-red-400 border-red-500/30',
  editor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  viewer: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

export function UsersPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [invites, setInvites] = useState<InviteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('viewer')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const fetchData = async () => {
    try {
      const [usersRes, invitesRes] = await Promise.all([
        fetch('/api/admin/users', { credentials: 'include' }),
        fetch('/api/admin/invites', { credentials: 'include' }),
      ])
      if (usersRes.ok) {
        const data = await usersRes.json()
        setUsers(data.users)
      }
      if (invitesRes.ok) {
        const data = await invitesRes.json()
        setInvites(data.invites)
      }
    } catch {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to invite')
        return
      }
      const emailNote = data.emailSent ? ' — invitation email sent' : ' — no email sent (configure RESEND_API_KEY)'
      setSuccess(`Invited ${inviteEmail.trim()} as ${inviteRole}${emailNote}`)
      setInviteEmail('')
      fetchData()
    } catch {
      setError('Failed to send invite')
    } finally {
      setInviting(false)
    }
  }

  const handleChangeRole = async (userId: string, newRole: UserRole) => {
    setError(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId, role: newRole }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to change role')
        return
      }
      fetchData()
    } catch {
      setError('Failed to change role')
    }
  }

  const handleRevokeUser = async (userId: string) => {
    if (!confirm('Remove this user? They will need a new invite to regain access.')) return
    setError(null)
    try {
      await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId }),
      })
      fetchData()
    } catch {
      setError('Failed to revoke user')
    }
  }

  const handleRevokeInvite = async (email: string) => {
    setError(null)
    try {
      await fetch('/api/admin/invites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      })
      fetchData()
    } catch {
      setError('Failed to revoke invite')
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">User Management</h2>
        <p className="text-muted-foreground text-sm mt-1">Invite users and manage access roles</p>
      </div>

      {/* Invite New User */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Invite User
          </CardTitle>
          <CardDescription>Send an invitation by email. The user signs in with Google to activate.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="user@example.com"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              className="flex-1"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'editor' | 'viewer')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
              {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4 mr-1" />}
              Invite
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && <p className="text-xs text-success">{success}</p>}
        </CardContent>
      </Card>

      {/* Current Users */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Active Users ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30">
                  <div className="flex items-center gap-3 min-w-0">
                    {u.image ? (
                      <img src={u.image} alt="" className="h-8 w-8 rounded-full shrink-0" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-xs font-bold">
                        {u.name?.[0] || u.email[0]}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{u.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={u.role}
                      onChange={(e) => handleChangeRole(u.id, e.target.value as UserRole)}
                      disabled={u.id === currentUser?.id}
                      className="h-7 rounded-md border border-input bg-background px-2 text-[10px]"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Badge variant="outline" className={`text-[10px] capitalize ${ROLE_COLORS[u.role] || ''}`}>
                      {u.role}
                    </Badge>
                    {u.id !== currentUser?.id && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRevokeUser(u.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {users.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No users yet</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Pending Invites ({invites.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div key={inv.email} className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30">
                  <div className="min-w-0">
                    <p className="text-sm font-mono truncate">{inv.email}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Invited as {inv.role} by {inv.invitedBy} on {new Date(inv.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`text-[10px] capitalize ${ROLE_COLORS[inv.role] || ''}`}>
                      {inv.role}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRevokeInvite(inv.email)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
