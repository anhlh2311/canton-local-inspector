import { useAtomValue, useSetAtom } from 'jotai'
import {
  Activity,
  Globe,
  Users,
  Package,
  Zap,
  Server,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { IdDisplay } from '@/components/common/IdDisplay'
import { StatusDot } from '@/components/common/StatusDot'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import {
  useVersion,
  useConnectedSynchronizers,
  useLedgerEnd,
  useFlatUsers,
  usePackages,
  useDsoPartyId,
  useNodeConfig,
} from '@/hooks/useCantonQuery'
import { nodesAtom, nodeHealthMapAtom } from '@/stores/nodeStore'
import { useQuery } from '@tanstack/react-query'
import { checkNodeHealth } from '@/api/canton'

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  loading,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  color: string
  loading?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}20` }}>
            <Icon className="h-5 w-5" style={{ color }} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            {loading ? (
              <LoadingSpinner size={16} />
            ) : (
              <p className="text-lg font-bold truncate">{value}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function NodesHealthPanel() {
  const nodes = useAtomValue(nodesAtom)
  const setHealthMap = useSetAtom(nodeHealthMapAtom)

  const { data: healthResults } = useQuery({
    queryKey: ['all-nodes-health'],
    queryFn: async () => {
      const results: Record<string, { status: 'online' | 'offline'; version?: string; latencyMs: number }> = {}
      const checks = nodes.map(async (node) => {
        const health = await checkNodeHealth(node)
        results[node.id] = {
          status: health.online ? 'online' : 'offline',
          version: health.version,
          latencyMs: health.latencyMs,
        }
      })
      await Promise.allSettled(checks)
      setHealthMap(
        Object.fromEntries(
          Object.entries(results).map(([id, h]) => [
            id,
            { nodeId: id, name: nodes.find((n) => n.id === id)?.name ?? id, ...h },
          ])
        )
      )
      return results
    },
    refetchInterval: 30000,
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Server className="h-4 w-4" />
          Node Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {nodes.map((node) => {
            const health = healthResults?.[node.id]
            return (
              <div key={node.id} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50">
                <div className="flex items-center gap-2">
                  <StatusDot status={health?.status ?? 'checking'} />
                  <span className="text-sm font-medium" style={{ color: node.color }}>
                    {node.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {health?.version && <span>v{health.version}</span>}
                  {health?.latencyMs !== undefined && (
                    <Badge variant={health.latencyMs < 500 ? 'success' : 'warning'}>
                      {health.latencyMs}ms
                    </Badge>
                  )}
                  <span>:{node.jsonApiPort}</span>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export function OverviewPage() {
  const node = useNodeConfig()
  const version = useVersion()
  const synchronizers = useConnectedSynchronizers()
  const ledgerEnd = useLedgerEnd()
  const users = useFlatUsers()
  const packages = usePackages()
  const dsoParty = useDsoPartyId()

  const syncId = synchronizers.data?.connectedSynchronizers?.[0]?.synchronizerId

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Network Overview</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Connected to <span style={{ color: node.color }} className="font-medium">{node.name}</span> on port {node.jsonApiPort}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Zap}
          label="Canton Version"
          value={version.data?.version ?? '—'}
          color="#6366f1"
          loading={version.isLoading}
        />
        <StatCard
          icon={Users}
          label="Users"
          value={users.totalLoaded ?? '—'}
          color="#22c55e"
          loading={users.isLoading}
        />
        <StatCard
          icon={Package}
          label="Packages"
          value={packages.data?.packageIds?.length ?? '—'}
          color="#f59e0b"
          loading={packages.isLoading}
        />
        <StatCard
          icon={Activity}
          label="Ledger Offset"
          value={ledgerEnd.data?.offset ?? '—'}
          color="#ec4899"
          loading={ledgerEnd.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Nodes Health */}
        <NodesHealthPanel />

        {/* Key Information */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Network Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {synchronizers.error && <ErrorDisplay error={synchronizers.error as Error} />}

            {syncId && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Global Synchronizer ID</p>
                <IdDisplay id={syncId} truncate={16} />
              </div>
            )}

            {dsoParty.data?.dso_party_id && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">DSO Party ID</p>
                <IdDisplay id={dsoParty.data.dso_party_id} truncate={16} />
              </div>
            )}

            {dsoParty.error && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">DSO Party</p>
                <Badge variant="warning">Scan proxy not available</Badge>
              </div>
            )}

            {ledgerEnd.data?.offset && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Current Ledger End</p>
                <code className="text-sm font-mono bg-muted px-2 py-1 rounded">{ledgerEnd.data.offset}</code>
              </div>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Connected Synchronizers ({synchronizers.data?.connectedSynchronizers?.length ?? 0})
              </p>
              {synchronizers.data?.connectedSynchronizers?.map((sync, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 mt-1">
                  <IdDisplay id={sync.synchronizerId} truncate={16} />
                  <Badge variant="success" className="text-[10px]">Connected</Badge>
                </div>
              ))}
              {(!synchronizers.data?.connectedSynchronizers || synchronizers.data.connectedSynchronizers.length === 0) && (
                <Badge variant="secondary">0 synchronizer(s)</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
