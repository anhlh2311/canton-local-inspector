import { useState, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
import { CopyButton } from '@/components/common/CopyButton'
import { LoadAllButton } from '@/components/common/LoadAllButton'
import { JsonViewer } from '@/components/common/JsonViewer'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { EmptyState } from '@/components/common/EmptyState'
import { useAtomValue } from 'jotai'
import { themeAtom } from '@/stores/nodeStore'
import { useActiveContracts, useFlatUsers, useLedgerEnd, useNodeConfig, useDiscoverTemplates } from '@/hooks/useCantonQuery'
import { buildTemplateFilter, buildInterfaceFilter } from '@/api/canton'
import { cn, truncateId } from '@/lib/utils'
import type { ActiveContract } from '@/types/canton'

// Badge style helpers — conditionally switch between light/dark since Tailwind v4
// dark: variant may not track the .dark class toggle reliably.
const badgeStyles = {
  indigo: (dark: boolean) => dark
    ? 'bg-transparent text-indigo-400 border-indigo-500/30'
    : 'bg-indigo-100 text-indigo-700 border-indigo-300',
  violet: (dark: boolean) => dark
    ? 'bg-transparent text-violet-400 border-violet-500/30'
    : 'bg-violet-100 text-violet-700 border-violet-300',
  amber: (dark: boolean) => dark
    ? 'bg-transparent text-amber-400 border-amber-500/30'
    : 'bg-amber-100 text-amber-700 border-amber-300',
  gray: (dark: boolean) => dark
    ? 'bg-transparent text-gray-400 border-gray-500/30'
    : 'bg-gray-200 text-gray-800 border-gray-300',
  grayLight: (dark: boolean) => dark
    ? 'bg-transparent text-gray-400 border-gray-500/30'
    : 'bg-gray-100 text-gray-700 border-gray-300',
}

// Build party autocomplete options from loaded users (lightweight, already cached).
// Users can also type any party ID manually for external parties.
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
      (() => {
        const raw = discovery.data ?? []
        // Group by packageId, sort groups by packageName, sort templates within group by entity
        const byPkg: Record<string, typeof raw> = {}
        for (const t of raw) {
          const pkgId = t.templateId.split(':')[0] || ''
          if (!byPkg[pkgId]) byPkg[pkgId] = []
          byPkg[pkgId].push(t)
        }
        const result: AutocompleteOption[] = []
        const sortedPkgs = Object.entries(byPkg).sort((a, b) => {
          const nameA = a[1][0]?.packageName || a[0]
          const nameB = b[1][0]?.packageName || b[0]
          return nameA.localeCompare(nameB)
        })
        for (const [pkgId, templates] of sortedPkgs) {
          const pkgName = templates[0]?.packageName || ''
          const pkgShort = pkgId.length > 20 ? `${pkgId.slice(0, 10)}...${pkgId.slice(-10)}` : pkgId
          const groupLabel = pkgName ? `${pkgShort}(${pkgName})` : pkgShort
          const sorted = [...templates].sort((a, b) => {
            const eA = a.templateId.split(':').pop() || ''
            const eB = b.templateId.split(':').pop() || ''
            return eA.localeCompare(eB)
          })
          for (const t of sorted) {
            const parts = t.templateId.split(':')
            const entity = parts.pop() || ''
            const module = parts.slice(1).join(':')
            result.push({
              value: t.templateId,
              label: entity,
              sublabel: module,
              group: groupLabel,
            })
          }
        }
        return result
      })(),
    [discovery.data]
  )
  return { options, isLoading: discovery.isLoading }
}

function ContractCard({ contract, defaultExpanded }: { contract: ActiveContract; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const dark = useAtomValue(themeAtom) === 'dark'
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
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Badge variant="outline" className={cn("text-[10px] font-mono", badgeStyles.indigo(dark))}>
            {evt.templateId?.split(':').pop() ?? 'Unknown'}
          </Badge>
          {evt.packageName && (
            <Badge variant="outline" className={cn("text-[10px]", badgeStyles.amber(dark))}>
              {evt.packageName}
            </Badge>
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border/50">
          <div className="p-3 space-y-2 bg-muted/10">
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground">Template ID</p>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className={cn("text-[10px] font-mono w-fit", badgeStyles.indigo(dark))}>{evt.templateId}</Badge>
                <CopyButton text={evt.templateId} className="h-5 w-5 shrink-0" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground">Contract ID</p>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className={cn("text-[10px] font-mono w-fit", badgeStyles.violet(dark))}>{evt.contractId}</Badge>
                <CopyButton text={evt.contractId} className="h-5 w-5 shrink-0" />
              </div>
            </div>
            {evt.signatories?.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Signatories</p>
                <div className="flex flex-col gap-1">
                  {evt.signatories.map((s, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <Badge variant="outline" className={cn("text-[10px] font-mono w-fit", badgeStyles.gray(dark))}>{s}</Badge>
                      <CopyButton text={s} className="h-5 w-5 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {evt.observers?.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Observers</p>
                <div className="flex flex-col gap-1">
                  {evt.observers.map((o, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <Badge variant="outline" className={cn("text-[10px] font-mono w-fit", badgeStyles.grayLight(dark))}>{o}</Badge>
                      <CopyButton text={o} className="h-5 w-5 shrink-0" />
                    </div>
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

function isValidTemplateId(id: string): boolean {
  return id.includes(':') && id.split(':').length >= 3
}

function TemplateQueryTab() {
  const [templateId, setTemplateId] = useState('')
  const [partyId, setPartyId] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)

  const queryRequest = useMemo(() => {
    const tid = templateId.trim()
    const pid = partyId.trim()
    if (tid && pid && isValidTemplateId(tid)) {
      return buildTemplateFilter(pid, tid)
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
      {contracts.error && !(contracts.error as { isLimitError?: boolean }).isLimitError && (
        <ErrorDisplay error={contracts.error as Error} />
      )}
      <TemplateQueryResults
        contracts={contracts}
        partyId={partyId}
        templateId={templateId}
      />
    </div>
  )
}

interface BalanceEntry {
  total: string
  unit: string
  count: number
}

/** Compute total balances for Amulet and Holding templates.
 *  Holdings are grouped by instrument.id since a party can hold multiple token types. */
function computeBalances(contracts: ActiveContract[], templateId: string): BalanceEntry[] {
  const entity = templateId.split(':').pop() ?? ''
  if (entity !== 'Amulet' && entity !== 'Holding') return []

  if (entity === 'Amulet') {
    let sum = 0
    let count = 0
    for (const c of contracts) {
      const args = c?.contractEntry?.JsActiveContract?.createdEvent?.createArgument as Record<string, unknown> | undefined
      const amount = args?.amount as Record<string, unknown> | undefined
      const val = amount?.initialAmount as string | undefined
      if (val) { sum += parseFloat(val); count++ }
    }
    if (sum === 0) return []
    return [{ total: formatAmount(sum), unit: 'CC', count }]
  }

  // Holding: group by instrument.id
  const groups: Record<string, { sum: number; count: number }> = {}
  for (const c of contracts) {
    const args = c?.contractEntry?.JsActiveContract?.createdEvent?.createArgument as Record<string, unknown> | undefined
    if (!args) continue
    const val = args.amount as string | undefined
    const instrument = args.instrument as Record<string, unknown> | undefined
    const instrumentId = (instrument?.id as string) || 'unknown'
    if (!groups[instrumentId]) groups[instrumentId] = { sum: 0, count: 0 }
    if (val) { groups[instrumentId].sum += parseFloat(val); groups[instrumentId].count++ }
  }

  return Object.entries(groups)
    .filter(([, g]) => g.sum > 0)
    .sort((a, b) => b[1].sum - a[1].sum)
    .map(([unit, g]) => ({ total: formatAmount(g.sum), unit, count: g.count }))
}

function formatAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 10 })
}

/** Results view with LoadAll support for >200 contracts */
function TemplateQueryResults({
  contracts,
  partyId,
  templateId,
}: {
  contracts: { data: unknown; error: unknown; isLoading: boolean }
  partyId: string
  templateId: string
}) {
  const node = useNodeConfig()
  const ledgerEnd = useLedgerEnd()
  const offset = ledgerEnd.data?.offset
  const queryClient = useQueryClient()
  const [localContracts, setLocalContracts] = useState<ActiveContract[] | null>(null)
  const limitError = !!(contracts.error && (contracts.error as { isLimitError?: boolean }).isLimitError)
  const cachedContracts = queryClient.getQueryData<ActiveContract[]>(['ws-contracts', node.id, templateId])

  // Show LoadAll for limit errors (unless cached)
  if (limitError && !cachedContracts && !localContracts) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Results</CardTitle>
          <CardDescription className="flex items-center gap-2">
            200+ active contracts — exceeds HTTP limit
            <LoadAllButton
              partyId={partyId}
              templateId={templateId}
              activeAtOffset={offset}
              onLoaded={(c) => setLocalContracts(c)}
            />
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const data = localContracts ?? cachedContracts ?? (contracts.data as ActiveContract[] | null)
  if (!data) return null

  // Calculate total balances for Amulet and Holding templates
  const balances = computeBalances(data, templateId)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Results</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{data.length.toLocaleString()} active contract(s)</span>
          {balances.map((b) => (
            <Badge key={b.unit} variant="secondary" className="text-xs font-mono">
              {b.total} {b.unit} ({b.count})
            </Badge>
          ))}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[80vh] overflow-y-auto">
        {data.length > 0 ? (
          data.map((c, i) => (
            <ContractCard key={i} contract={c} defaultExpanded={data.length === 1} />
          ))
        ) : (
          <EmptyState icon={FileCode} title="No contracts found" description="No active contracts match this query" />
        )}
        </div>
      </CardContent>
    </Card>
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
    const tid = templateId.trim()
    const pid = partyId.trim()
    if (tid && pid && isValidTemplateId(tid)) {
      return buildTemplateFilter(pid, tid)
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
