import { useState } from 'react'
import { Globe, Shield, Users, FileCode, Layers, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IdDisplay } from '@/components/common/IdDisplay'
import { SearchInput } from '@/components/common/SearchInput'
import { JsonViewer } from '@/components/common/JsonViewer'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { EmptyState } from '@/components/common/EmptyState'
import {
  useConnectedSynchronizers,
  useDsoPartyId,
  useFlatUsers,
  useActiveContracts,
  useNodeConfig,
  useDiscoverTemplates,
} from '@/hooks/useCantonQuery'
import { buildTemplateFilter } from '@/api/canton'

interface MergedTemplate {
  shortName: string
  packageName: string
  totalCount: number
  templateIds: string[] // all full templateIds with this short name
}

function DsoContractsPanel({ partyId }: { partyId: string }) {
  const discovery = useDiscoverTemplates(partyId)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [templateSearch, setTemplateSearch] = useState('')

  // Merge templates with same short name (different package versions)
  // Use the count from the version with the MOST contracts (latest/active version)
  const mergedTemplates: MergedTemplate[] = (() => {
    const raw = discovery.data ?? []
    const byName: Record<string, MergedTemplate> = {}
    for (const t of raw) {
      const shortName = t.templateId.split(':').pop() ?? t.templateId
      const pkgName = t.packageName || t.templateId.split(':')[0]
      if (!byName[shortName]) {
        byName[shortName] = { shortName, packageName: pkgName, totalCount: 0, templateIds: [] }
      }
      // Use max count across versions (not sum) since the query only hits one version at a time
      if (t.count > byName[shortName].totalCount) {
        byName[shortName].totalCount = t.count
        // Put the version with most contracts first (most likely the active version)
        byName[shortName].templateIds.unshift(t.templateId)
      } else {
        byName[shortName].templateIds.push(t.templateId)
      }
    }
    return Object.values(byName).sort((a, b) => b.totalCount - a.totalCount)
  })()

  // When a merged template is selected, query ALL package versions and merge results
  const selected = mergedTemplates.find((t) => t.shortName === selectedName)
  const selectedContracts = useActiveContracts(
    selected ? buildTemplateFilter(partyId, selected.templateIds[0]) : null,
    `dso-${selectedName}`
  )

  const filteredTemplates = mergedTemplates.filter(
    (t) => t.shortName.toLowerCase().includes(templateSearch.toLowerCase()) ||
           t.packageName.toLowerCase().includes(templateSearch.toLowerCase())
  )

  return (
    <div className="space-y-4">
      {discovery.isLoading && <LoadingSpinner text="Discovering templates on ledger..." className="py-8" />}
      {discovery.error && <ErrorDisplay error={discovery.error as Error} />}

      {mergedTemplates.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {mergedTemplates.length} template(s) discovered with active contracts
              </span>
            </div>
            <SearchInput
              value={templateSearch}
              onChange={setTemplateSearch}
              placeholder="Filter templates..."
              className="w-60"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredTemplates.map((t) => {
              const isSelected = selectedName === t.shortName
              return (
                <Card
                  key={t.shortName}
                  className={`cursor-pointer transition-colors hover:border-primary/50 ${isSelected ? 'border-primary' : ''}`}
                  onClick={() => setSelectedName(isSelected ? null : t.shortName)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{t.shortName}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{t.packageName}</p>
                      </div>
                      <Badge variant="secondary" className="shrink-0 ml-2">~{t.totalCount}</Badge>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {mergedTemplates.length === 0 && !discovery.isLoading && !discovery.error && (
        <EmptyState icon={FileCode} title="No active contracts" description="No active contracts found for this party" />
      )}

      {/* Selected template detail view */}
      {selected && (() => {
        if (selectedContracts.isLoading) return <LoadingSpinner text="Loading contracts..." className="py-4" />
        if (selectedContracts.error) return <ErrorDisplay error={selectedContracts.error as Error} />
        const contracts = (selectedContracts.data ?? []) as unknown as Record<string, unknown>[]
        if (!contracts.length) return <EmptyState icon={FileCode} title="No contracts" />

        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono">
                {selected.shortName}
              </CardTitle>
              <CardDescription>
                {contracts.length} active contract(s)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {contracts.map((contract: Record<string, unknown>, i: number) => {
                  const evt = ((contract?.contractEntry as Record<string, unknown>)?.JsActiveContract as Record<string, unknown>)?.createdEvent as Record<string, unknown> | undefined
                  if (!evt) return null
                  return (
                    <div key={i} className="rounded-lg border border-border/50 overflow-hidden">
                      <div className="flex items-center justify-between p-3 bg-muted/30">
                        <IdDisplay id={evt.contractId as string} truncate={16} label="Contract" />
                        <Badge variant="outline" className="text-xs font-mono">
                          {(evt.templateId as string)?.split(':').pop() ?? 'Unknown'}
                        </Badge>
                      </div>
                      <JsonViewer data={evt.createArgument} />
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      })()}
    </div>
  )
}

function PartiesOnValidator({
  parties,
  nodeName,
  partySearch,
  setPartySearch,
  isLoading,
  error,
}: {
  parties: string[]
  nodeName: string
  partySearch: string
  setPartySearch: (v: string) => void
  isLoading: boolean
  error: Error | null
}) {
  const [expanded, setExpanded] = useState(false)
  const filtered = parties.filter((p) => p.toLowerCase().includes(partySearch.toLowerCase()))
  const visible = partySearch || expanded ? filtered : filtered.slice(0, 50)
  const hasMore = !partySearch && filtered.length > 50

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">Parties on this Validator</CardTitle>
            <CardDescription>
              {filtered.length} partie(s) registered on {nodeName}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <SearchInput
            value={partySearch}
            onChange={setPartySearch}
            placeholder="Filter parties..."
            className="max-w-sm"
          />
        </div>
        {isLoading && <LoadingSpinner text="Loading parties..." />}
        {error && <ErrorDisplay error={error} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1">
          {visible.map((party, i) => (
            <div key={i} className="flex items-center py-1.5 px-2 rounded-md hover:bg-muted/50 min-w-0">
              <IdDisplay id={party} truncate={16} />
            </div>
          ))}
        </div>
        {filtered.length === 0 && !isLoading && (
          <EmptyState icon={Users} title="No parties found" description="No users with primary parties on this node" />
        )}
        {hasMore && (
          <div className="flex justify-center pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5 mr-1.5" />
                  Collapse ({filtered.length - 50} hidden)
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5 mr-1.5" />
                  Show all {filtered.length} parties
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SynchronizerPage() {
  const node = useNodeConfig()
  const synchronizers = useConnectedSynchronizers()
  const dsoParty = useDsoPartyId()
  const users = useFlatUsers()
  const [partySearch, setPartySearch] = useState('')

  const allParties = (users.users ?? [])
    .map((u: Record<string, unknown>) => (u?.user as Record<string, unknown>)?.primaryParty ?? u?.primaryParty)
    .filter(Boolean) as string[]

  const syncId = synchronizers.data?.connectedSynchronizers?.[0]?.synchronizerId

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Synchronizer & DSO</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Global synchronizer details, DSO governance, and active contracts
        </p>
      </div>

      {/* Synchronizer Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Global Synchronizer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {synchronizers.isLoading && <LoadingSpinner text="Loading synchronizers..." />}
            {synchronizers.error && <ErrorDisplay error={synchronizers.error as Error} />}
            {syncId && (
              <>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Synchronizer ID</p>
                  <IdDisplay id={syncId} truncate={20} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  <Badge variant="success">Connected</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Node</p>
                  <span className="text-sm" style={{ color: node.color }}>{node.name}</span>
                  <span className="text-xs text-muted-foreground ml-1">:{node.jsonApiPort}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" />
              DSO (Decentralized Synchronizer Operations)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dsoParty.isLoading && <LoadingSpinner text="Loading DSO party..." />}
            {dsoParty.error && <ErrorDisplay error="Scan proxy not available. Make sure the validator is running." />}
            {dsoParty.data?.dso_party_id && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">DSO Party ID</p>
                <IdDisplay id={dsoParty.data.dso_party_id} truncate={20} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* DSO Contracts — discovered dynamically */}
      {dsoParty.data?.dso_party_id && (
        <>
          <h3 className="text-lg font-semibold">DSO Active Contracts</h3>
          <DsoContractsPanel key={`${node.id}-${dsoParty.data.dso_party_id}`} partyId={dsoParty.data.dso_party_id} />
        </>
      )}

      {/* Parties on Synchronizer */}
      <PartiesOnValidator
        parties={allParties}
        nodeName={node.name}
        partySearch={partySearch}
        setPartySearch={setPartySearch}
        isLoading={users.isLoading}
        error={users.error as Error | null}
      />
    </div>
  )
}
