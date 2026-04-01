import { useState, useMemo, useEffect } from 'react'
import {
  Package,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  Layers,
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SearchInput } from '@/components/common/SearchInput'
import { CopyButton } from '@/components/common/CopyButton'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { EmptyState } from '@/components/common/EmptyState'
import { usePackages, useNodeConfig, useTemplateIndex, useActiveContracts, useFlatUsers, useLedgerEnd } from '@/hooks/useCantonQuery'
import { buildTemplateFilter } from '@/api/canton'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { autoQueryContractsAtom } from '@/stores/nodeStore'
import type { TemplateIndexEntry } from '@/api/canton'
import type { ActiveContract } from '@/types/canton'

interface PackageTemplateInfo {
  packageId: string
  packageName: string
  templates: TemplateIndexEntry[]
}

function PackageCard({
  packageId,
  info,
  expanded,
  onToggle,
  partyId,
}: {
  packageId: string
  info: PackageTemplateInfo | undefined
  expanded: boolean
  onToggle: () => void
  partyId: string | undefined
}) {
  const autoQuery = useAtomValue(autoQueryContractsAtom)
  // Fetch ledger-end ONCE for all template rows in this card
  const ledgerEnd = useLedgerEnd()
  const offset = ledgerEnd.data?.offset

  return (
    <Card className={expanded ? 'border-primary/50' : ''}>
      <CardContent className="p-0">
        <div
          role="button"
          tabIndex={0}
          className="w-full text-left p-4 hover:bg-muted/30 transition-colors cursor-pointer"
          onClick={onToggle}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {expanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Package className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                {info?.packageName ? (
                  <>
                    <p className="text-sm font-semibold">{info.packageName}</p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">{packageId}</p>
                  </>
                ) : (
                  <p className="text-sm font-mono truncate">{packageId}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {info && info.templates.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  <FileCode className="h-3 w-3 mr-1" />
                  {info.templates.length} template(s)
                </Badge>
              )}
              {!info && (
                <Badge variant="secondary" className="text-[10px] text-muted-foreground">
                  No indexed templates
                </Badge>
              )}
              <CopyButton text={packageId} className="h-7 w-7" />
            </div>
          </div>
        </div>

        {expanded && (
          <>
            <Separator />
            <div className="p-4 space-y-3 bg-muted/10">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Package ID</p>
                <div className="flex items-center gap-1">
                  <code className="text-xs font-mono bg-muted px-2 py-1 rounded break-all">{packageId}</code>
                  <CopyButton text={packageId} className="h-6 w-6 shrink-0" />
                </div>
              </div>

              {info?.packageName && (
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Package Name</p>
                  <code className="text-xs font-mono bg-muted px-2 py-1 rounded">{info.packageName}</code>
                </div>
              )}

              {info && info.templates.length > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    Templates ({info.templates.length})
                  </p>
                  <div className="space-y-1">
                    {info.templates
                      .sort((a, b) => a.entity.localeCompare(b.entity))
                      .map((t) => (
                        <TemplateRow
                          key={t.templateId}
                          template={t}
                          partyId={partyId}
                          autoQuery={autoQuery}
                          expanded={expanded}
                          offset={offset}
                        />
                      ))}
                  </div>
                </div>
              )}

              {!info && (
                <p className="text-xs text-muted-foreground">
                  No templates indexed for this package. Run the template indexer in Settings, or the package may contain
                  only interfaces, library modules, or templates with no active instances.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Individual template row — optionally queries active contract count when visible */
function TemplateRow({
  template,
  partyId,
  autoQuery,
  expanded,
  offset,
}: {
  template: TemplateIndexEntry
  partyId: string | undefined
  autoQuery: boolean
  expanded: boolean
  offset: string | undefined
}) {
  const shouldQuery = autoQuery && expanded && !!partyId && !!offset
  const filter = shouldQuery ? buildTemplateFilter(partyId!, template.templateId, offset) : null
  const contracts = useActiveContracts(filter, `pkg-${template.templateId}`)
  const count = contracts.data ? (contracts.data as ActiveContract[]).length : null

  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/50 group">
      <div className="flex items-center gap-2 min-w-0">
        <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium">{template.entity}</p>
          <p className="text-[10px] text-muted-foreground font-mono truncate">
            {template.module}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {count !== null && (
          <Badge variant="outline" className="text-[10px]">
            {count} active
          </Badge>
        )}
        {contracts.isLoading && <LoadingSpinner size={12} />}
        <CopyButton text={template.templateId} className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  )
}

export function PackagesPage() {
  const node = useNodeConfig()
  const packages = usePackages()
  const templateIndex = useTemplateIndex()
  const [search, setSearch] = useState('')
  const { copied, copy } = useCopyToClipboard()
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null)

  // Reset UI state on node change
  useEffect(() => {
    setExpandedPkg(null)
    setSearch('')
  }, [node.id])

  const packageIds = useMemo(() => packages.data?.packageIds ?? [], [packages.data?.packageIds])

  // Build lookup: packageId -> PackageTemplateInfo from the cached template index
  const packageInfoMap = useMemo(() => {
    const map: Record<string, PackageTemplateInfo> = {}
    const templates = templateIndex.data?.templates ?? []
    for (const t of templates) {
      if (!map[t.packageId]) {
        map[t.packageId] = { packageId: t.packageId, packageName: t.packageName, templates: [] }
      }
      map[t.packageId].templates.push(t)
      if (t.packageName && !map[t.packageId].packageName) {
        map[t.packageId].packageName = t.packageName
      }
    }
    return map
  }, [templateIndex.data])

  // Get a party for active contract queries — only fetch users when auto-query is on
  const autoQuery = useAtomValue(autoQueryContractsAtom)
  const users = useFlatUsers()
  const partyId = useMemo(() => {
    if (!autoQuery) return undefined
    // Use adminUser if set, otherwise first user's primaryParty
    if (node.adminUser) return node.adminUser
    for (const entry of users.users ?? []) {
      const u = (entry as Record<string, unknown>)?.user as Record<string, unknown> | undefined
      const party = ((u?.primaryParty ?? (entry as Record<string, unknown>)?.primaryParty) as string)
      if (party) return party
    }
    return undefined
  }, [autoQuery, node.adminUser, users.users])

  // Merge: all package IDs + indexed info, sorted (named first, then unnamed)
  const mergedPackages = useMemo(() => {
    const result = packageIds.map((id) => ({
      id,
      info: packageInfoMap[id],
      name: packageInfoMap[id]?.packageName ?? '',
    }))
    result.sort((a, b) => {
      if (a.name && !b.name) return -1
      if (!a.name && b.name) return 1
      if (a.name && b.name) return a.name.localeCompare(b.name)
      return 0
    })
    return result
  }, [packageIds, packageInfoMap])

  const filteredPackages = useMemo(
    () =>
      mergedPackages.filter(
        (p) =>
          p.id.toLowerCase().includes(search.toLowerCase()) ||
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.info?.templates ?? []).some(
            (t) =>
              t.entity.toLowerCase().includes(search.toLowerCase()) ||
              t.module.toLowerCase().includes(search.toLowerCase())
          )
      ),
    [mergedPackages, search]
  )

  const handleCopyAll = async () => {
    const lines = mergedPackages.map((p) => (p.name ? `${p.name}: ${p.id}` : p.id))
    await copy(lines.join('\n'))
  }

  const indexedCount = Object.keys(packageInfoMap).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Packages</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Installed packages on{' '}
            <span style={{ color: node.color }} className="font-medium">
              {node.name}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm">
            <Package className="h-3.5 w-3.5 mr-1" />
            {packageIds.length} package(s)
          </Badge>
          {packageIds.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleCopyAll}>
              {copied ? (
                <Check className="h-3.5 w-3.5 mr-1" />
              ) : (
                <Copy className="h-3.5 w-3.5 mr-1" />
              )}
              Copy All
            </Button>
          )}
        </div>
      </div>

      {/* Index status */}
      {templateIndex.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingSpinner size={14} />
          <span>Loading template index...</span>
        </div>
      )}
      {indexedCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {indexedCount} package(s) with indexed templates (of {packageIds.length} total)
          {templateIndex.data?.updatedAt && (
            <span> — indexed {new Date(templateIndex.data.updatedAt).toLocaleString()}</span>
          )}
        </div>
      )}
      {!templateIndex.isLoading && indexedCount === 0 && packageIds.length > 0 && (
        <div className="text-xs text-muted-foreground">
          No template index available. Go to Settings and click "Refresh Index Now" to discover templates.
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search packages..."
          className="max-w-md"
        />
        {search && <Badge variant="outline">{filteredPackages.length} match(es)</Badge>}
      </div>

      {/* Packages List */}
      {packages.isLoading && <LoadingSpinner text="Loading packages..." className="py-12" />}
      {packages.error && <ErrorDisplay error={packages.error as Error} />}

      <div className="space-y-2">
        {filteredPackages.map((pkg) => (
          <PackageCard
            key={pkg.id}
            packageId={pkg.id}
            info={pkg.info}
            expanded={expandedPkg === pkg.id}
            onToggle={() => setExpandedPkg(expandedPkg === pkg.id ? null : pkg.id)}
            partyId={partyId}
          />
        ))}

        {filteredPackages.length === 0 && !packages.isLoading && (
          <EmptyState
            icon={Package}
            title={search ? 'No matching packages' : 'No packages installed'}
            description={search ? 'Try a different search term' : 'No packages found on this node'}
          />
        )}
      </div>
    </div>
  )
}
