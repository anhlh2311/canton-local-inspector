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
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SearchInput } from '@/components/common/SearchInput'
import { CopyButton } from '@/components/common/CopyButton'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { EmptyState } from '@/components/common/EmptyState'
import { usePackages, useNodeConfig, useFlatUsers, usePackageDiscovery } from '@/hooks/useCantonQuery'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import type { PackageInfo } from '@/api/canton'

function PackageCard({
  packageId,
  info,
  expanded,
  onToggle,
}: {
  packageId: string
  info: PackageInfo | undefined
  expanded: boolean
  onToggle: () => void
}) {
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
              {info && (
                <>
                  <Badge variant="secondary" className="text-[10px]">
                    <FileCode className="h-3 w-3 mr-1" />
                    {info.templates.length} template(s)
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {info.templates.reduce((sum, t) => sum + t.activeCount, 0)} contract(s)
                  </Badge>
                </>
              )}
              {!info && (
                <Badge variant="secondary" className="text-[10px] text-muted-foreground">
                  No active contracts
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
                    Templates & Interfaces ({info.templates.length})
                  </p>
                  <div className="space-y-1">
                    {info.templates
                      .sort((a, b) => b.activeCount - a.activeCount)
                      .map((t) => (
                        <div
                          key={t.templateId}
                          className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/50 group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium">{t.entityName}</p>
                              <p className="text-[10px] text-muted-foreground font-mono truncate">
                                {t.moduleName}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-[10px]">
                              {t.activeCount} active
                            </Badge>
                            <CopyButton text={t.templateId} className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {!info && (
                <p className="text-xs text-muted-foreground">
                  No active contracts found for this package. The package is installed but may contain
                  interfaces, library modules, or templates with no active instances.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function PackagesPage() {
  const node = useNodeConfig()
  const packages = usePackages()
  const users = useFlatUsers()
  const [search, setSearch] = useState('')
  const { copied, copy } = useCopyToClipboard()
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null)

  // Reset UI state on node change
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setExpandedPkg(null)
    setSearch('')
  }, [node.id])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Use first available party for discovery
  const parties = (users.users ?? [])
    .map((u: Record<string, unknown>) => (u?.user as Record<string, unknown>)?.primaryParty ?? u?.primaryParty)
    .filter(Boolean) as string[]
  const discoveryParty = parties[0]
  const discovery = usePackageDiscovery(discoveryParty)

  const packageIds = useMemo(() => packages.data?.packageIds ?? [], [packages.data?.packageIds])

  // Build lookup: packageId -> PackageInfo
  const packageInfoMap = useMemo(() => {
    const map: Record<string, PackageInfo> = {}
    for (const info of discovery.data ?? []) {
      map[info.packageId] = info
    }
    return map
  }, [discovery.data])

  // Merge: all package IDs + discovered info, sorted (named first, then unnamed)
  const mergedPackages = useMemo(() => {
    const result = packageIds.map((id) => ({
      id,
      info: packageInfoMap[id],
      name: packageInfoMap[id]?.packageName ?? '',
    }))
    // Sort: packages with names first (alphabetically), then unnamed
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
              t.entityName.toLowerCase().includes(search.toLowerCase()) ||
              t.moduleName.toLowerCase().includes(search.toLowerCase())
          )
      ),
    [mergedPackages, search]
  )

  const handleCopyAll = async () => {
    const lines = mergedPackages.map((p) => (p.name ? `${p.name}: ${p.id}` : p.id))
    await copy(lines.join('\n'))
  }

  const discoveredCount = discovery.data?.length ?? 0
  const withTemplatesCount = filteredPackages.filter((p) => p.info).length

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

      {/* Discovery status */}
      {discovery.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingSpinner size={14} />
          <span>Discovering package names and templates from active contracts...</span>
        </div>
      )}
      {discovery.error && (
        <ErrorDisplay error="Could not discover package metadata from active contracts. Make sure a party with active contracts exists." />
      )}
      {discoveredCount > 0 && (
        <div className="text-xs text-muted-foreground">
          Discovered {discoveredCount} package(s) with active contracts ({withTemplatesCount} of {filteredPackages.length} shown have templates)
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by package name, ID, or template..."
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
