import { useState } from 'react'
import { Users, UserCheck, ShieldCheck, Eye, Pencil, ChevronDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SearchInput } from '@/components/common/SearchInput'
import { IdDisplay } from '@/components/common/IdDisplay'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { EmptyState } from '@/components/common/EmptyState'
import { useAllUsers, useParticipantId, useNodeConfig } from '@/hooks/useCantonQuery'

function UserRightsBadge({ rights }: { rights: { kind: Record<string, { value: { party?: string } }> }[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {rights.map((right, i) => {
        const kind = Object.keys(right.kind)[0]
        if (kind === 'ParticipantAdmin') {
          return <Badge key={i} variant="default" className="text-[10px]"><ShieldCheck className="h-3 w-3 mr-1" />Admin</Badge>
        }
        if (kind === 'CanActAs') {
          return <Badge key={i} variant="success" className="text-[10px]"><Pencil className="h-3 w-3 mr-1" />ActAs</Badge>
        }
        if (kind === 'CanReadAs') {
          return <Badge key={i} variant="secondary" className="text-[10px]"><Eye className="h-3 w-3 mr-1" />ReadAs</Badge>
        }
        if (kind === 'CanReadAsAnyParty') {
          return <Badge key={i} variant="warning" className="text-[10px]"><Eye className="h-3 w-3 mr-1" />ReadAny</Badge>
        }
        return <Badge key={i} variant="outline" className="text-[10px]">{kind}</Badge>
      })}
    </div>
  )
}

export function PartiesPage() {
  const node = useNodeConfig()
  const users = useAllUsers()
  const participantId = useParticipantId()
  const [search, setSearch] = useState('')
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [displayCount, setDisplayCount] = useState(20)

  const allUsers = users.data?.users ?? []

  const filteredUsers = allUsers.filter(
    (u: Record<string, unknown>) => {
      const user = u?.user as Record<string, unknown> | undefined
      const id = ((user?.id ?? u?.id) as string) ?? ''
      const party = ((user?.primaryParty ?? u?.primaryParty) as string) ?? ''
      return id.toLowerCase().includes(search.toLowerCase()) ||
        party.toLowerCase().includes(search.toLowerCase())
    }
  )

  // When searching, show all matches; when browsing, paginate
  const visibleUsers = search ? filteredUsers : filteredUsers.slice(0, displayCount)
  const hasMore = !search && displayCount < filteredUsers.length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Parties Explorer</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Users and parties on <span style={{ color: node.color }} className="font-medium">{node.name}</span>
        </p>
      </div>

      {/* Participant Info */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <UserCheck className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Participant ID</p>
                {participantId.isLoading ? (
                  <LoadingSpinner size={16} />
                ) : participantId.data?.participantId ? (
                  <IdDisplay id={participantId.data.participantId} truncate={20} />
                ) : (
                  <span className="text-sm text-muted-foreground">Not available</span>
                )}
              </div>
            </div>
            <Badge variant="secondary">{filteredUsers.length} user(s)</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search users or parties..."
        className="max-w-md"
      />

      {/* Users List */}
      {users.isLoading && <LoadingSpinner text="Loading users..." className="py-12" />}
      {users.error && <ErrorDisplay error={users.error as Error} />}

      <div className="space-y-2">
        {visibleUsers.map((entry: Record<string, unknown>) => {
          const user = (entry?.user ?? entry) as Record<string, unknown>
          const userId = (user?.id ?? 'unknown') as string
          const primaryParty = (user?.primaryParty ?? '') as string
          const isDeactivated = user?.isDeactivated as boolean ?? false
          const identityProviderId = (user?.identityProviderId ?? '') as string
          const annotations = ((user?.metadata as Record<string, unknown>)?.annotations ?? {}) as Record<string, string>
          const rights = (entry?.rights ?? []) as Record<string, unknown>[]

          return (
            <Card key={userId}>
              <CardContent className="p-0">
                <button
                  className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedUser(expandedUser === userId ? null : userId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <Users className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{userId}</p>
                        {primaryParty && (
                          <p className="text-xs text-muted-foreground font-mono truncate">{primaryParty}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isDeactivated && <Badge variant="destructive">Deactivated</Badge>}
                      <UserRightsBadge rights={rights as { kind: Record<string, { value: { party?: string } }> }[]} />
                    </div>
                  </div>
                </button>

                {expandedUser === userId && (
                  <>
                    <Separator />
                    <div className="p-4 space-y-3 bg-muted/10">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">User ID</p>
                        <IdDisplay id={userId} truncate={0} />
                      </div>
                      {primaryParty && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Primary Party</p>
                          <IdDisplay id={primaryParty} truncate={24} />
                        </div>
                      )}
                      {identityProviderId && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Identity Provider</p>
                          <code className="text-xs font-mono bg-muted px-2 py-1 rounded">{identityProviderId}</code>
                        </div>
                      )}
                      {Object.keys(annotations).length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Annotations</p>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(annotations).map(([k, v]) => (
                              <Badge key={k} variant="outline" className="text-[10px]">{k}: {String(v)}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {rights.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Rights ({rights.length})</p>
                          <div className="space-y-1">
                            {rights.map((r: Record<string, unknown>, i: number) => {
                              const kind = Object.keys((r?.kind as Record<string, unknown>) ?? {})[0] ?? 'Unknown'
                              const party = ((Object.values((r?.kind as Record<string, unknown>) ?? {})[0] as Record<string, unknown>)?.value as Record<string, unknown>)?.party as string | undefined
                              return (
                                <div key={i} className="flex items-center gap-2 text-xs font-mono bg-muted/50 px-2 py-1 rounded">
                                  <span className="text-primary">{kind}</span>
                                  {party && <span className="text-muted-foreground truncate">{String(party)}</span>}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )
        })}

        {filteredUsers.length === 0 && !users.isLoading && (
          <EmptyState icon={Users} title="No users found" description={search ? "Try a different search term" : "No users registered on this node"} />
        )}
      </div>

      {/* Show More / count */}
      <div className="flex items-center justify-center gap-3 pt-2">
        {hasMore && (
          <Button variant="outline" onClick={() => setDisplayCount((c) => c + 20)}>
            <ChevronDown className="h-4 w-4 mr-2" />
            Show more
          </Button>
        )}
        {filteredUsers.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Showing {visibleUsers.length} of {filteredUsers.length} user(s)
          </span>
        )}
      </div>
    </div>
  )
}
