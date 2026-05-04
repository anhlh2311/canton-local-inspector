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
import { ExportButton } from '@/components/common/ExportButton'
import { LoadAllButton } from '@/components/common/LoadAllButton'
import { JsonViewer } from '@/components/common/JsonViewer'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { EmptyState } from '@/components/common/EmptyState'
import { useAtomValue } from 'jotai'
import { themeAtom } from '@/stores/nodeStore'
import { useActiveContracts, useFlatUsers, useLedgerEnd, useNodeConfig, useDiscoverTemplates } from '@/hooks/useCantonQuery'
import { buildTemplateFilter, buildInterfaceFilter, getAuthToken, getEventsByContractId } from '@/api/canton'
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
        // Group by packageName, sort groups alphabetically, sort templates within group by entity
        const byPkg: Record<string, typeof raw> = {}
        for (const t of raw) {
          const key = t.packageName || t.templateId.split(':')[0] || ''
          if (!byPkg[key]) byPkg[key] = []
          byPkg[key].push(t)
        }
        const result: AutocompleteOption[] = []
        const sortedPkgs = Object.entries(byPkg).sort((a, b) => a[0].localeCompare(b[0]))
        for (const [pkgName, templates] of sortedPkgs) {
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
              group: pkgName,
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
        className="w-full text-left p-3 hover:bg-muted/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-1 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded) } }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <IdDisplay id={evt.contractId} truncate={16} />
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
          <Badge variant="outline" className={cn("text-[10px] font-mono w-fit", badgeStyles.indigo(dark))}>
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

function formatAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 10 })
}

// ---- Balance calculation dictionary ----
// Defines how to extract amounts and group contracts for balance-bearing templates and interfaces.

type BalanceType = 'cc' | 'holding' | 'none'

interface BalanceExtractor {
  type: BalanceType
  /** Extract the numeric amount from a contract's createArgument */
  getAmount: (args: Record<string, unknown>) => number | null
  /** Extract the grouping key (instrument ID) for holding-type contracts */
  getGroupKey?: (args: Record<string, unknown>) => string
  /** Unit label for CC-type balances */
  unit?: string
}

/** Get amount from a nested path like "amount.initialAmount" or "amulet.amount.initialAmount" */
function getNestedAmount(args: Record<string, unknown>, ...path: string[]): number | null {
  let obj: unknown = args
  for (const key of path) {
    if (!obj || typeof obj !== 'object') return null
    obj = (obj as Record<string, unknown>)[key]
  }
  return typeof obj === 'string' ? parseFloat(obj) : null
}

function getInstrumentId(args: Record<string, unknown>): string {
  const instrument = args?.instrument as Record<string, unknown> | undefined
  if (instrument?.id) return instrument.id as string
  // LockedAmulet/Amulet inside holding interfaces → group as "Amulet"
  if (args?.amulet) return 'Amulet'
  const amount = args?.amount as Record<string, unknown> | undefined
  if (amount?.initialAmount) return 'Amulet'
  return 'unknown'
}

/** Smart amount extractor that detects the contract structure:
 *  - Flat amount string (Holding): args.amount
 *  - Amulet ExpiringAmount: args.amount.initialAmount
 *  - LockedAmulet/AmuletAllocation: args.amulet.amount.initialAmount */
function getSmartAmount(args: Record<string, unknown>): number | null {
  // LockedAmulet / AmuletAllocation: amulet.amount.initialAmount (check FIRST — before flat amount)
  const amulet = args?.amulet as Record<string, unknown> | undefined
  if (amulet) {
    const amuletAmount = amulet.amount as Record<string, unknown> | undefined
    if (amuletAmount?.initialAmount) {
      const v = parseFloat(amuletAmount.initialAmount as string)
      if (!isNaN(v)) return v
    }
  }
  // Amulet: amount.initialAmount (ExpiringAmount object)
  if (args?.amount && typeof args.amount === 'object') {
    const amount = args.amount as Record<string, unknown>
    if (amount.initialAmount) {
      const v = parseFloat(amount.initialAmount as string)
      if (!isNaN(v)) return v
    }
  }
  // Flat string amount (Holding, CBTC, USDTEST, etc.)
  if (typeof args?.amount === 'string') {
    const v = parseFloat(args.amount)
    if (!isNaN(v)) return v
  }
  return null
}

/** Known templates that support balance calculation.
 *  Key: entity name (last part of templateId after the last colon). */
const TEMPLATE_BALANCE_CONFIG: Record<string, BalanceExtractor> = {
  // Splice Amulet (CC token)
  'Amulet': {
    type: 'cc',
    unit: 'CC',
    getAmount: (args) => getNestedAmount(args, 'amount', 'initialAmount'),
  },
  // Splice LockedAmulet (locked CC)
  'LockedAmulet': {
    type: 'cc',
    unit: 'CC',
    getAmount: (args) => getNestedAmount(args, 'amulet', 'amount', 'initialAmount'),
  },
  // Splice AmuletAllocation
  'AmuletAllocation': {
    type: 'cc',
    unit: 'CC',
    getAmount: (args) => getNestedAmount(args, 'amulet', 'amount', 'initialAmount'),
  },
  // Utility Registry Holding (multi-token: CBTC, USDTEST, etc.)
  'Holding': {
    type: 'holding',
    getAmount: (args) => typeof args?.amount === 'string' ? parseFloat(args.amount as string) : null,
    getGroupKey: getInstrumentId,
  },
}

/** Known interfaces that support balance calculation.
 *  Key: qualified interface name (Module:Entity part, after packageHash:). */
const INTERFACE_BALANCE_CONFIG: Record<string, BalanceExtractor> = {
  // Splice Token Holding interface — returns mixed types:
  // Regular Holdings (instrument.id + flat amount), LockedAmulet (amulet.amount.initialAmount), Amulet
  'Splice.Api.Token.HoldingV1:Holding': {
    type: 'holding',
    getAmount: getSmartAmount,
    getGroupKey: getInstrumentId,
  },
  // Splice Token Allocation interface
  'Splice.Api.Token.AllocationV1:Allocation': {
    type: 'cc',
    unit: 'CC',
    getAmount: (args) => getNestedAmount(args, 'amulet', 'amount', 'initialAmount'),
  },
}

/** Find the balance extractor for a given template or interface ID. */
function getBalanceExtractor(id: string): BalanceExtractor | null {
  // Check by entity name (template queries)
  const entity = id.split(':').pop() ?? ''
  if (TEMPLATE_BALANCE_CONFIG[entity]) return TEMPLATE_BALANCE_CONFIG[entity]

  // Check by Module:Entity (interface queries — strip packageHash prefix)
  const parts = id.split(':')
  if (parts.length >= 3) {
    const moduleEntity = parts.slice(1).join(':')
    if (INTERFACE_BALANCE_CONFIG[moduleEntity]) return INTERFACE_BALANCE_CONFIG[moduleEntity]
    // Also try with # prefix stripped (e.g., #splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding)
    const hashParts = id.startsWith('#') ? id.slice(1).split(':') : null
    if (hashParts && hashParts.length >= 3) {
      const hashModuleEntity = hashParts.slice(1).join(':')
      if (INTERFACE_BALANCE_CONFIG[hashModuleEntity]) return INTERFACE_BALANCE_CONFIG[hashModuleEntity]
    }
  }

  return null
}

/** Detect balance type from the ID and optionally from contract data structure. */
function detectBalanceType(data: ActiveContract[] | null, id: string): { type: BalanceType; extractor: BalanceExtractor | null } {
  const extractor = getBalanceExtractor(id)
  if (extractor) return { type: extractor.type, extractor }

  // Fallback: detect from contract data structure
  if (data && data.length > 0) {
    const args = data[0]?.contractEntry?.JsActiveContract?.createdEvent?.createArgument as Record<string, unknown> | undefined
    if (args) {
      // Check each known extractor to see if it can extract an amount
      for (const ext of [...Object.values(TEMPLATE_BALANCE_CONFIG), ...Object.values(INTERFACE_BALANCE_CONFIG)]) {
        if (ext.getAmount(args) !== null) return { type: ext.type, extractor: ext }
      }
    }
  }

  return { type: 'none', extractor: null }
}

/** Extract CC amount using the appropriate extractor. */
function extractCCAmount(c: ActiveContract, extractor: BalanceExtractor | null): number | null {
  if (!extractor) return null
  const args = c?.contractEntry?.JsActiveContract?.createdEvent?.createArgument as Record<string, unknown> | undefined
  if (!args) return null
  return extractor.getAmount(args)
}

/** Collapsible group of Holding contracts for the same instrument. */
function HoldingGroup({ instrumentId, sum, contracts }: { instrumentId: string; sum: number; contracts: ActiveContract[] }) {
  const [expanded, setExpanded] = useState(false)

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
          <span className="text-sm font-semibold">{instrumentId}</span>
          <Badge variant="outline" className="text-[10px]">{contracts.length} contract(s)</Badge>
        </div>
        <Badge variant="secondary" className="text-xs font-mono shrink-0">
          {formatAmount(sum)} {instrumentId}
        </Badge>
      </div>
      {expanded && (
        <div className="border-t border-border/50 p-2 space-y-2 bg-muted/10">
          {contracts.map((c, i) => (
            <ContractCard key={i} contract={c} defaultExpanded={contracts.length === 1} />
          ))}
        </div>
      )}
    </div>
  )
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
  const [prevTemplateId, setPrevTemplateId] = useState(templateId)
  // Clear local WS results when template changes
  if (templateId !== prevTemplateId) {
    setPrevTemplateId(templateId)
    setLocalContracts(null)
  }
  const limitError = !!(contracts.error && (contracts.error as { isLimitError?: boolean }).isLimitError)
  const cachedContracts = queryClient.getQueryData<ActiveContract[]>(['ws-contracts', node.id, templateId])

  const data = localContracts ?? cachedContracts ?? (contracts.data as ActiveContract[] | null)

  // Detect balance-bearing template types
  const balanceInfo = useMemo(() => detectBalanceType(data, templateId), [data, templateId])

  // Group by instrument for Holdings (hooks must be called before early returns)
  const groups = useMemo(() => {
    if (balanceInfo.type !== 'holding' || !balanceInfo.extractor || !data || data.length === 0) return null
    const ext = balanceInfo.extractor
    const map: Record<string, { sum: number; contracts: ActiveContract[] }> = {}
    for (const c of data) {
      const args = c?.contractEntry?.JsActiveContract?.createdEvent?.createArgument as Record<string, unknown> | undefined
      if (!args) continue
      const groupKey = ext.getGroupKey ? ext.getGroupKey(args) : 'unknown'
      if (!map[groupKey]) map[groupKey] = { sum: 0, contracts: [] }
      map[groupKey].contracts.push(c)
      const val = ext.getAmount(args)
      if (val != null && !isNaN(val)) map[groupKey].sum += val
    }
    return Object.entries(map).sort((a, b) => b[1].sum - a[1].sum)
  }, [data, balanceInfo])

  // CC total (Amulet, LockedAmulet, AmuletAllocation, etc.)
  const ccTotal = useMemo(() => {
    if (balanceInfo.type !== 'cc' || !balanceInfo.extractor || !data || data.length === 0) return null
    let sum = 0
    for (const c of data) {
      const val = extractCCAmount(c, balanceInfo.extractor)
      if (val) sum += val
    }
    return sum > 0 ? formatAmount(sum) : null
  }, [data, balanceInfo])

  // Show LoadAll for limit errors (after all hooks)
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

  if (!data) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm">Results</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              <span>{data.length.toLocaleString()} active contract(s)</span>
              {ccTotal && (
                <Badge variant="secondary" className="text-xs font-mono">
                  Total: {ccTotal} {balanceInfo.extractor?.unit || 'CC'}
                </Badge>
              )}
            </CardDescription>
          </div>
          <ExportButton contracts={data} filename={`contracts-${templateId.split(':').pop() || 'export'}`} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[80vh] overflow-y-auto">
        {groups ? (
          groups.map(([instrumentId, group]) => (
            <HoldingGroup key={instrumentId} instrumentId={instrumentId} sum={group.sum} contracts={group.contracts} />
          ))
        ) : data.length > 0 ? (
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
    const iid = interfaceId.trim()
    const pid = partyId.trim()
    // Interface IDs use packageHash:Module:Entity or #packageName:Module:Entity
    if (iid && pid && iid.includes(':') && iid.split(':').length >= 3) {
      return buildInterfaceFilter(pid, iid)
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
      {contracts.error && !(contracts.error as { isLimitError?: boolean }).isLimitError && (
        <ErrorDisplay error={contracts.error as Error} />
      )}
      <InterfaceQueryResults
        contracts={contracts}
        partyId={partyId}
        interfaceId={interfaceId}
      />
    </div>
  )
}

/** Results view for Interface queries — with LoadAll for >200 contracts */
function InterfaceQueryResults({
  contracts,
  partyId,
  interfaceId,
}: {
  contracts: { data: unknown; error: unknown; isLoading: boolean }
  partyId: string
  interfaceId: string
}) {
  const node = useNodeConfig()
  const ledgerEnd = useLedgerEnd()
  const offset = ledgerEnd.data?.offset
  const queryClient = useQueryClient()
  const [localContracts, setLocalContracts] = useState<ActiveContract[] | null>(null)
  const [prevInterfaceId, setPrevInterfaceId] = useState(interfaceId)
  if (interfaceId !== prevInterfaceId) {
    setPrevInterfaceId(interfaceId)
    setLocalContracts(null)
  }
  const limitError = !!(contracts.error && (contracts.error as { isLimitError?: boolean }).isLimitError)
  const cacheKey = `iface-${interfaceId}`
  const cachedContracts = queryClient.getQueryData<ActiveContract[]>(['ws-contracts', node.id, cacheKey])

  const data = localContracts ?? cachedContracts ?? (contracts.data as ActiveContract[] | null)

  // Detect balance type from contract data (interface queries don't have template entity name)
  const balanceInfo = useMemo(() => detectBalanceType(data, interfaceId), [data, interfaceId])

  const groups = useMemo(() => {
    if (balanceInfo.type !== 'holding' || !balanceInfo.extractor || !data || data.length === 0) return null
    const ext = balanceInfo.extractor
    const map: Record<string, { sum: number; contracts: ActiveContract[] }> = {}
    for (const c of data) {
      const args = c?.contractEntry?.JsActiveContract?.createdEvent?.createArgument as Record<string, unknown> | undefined
      if (!args) continue
      const groupKey = ext.getGroupKey ? ext.getGroupKey(args) : 'unknown'
      if (!map[groupKey]) map[groupKey] = { sum: 0, contracts: [] }
      map[groupKey].contracts.push(c)
      const val = ext.getAmount(args)
      if (val != null && !isNaN(val)) map[groupKey].sum += val
    }
    return Object.entries(map).sort((a, b) => b[1].sum - a[1].sum)
  }, [data, balanceInfo])

  const ccTotal = useMemo(() => {
    if (balanceInfo.type !== 'cc' || !balanceInfo.extractor || !data || data.length === 0) return null
    let sum = 0
    for (const c of data) {
      const val = extractCCAmount(c, balanceInfo.extractor)
      if (val) sum += val
    }
    return sum > 0 ? formatAmount(sum) : null
  }, [data, balanceInfo])

  // Early returns after all hooks
  if (limitError && !cachedContracts && !localContracts) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Results</CardTitle>
          <CardDescription className="flex items-center gap-2">
            200+ active contracts — exceeds HTTP limit
            <LoadAllButton
              partyId={partyId}
              templateId={interfaceId}
              activeAtOffset={offset}
              filterType="interface"
              onLoaded={(c) => setLocalContracts(c)}
            />
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!data) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm">Results</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              <span>{data.length.toLocaleString()} active contract(s)</span>
              {ccTotal && (
                <Badge variant="secondary" className="text-xs font-mono">
                  Total: {ccTotal} {balanceInfo.extractor?.unit || 'CC'}
                </Badge>
              )}
            </CardDescription>
          </div>
          <ExportButton contracts={data} filename={`contracts-${interfaceId.split(':').pop() || 'export'}`} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[80vh] overflow-y-auto">
          {groups ? (
            groups.map(([instrumentId, group]) => (
              <HoldingGroup key={instrumentId} instrumentId={instrumentId} sum={group.sum} contracts={group.contracts} />
            ))
          ) : data.length > 0 ? (
            data.map((c, i) => (
              <ContractCard key={i} contract={c} defaultExpanded={data.length === 1} />
            ))
          ) : (
            <EmptyState icon={Layers} title="No contracts found" description="No active contracts implement this interface" />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ContractIdTab() {
  const node = useNodeConfig()
  const [contractId, setContractId] = useState('')
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<{ data: Record<string, unknown>; createdEvent: Record<string, unknown> | null } | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const handleSearch = useCallback(async () => {
    const cid = contractId.trim()
    if (!cid) return

    setSearching(true)
    setSearchError(null)
    setResult(null)
    setSearched(false)

    try {
      const token = await getAuthToken(node)
      const data = await getEventsByContractId(node, token, cid) as Record<string, unknown>
      // Response: { created: { createdEvent: {...} }, archived: ... }
      const created = data?.created as Record<string, unknown> | undefined
      setResult({ data, createdEvent: created?.createdEvent as Record<string, unknown> | null ?? null })
      setSearched(true)
    } catch (err) {
      const axiosErr = err as { response?: { status?: number; data?: unknown } }
      if (axiosErr.response?.status === 404) {
        setSearched(true)
        setResult(null)
      } else {
        setSearchError(err instanceof Error ? err.message : 'Search failed')
      }
    } finally {
      setSearching(false)
    }
  }, [node, contractId])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Enter a contract ID to look up its events. No party or template selection needed.
          </p>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Contract ID</label>
            <ClearableInput
              placeholder="Paste full contract ID..."
              value={contractId}
              onChange={(v) => { setContractId(v); setSearched(false) }}
              onSubmit={handleSearch}
            />
          </div>
          <Button
            size="sm"
            onClick={handleSearch}
            disabled={searching || !contractId.trim()}
          >
            {searching ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Hash className="h-3.5 w-3.5 mr-1.5" />}
            {searching ? 'Searching...' : 'Find Contract'}
          </Button>
        </CardContent>
      </Card>

      {searchError && <ErrorDisplay error={searchError} />}

      {result?.createdEvent && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Contract Found</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px] font-mono">
                {(result.createdEvent.templateId as string)?.split(':').pop() ?? 'Unknown'}
              </Badge>
              {typeof result.createdEvent.packageName === 'string' && (
                <Badge variant="outline" className="text-[10px]">
                  {result.createdEvent.packageName as string}
                </Badge>
              )}
              {result.data.archived != null ? (
                <Badge variant="destructive" className="text-[10px]">Archived</Badge>
              ) : (
                <Badge variant="success" className="text-[10px]">Active</Badge>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Create Argument</p>
              <JsonViewer data={result.createdEvent.createArgument} />
            </div>
            {result.data.archived != null && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Archive Event</p>
                <JsonViewer data={result.data.archived} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {searched && !result?.createdEvent && !searchError && (
        <EmptyState icon={Hash} title="Contract not found" description={`No events found for contract ID "${contractId.slice(0, 20)}..."`} />
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
