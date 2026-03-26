import { useState, useCallback, useMemo } from 'react'
import {
  FileCode,
  RefreshCw,
  Filter,
  Hash,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClearableInput } from '@/components/common/ClearableInput'
import { AutocompleteInput, type AutocompleteOption } from '@/components/common/AutocompleteInput'
import { IdDisplay } from '@/components/common/IdDisplay'
import { JsonViewer } from '@/components/common/JsonViewer'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { EmptyState } from '@/components/common/EmptyState'
import { useActiveContracts, useFlatUsers, useNodeConfig, useDiscoverTemplates } from '@/hooks/useCantonQuery'
import { buildTemplateFilter, buildInterfaceFilter } from '@/api/canton'
import { cn, truncateId } from '@/lib/utils'
import type { ActiveContract } from '@/types/canton'

// Build party autocomplete options from loaded users
function usePartyOptions() {
  const users = useFlatUsers()
  return useMemo(() => {
    const seen = new Set<string>()
    const opts: AutocompleteOption[] = []
    for (const entry of users.users ?? []) {
      const u = ((entry as Record<string, unknown>)?.user ?? entry) as Record<string, unknown>
      const party = u?.primaryParty as string | undefined
      if (!party || seen.has(party)) continue
      seen.add(party)
      opts.push({
        value: party,
        label: (u?.id as string) ?? truncateId(party, 16),
        sublabel: party,
      })
    }
    return opts
  }, [users.users])
}

// Build template autocomplete options from discovered templates
function useTemplateOptions(partyId: string | undefined) {
  const discovery = useDiscoverTemplates(partyId)
  const options: AutocompleteOption[] = useMemo(
    () =>
      (discovery.data ?? []).map((t) => ({
        value: t.templateId,
        label: `${t.templateId.split(':').pop()} (${t.count})`,
        sublabel: t.packageName || t.templateId.split(':')[0],
      })),
    [discovery.data]
  )
  return { options, isLoading: discovery.isLoading }
}

function ContractCard({ contract, defaultExpanded }: { contract: ActiveContract; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const evt = contract.contractEntry?.JsActiveContract?.createdEvent
  if (!evt) return null

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        className="w-full text-left p-3 hover:bg-muted/30 transition-colors flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded) } }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <IdDisplay id={evt.contractId} truncate={16} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
            {evt.templateId?.split(':').pop() ?? 'Unknown'}
          </Badge>
          {evt.packageName && (
            <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border-amber-500/30">
              {evt.packageName}
            </Badge>
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border/50">
          <div className="p-3 space-y-2 bg-muted/10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground">Template ID</p>
                <IdDisplay id={evt.templateId} truncate={20} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Contract ID</p>
                <IdDisplay id={evt.contractId} truncate={20} />
              </div>
            </div>
            {evt.signatories?.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Signatories</p>
                <div className="flex flex-wrap gap-1">
                  {evt.signatories.map((s, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px] font-mono">{s.slice(0, 20)}...</Badge>
                  ))}
                </div>
              </div>
            )}
            {evt.observers?.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Observers</p>
                <div className="flex flex-wrap gap-1">
                  {evt.observers.map((o, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-mono">{o.slice(0, 20)}...</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-border/50">
            <div className="p-2">
              <p className="text-[10px] text-muted-foreground mb-1 px-2">Create Argument</p>
              <JsonViewer data={evt.createArgument} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TemplateQueryTab() {
  const [templateId, setTemplateId] = useState('')
  const [partyId, setPartyId] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)

  const queryRequest = useMemo(() => {
    if (templateId.trim() && partyId.trim()) {
      return buildTemplateFilter(partyId.trim(), templateId.trim())
    }
    return null
  }, [templateId, partyId])

  const contracts = useActiveContracts(queryRequest, `tpl-${templateId}-${refreshCount}`)

  const partyOptions = usePartyOptions()
  const templateOpts = useTemplateOptions(partyId || undefined)

  const handleRefresh = useCallback(() => {
    setRefreshCount((c) => c + 1)
  }, [])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Party ID</label>
              <AutocompleteInput
                placeholder="Search or select a party..."
                value={partyId}
                onChange={setPartyId}
                options={partyOptions}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Template ID</label>
              <AutocompleteInput
                placeholder={partyId ? "Search or select a template..." : "Select a party first..."}
                value={templateId}
                onChange={setTemplateId}
                options={templateOpts.options}
                loading={templateOpts.isLoading}
              />
            </div>
          </div>
          {queryRequest && (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={contracts.isLoading} className="border-success/50 text-success hover:bg-success/10 hover:text-success">
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", contracts.isLoading && "animate-spin")} />
              Refresh
            </Button>
          )}
        </CardContent>
      </Card>

      {contracts.isLoading && <LoadingSpinner text="Querying contracts..." className="py-8" />}
      {contracts.error && <ErrorDisplay error={contracts.error as Error} />}
      {contracts.data && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Results</CardTitle>
            <CardDescription>{(contracts.data as unknown[]).length} active contract(s)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(contracts.data as ActiveContract[]).length > 0 ? (
              (contracts.data as ActiveContract[]).map((c, i) => (
                <ContractCard key={i} contract={c} defaultExpanded={(contracts.data as ActiveContract[]).length === 1} />
              ))
            ) : (
              <EmptyState icon={FileCode} title="No contracts found" description="No active contracts match this query" />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function InterfaceQueryTab() {
  const [interfaceId, setInterfaceId] = useState('')
  const [partyId, setPartyId] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)

  const queryRequest = useMemo(() => {
    if (interfaceId.trim() && partyId.trim()) {
      return buildInterfaceFilter(partyId.trim(), interfaceId.trim())
    }
    return null
  }, [interfaceId, partyId])

  const contracts = useActiveContracts(queryRequest, `iface-${interfaceId}-${refreshCount}`)

  const partyOptions = usePartyOptions()

  const handleRefresh = useCallback(() => {
    setRefreshCount((c) => c + 1)
  }, [])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Party ID</label>
              <AutocompleteInput
                placeholder="Search or select a party..."
                value={partyId}
                onChange={setPartyId}
                options={partyOptions}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Interface ID</label>
              <ClearableInput placeholder="#package:Module:Interface" value={interfaceId} onChange={setInterfaceId} />
            </div>
          </div>
          {queryRequest && (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={contracts.isLoading} className="border-success/50 text-success hover:bg-success/10 hover:text-success">
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", contracts.isLoading && "animate-spin")} />
              Refresh
            </Button>
          )}
        </CardContent>
      </Card>

      {contracts.isLoading && <LoadingSpinner text="Querying contracts..." className="py-8" />}
      {contracts.error && <ErrorDisplay error={contracts.error as Error} />}
      {contracts.data && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Results</CardTitle>
            <CardDescription>{(contracts.data as unknown[]).length} active contract(s)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(contracts.data as ActiveContract[]).length > 0 ? (
              (contracts.data as ActiveContract[]).map((c, i) => (
                <ContractCard key={i} contract={c} defaultExpanded={(contracts.data as ActiveContract[]).length === 1} />
              ))
            ) : (
              <EmptyState icon={Layers} title="No contracts found" description="No active contracts implement this interface" />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ContractIdTab() {
  const [contractId, setContractId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [partyId, setPartyId] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)

  const queryRequest = useMemo(() => {
    if (templateId.trim() && partyId.trim()) {
      return buildTemplateFilter(partyId.trim(), templateId.trim())
    }
    return null
  }, [templateId, partyId])

  const contracts = useActiveContracts(queryRequest, `cid-${templateId}-${refreshCount}`)
  const partyOptions = usePartyOptions()
  const templateOpts = useTemplateOptions(partyId || undefined)

  const handleRefresh = useCallback(() => {
    setRefreshCount((c) => c + 1)
  }, [])

  const matchedContract = contracts.data
    ? (contracts.data as ActiveContract[]).find(
        (c) => c.contractEntry?.JsActiveContract?.createdEvent?.contractId === contractId.trim()
      )
    : null

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Select a party and template to load contracts, then optionally filter by contract ID.
          </p>
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Party ID</label>
                <AutocompleteInput
                  placeholder="Search or select a party..."
                  value={partyId}
                  onChange={setPartyId}
                  options={partyOptions}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Template ID</label>
                <AutocompleteInput
                  placeholder={partyId ? "Search or select a template..." : "Select a party first..."}
                  value={templateId}
                  onChange={setTemplateId}
                  options={templateOpts.options}
                  loading={templateOpts.isLoading}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contract ID (optional filter)</label>
              <ClearableInput placeholder="Contract ID to find..." value={contractId} onChange={setContractId} />
            </div>
          </div>
          {queryRequest && (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={contracts.isLoading} className="border-success/50 text-success hover:bg-success/10 hover:text-success">
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", contracts.isLoading && "animate-spin")} />
              Refresh
            </Button>
          )}
        </CardContent>
      </Card>

      {contracts.isLoading && <LoadingSpinner text="Searching..." className="py-8" />}
      {contracts.error && <ErrorDisplay error={contracts.error as Error} />}

      {contracts.data && contractId.trim() && matchedContract && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Found Contract</CardTitle>
          </CardHeader>
          <CardContent>
            <ContractCard contract={matchedContract} defaultExpanded />
          </CardContent>
        </Card>
      )}

      {contracts.data && contractId.trim() && !matchedContract && (
        <EmptyState icon={Hash} title="Contract not found" description={`No contract with ID "${contractId.slice(0, 20)}..." found in active contracts`} />
      )}

      {contracts.data && !contractId.trim() && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">All Active Contracts</CardTitle>
            <CardDescription>{(contracts.data as unknown[]).length} contract(s) — enter a contract ID above to filter</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(contracts.data as ActiveContract[]).map((c, i) => (
              <ContractCard key={i} contract={c} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function ContractsPage() {
  const node = useNodeConfig()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Contract Explorer</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Query active contracts on <span style={{ color: node.color }} className="font-medium">{node.name}</span>
        </p>
      </div>

      <Tabs defaultValue="template" key={node.id}>
        <TabsList>
          <TabsTrigger value="template" className="gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            By Template
          </TabsTrigger>
          <TabsTrigger value="interface" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            By Interface
          </TabsTrigger>
          <TabsTrigger value="contract-id" className="gap-1.5">
            <Hash className="h-3.5 w-3.5" />
            By Contract ID
          </TabsTrigger>
        </TabsList>

        <TabsContent value="template">
          <TemplateQueryTab />
        </TabsContent>
        <TabsContent value="interface">
          <InterfaceQueryTab />
        </TabsContent>
        <TabsContent value="contract-id">
          <ContractIdTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
