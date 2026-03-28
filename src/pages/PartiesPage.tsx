import { useState, useCallback } from 'react'
import { Users, UserCheck, ShieldCheck, Eye, Pencil, ChevronDown, Globe, User, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchInput } from '@/components/common/SearchInput'
import { ClearableInput } from '@/components/common/ClearableInput'
import { IdDisplay } from '@/components/common/IdDisplay'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { EmptyState } from '@/components/common/EmptyState'
import { useAllUsers, usePaginatedParties, useParticipantId, useNodeConfig } from '@/hooks/useCantonQuery'
import { getParty, getAuthToken } from '@/api/canton'
import type { MergedPartyEntry, UserRight, PartyDetails } from '@/types/canton'

function UserRightsBadge({ rights }: { rights: UserRight[] }) {
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

function PartyCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: MergedPartyEntry
  expanded: boolean
  onToggle: () => void
}) {
  const hasUser = !!entry.userId
  return (
    <Card>
      <CardContent className="p-0">
        <button
          className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
          onClick={onToggle}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${hasUser ? 'bg-secondary' : 'bg-primary/10'}`}>
                {hasUser ? <User className="h-4 w-4 text-muted-foreground" /> : <Globe className="h-4 w-4 text-primary" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {entry.userId ?? entry.displayName ?? entry.partyHint}
                </p>
                <p className="text-xs text-muted-foreground font-mono truncate">{entry.partyId}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {hasUser && <Badge variant="secondary" className="text-[10px]">User</Badge>}
              {entry.isLocal
                ? <Badge className="text-[10px] bg-emerald-500/20 text-emerald-300 border-emerald-500/30">Local</Badge>
                : <Badge variant="outline" className="text-[10px]">Remote</Badge>
              }
              {entry.isDeactivated && <Badge variant="destructive" className="text-[10px]">Deactivated</Badge>}
              {entry.userRights && <UserRightsBadge rights={entry.userRights} />}
            </div>
          </div>
        </button>

        {expanded && (
          <>
            <Separator />
            <div className="p-4 space-y-3 bg-muted/10">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Party ID</p>
                <IdDisplay id={entry.partyId} truncate={0} />
              </div>
              {entry.partyHint && entry.partyHint !== entry.partyId && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Party Hint</p>
                  <code className="text-xs font-mono bg-muted px-2 py-1 rounded">{entry.partyHint}</code>
                </div>
              )}
              {entry.displayName && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Display Name</p>
                  <code className="text-xs font-mono bg-muted px-2 py-1 rounded">{entry.displayName}</code>
                </div>
              )}
              {entry.userId && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">User ID</p>
                  <IdDisplay id={entry.userId} truncate={0} />
                </div>
              )}
              {entry.accessRights && entry.accessRights.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Access Rights</p>
                  <div className="flex flex-wrap gap-1">
                    {entry.accessRights.map((r, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{r}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {entry.annotations && Object.keys(entry.annotations).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Annotations</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(entry.annotations).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="text-[10px]">{k}: {String(v)}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {entry.userRights && entry.userRights.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Rights ({entry.userRights.length})</p>
                  <div className="space-y-1">
                    {entry.userRights.map((r, i) => {
                      const kind = Object.keys(r.kind)[0] ?? 'Unknown'
                      const party = Object.values(r.kind)[0]?.value?.party
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs font-mono bg-muted/50 px-2 py-1 rounded">
                          <span className="text-primary">{kind}</span>
                          {party && <span className="text-muted-foreground truncate">{party}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Local</p>
                <Badge variant={entry.isLocal ? 'success' : 'outline'} className="text-[10px]">
                  {entry.isLocal ? 'Yes' : 'No'}
                </Badge>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Tab 1: Users & their parties (from /v2/users — fast, local only) */
function UsersTab() {
  const users = useAllUsers()
  const [search, setSearch] = useState('')
  const [expandedParty, setExpandedParty] = useState<string | null>(null)
  const [displayCount, setDisplayCount] = useState(20)

  const allEntries: MergedPartyEntry[] = (users.data?.users ?? []).map((entry: Record<string, unknown>) => {
    const u = (entry?.user ?? entry) as Record<string, unknown>
    const party = ((u?.primaryParty ?? '') as string)
    const hint = party.includes('::') ? party.split('::')[0] : party
    return {
      partyId: party,
      partyHint: hint,
      isLocal: true,
      userId: (u?.id as string) ?? undefined,
      userRights: ((entry?.rights ?? []) as UserRight[]),
      isDeactivated: (u?.isDeactivated as boolean) ?? false,
      annotations: ((u?.metadata as Record<string, unknown>)?.annotations as Record<string, string>) ?? undefined,
    }
  })

  const filtered = allEntries.filter((p) => {
    if (!search) return true
    const s = search.toLowerCase()
    return p.partyId.toLowerCase().includes(s) || p.partyHint.toLowerCase().includes(s) || (p.userId?.toLowerCase().includes(s) ?? false)
  })

  const visible = search ? filtered : filtered.slice(0, displayCount)
  const hasMore = !search && displayCount < filtered.length

  return (
    <div className="space-y-4">
      <SearchInput value={search} onChange={setSearch} placeholder="Search users..." className="max-w-md" />
      {users.isLoading && <LoadingSpinner text="Loading users..." className="py-8" />}
      {users.error && <ErrorDisplay error={users.error as Error} />}
      <div className="space-y-2">
        {visible.map((entry) => (
          <PartyCard key={entry.partyId || entry.userId} entry={entry} expanded={expandedParty === entry.partyId} onToggle={() => setExpandedParty(expandedParty === entry.partyId ? null : entry.partyId)} />
        ))}
        {filtered.length === 0 && !users.isLoading && (
          <EmptyState icon={Users} title="No users found" description={search ? 'Try a different search' : 'No users on this node'} />
        )}
      </div>
      <div className="flex items-center justify-center gap-3">
        {hasMore && (
          <Button variant="outline" onClick={() => setDisplayCount((c) => c + 20)}>
            <ChevronDown className="h-4 w-4 mr-2" /> Show more
          </Button>
        )}
        {filtered.length > 0 && <span className="text-xs text-muted-foreground">Showing {visible.length} of {filtered.length}</span>}
      </div>
    </div>
  )
}

/** Tab 2: All network parties (from /v2/parties — paginated, opt-in) */
function NetworkPartiesTab() {
  const partiesQuery = usePaginatedParties()
  const [search, setSearch] = useState('')
  const [expandedParty, setExpandedParty] = useState<string | null>(null)

  const allLoaded = (partiesQuery.data?.pages ?? []).flatMap((p) => p.partyDetails ?? [])

  // Deduplicate
  const seen = new Set<string>()
  const entries: MergedPartyEntry[] = []
  for (const pd of allLoaded) {
    if (seen.has(pd.party)) continue
    seen.add(pd.party)
    const hint = pd.party.includes('::') ? pd.party.split('::')[0] : pd.party
    entries.push({
      partyId: pd.party,
      partyHint: hint,
      displayName: pd.displayName,
      isLocal: pd.isLocal,
      accessRights: pd.localMetadata?.accessRights,
    })
  }

  const filtered = entries.filter((p) => {
    if (!search) return true
    const s = search.toLowerCase()
    return p.partyId.toLowerCase().includes(s) || p.partyHint.toLowerCase().includes(s) || (p.displayName?.toLowerCase().includes(s) ?? false)
  })

  const localCount = entries.filter((p) => p.isLocal).length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Search parties..." className="max-w-md" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{entries.length} loaded{partiesQuery.hasNextPage ? '+' : ''}</Badge>
          <Badge className="text-[10px] bg-emerald-500/20 text-emerald-300 border-emerald-500/30">{localCount} local</Badge>
        </div>
      </div>
      {partiesQuery.isLoading && <LoadingSpinner text="Loading parties from network..." className="py-8" />}
      {partiesQuery.error && <ErrorDisplay error={partiesQuery.error as Error} />}
      <div className="space-y-2">
        {filtered.map((entry) => (
          <PartyCard key={entry.partyId} entry={entry} expanded={expandedParty === entry.partyId} onToggle={() => setExpandedParty(expandedParty === entry.partyId ? null : entry.partyId)} />
        ))}
        {filtered.length === 0 && !partiesQuery.isLoading && (
          <EmptyState icon={Globe} title="No parties found" description={search ? 'Try a different search' : 'Click "Load more" to fetch parties'} />
        )}
      </div>
      <div className="flex items-center justify-center gap-3">
        {partiesQuery.hasNextPage && (
          <Button variant="outline" onClick={() => partiesQuery.fetchNextPage()} disabled={partiesQuery.isFetchingNextPage}>
            {partiesQuery.isFetchingNextPage ? <LoadingSpinner size={16} text="Loading..." /> : <><ChevronDown className="h-4 w-4 mr-2" /> Load more parties</>}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Tab 3: Look up a specific party by ID */
function PartyLookupTab() {
  const node = useNodeConfig()
  const [partyId, setPartyId] = useState('')
  const [result, setResult] = useState<PartyDetails | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLookup = useCallback(async () => {
    if (!partyId.trim()) return
    setLoading(true)
    setResult(null)
    setNotFound(false)
    setError(null)
    try {
      const token = await getAuthToken(node)
      const res = await getParty(node, token, partyId.trim())
      if (res.partyDetails?.length > 0) {
        setResult(res.partyDetails[0])
      } else {
        setNotFound(true)
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { cause?: string } }; message?: string })
      setError(msg.response?.data?.cause ?? msg.message ?? 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }, [node, partyId])

  const entry: MergedPartyEntry | null = result ? {
    partyId: result.party,
    partyHint: result.party.includes('::') ? result.party.split('::')[0] : result.party,
    displayName: result.displayName,
    isLocal: result.isLocal,
    accessRights: result.localMetadata?.accessRights,
  } : null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ClearableInput value={partyId} onChange={setPartyId} onSubmit={handleLookup} placeholder="Enter full party ID (e.g., hint::1220abc...)" className="flex-1 max-w-xl" />
        <Button onClick={handleLookup} disabled={!partyId.trim() || loading}>
          <Search className="h-4 w-4 mr-2" /> Lookup
        </Button>
      </div>
      {loading && <LoadingSpinner text="Looking up party..." />}
      {error && <ErrorDisplay error={error} />}
      {notFound && <EmptyState icon={Users} title="Party not found" description={`No party with ID "${partyId.slice(0, 30)}..." found on this node`} />}
      {entry && <PartyCard entry={entry} expanded onToggle={() => {}} />}
    </div>
  )
}

export function PartiesPage() {
  const node = useNodeConfig()
  const participantId = useParticipantId()
  const users = useAllUsers()
  const userCount = users.data?.users?.length ?? 0

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
            <Badge variant="secondary">{userCount} user(s)</Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="users" key={node.id}>
        <TabsList>
          <TabsTrigger value="users" className="gap-1.5">
            <User className="h-3.5 w-3.5" /> Users ({userCount})
          </TabsTrigger>
          <TabsTrigger value="network" className="gap-1.5">
            <Globe className="h-3.5 w-3.5" /> Network Parties
          </TabsTrigger>
          <TabsTrigger value="lookup" className="gap-1.5">
            <Search className="h-3.5 w-3.5" /> Party Lookup
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="network">
          <NetworkPartiesTab />
        </TabsContent>
        <TabsContent value="lookup">
          <PartyLookupTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
