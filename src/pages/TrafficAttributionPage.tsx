import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAtom } from 'jotai'
import { Gauge, RefreshCw, Search } from 'lucide-react'
import { fetchTransactionByUpdateId, lighthouseExplorerUrl, type LighthouseNetwork } from '@/api/lighthouse'
import { ClearableInput } from '@/components/common/ClearableInput'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { IdDisplay } from '@/components/common/IdDisplay'
import { JsonViewer } from '@/components/common/JsonViewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { attributeTraffic, uniqueConfirmers, partyHint } from '@/lib/cip104'
import { FEATURED_APP_MODE, featuredAppCandidates, nextRemembered, resolveFeaturedApps } from '@/lib/featuredApps'
import { organizationOf, sumWeightsByOrganization } from '@/lib/organizations'
import {
  carryTicksAtom,
  groupByOrganizationAtom,
  lighthouseNetworkAtom,
  partyOrganizationLabelsAtom,
  rememberedFeaturedPartyIdsAtom,
} from '@/stores/cip104Store'
import type { LighthouseTransactionResponse } from '@/types/lighthouse'
import { cn } from '@/lib/utils'

function isLighthouseNetwork(v: string | null): v is LighthouseNetwork {
  return v === 'devnet' || v === 'mainnet'
}

function hasVisibleEvents(events: LighthouseTransactionResponse['events']): boolean {
  return Object.keys(events).some((k) => k !== 'verdict')
}

function MetaItem({
  label,
  value,
  valueClassName,
  valueTestId,
}: {
  label: string
  value: ReactNode
  valueClassName?: string
  valueTestId?: string
}) {
  return (
    <div className="flex items-baseline gap-1.5 text-xs min-w-0">
      <span className="font-semibold text-foreground shrink-0">{label}</span>
      <span
        data-testid={valueTestId}
        className={cn('font-mono font-medium break-all', valueClassName)}
      >
        {value}
      </span>
    </div>
  )
}

export function TrafficAttributionPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [network, setNetwork] = useAtom(lighthouseNetworkAtom)
  const [carryTicks, setCarryTicks] = useAtom(carryTicksAtom)
  const [remembered, setRemembered] = useAtom(rememberedFeaturedPartyIdsAtom)
  const [groupByOrganization, setGroupByOrganization] = useAtom(groupByOrganizationAtom)
  const [orgLabels, setOrgLabels] = useAtom(partyOrganizationLabelsAtom)

  const [updateId, setUpdateId] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [response, setResponse] = useState<LighthouseTransactionResponse | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const searchGenerationRef = useRef(0)
  const didBootstrapRef = useRef(false)

  const verdict = response?.events.verdict
  const views = useMemo(() => verdict?.transaction_views?.views ?? [], [verdict])
  const traffic = verdict?.traffic_summary
  const confirmers = useMemo(() => uniqueConfirmers(views), [views])
  const featuredCandidates = useMemo(() => featuredAppCandidates(confirmers), [confirmers])

  const attribution = useMemo(() => {
    if (!traffic) return null
    return attributeTraffic({
      traffic,
      views,
      featuredPartyIds: checked,
      activityWeight: 1,
    })
  }, [traffic, views, checked])

  const organizationWeights = useMemo(() => {
    if (!attribution) return []
    return sumWeightsByOrganization(attribution.weights, orgLabels)
  }, [attribution, orgLabels])

  const runSearch = useCallback(async (id: string, net: LighthouseNetwork) => {
    const trimmed = id.trim()
    if (!trimmed) return
    const generation = ++searchGenerationRef.current
    setSearching(true)
    setSearchError(null)
    setNotFound(false)
    setResponse(null)
    setChecked([])
    try {
      const data = await fetchTransactionByUpdateId(trimmed, net)
      if (generation !== searchGenerationRef.current) return
      const v = data.events.verdict
      const nextConfirmers = uniqueConfirmers(v?.transaction_views?.views ?? [])
      const nextChecked = resolveFeaturedApps({
        mode: FEATURED_APP_MODE,
        confirmers: nextConfirmers,
        remembered,
        carryTicks,
      })
      setResponse(data)
      setChecked(nextChecked)
      setSearchParams({ updateId: trimmed, network: net }, { replace: true })
    } catch (err) {
      if (generation !== searchGenerationRef.current) return
      const message = err instanceof Error ? err.message : 'Failed to fetch transaction'
      if (message === 'Transaction not found on this network') {
        setNotFound(true)
      } else {
        setSearchError(message)
      }
    } finally {
      if (generation === searchGenerationRef.current) {
        setSearching(false)
      }
    }
  }, [carryTicks, remembered, setSearchParams])

  useEffect(() => {
    if (didBootstrapRef.current) return
    didBootstrapRef.current = true
    const qNet = searchParams.get('network')
    const qId = searchParams.get('updateId')
    if (isLighthouseNetwork(qNet) && qNet !== network) setNetwork(qNet)
    if (qId && !response && !searching && !searchError && !notFound) {
      setUpdateId(qId)
      void runSearch(qId, isLighthouseNetwork(qNet) ? qNet : network)
    }
    // Intentionally mount-only for query-param bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onToggleParty(partyId: string, isOn: boolean) {
    if (!featuredCandidates.includes(partyId)) return
    const next = isOn
      ? [...checked, partyId]
      : checked.filter((p) => p !== partyId)
    setChecked(next)
    setRemembered(nextRemembered(remembered, confirmers, next))
  }

  function onOrgLabelChange(partyId: string, value: string) {
    const next = { ...orgLabels }
    if (value.trim()) next[partyId] = value
    else delete next[partyId]
    setOrgLabels(next)
  }

  function onNetworkChange(next: LighthouseNetwork) {
    setNetwork(next)
    setResponse(null)
    setSearchError(null)
    setNotFound(false)
    setChecked([])
    const qId = searchParams.get('updateId')?.trim() || updateId.trim()
    if (qId) void runSearch(qId, next)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Traffic (CIP-104)</h2>
        <p className="text-muted-foreground text-sm mt-1">
          As-if CIP-0104 confirming-weight calculator. Uses Lighthouse, not the selected Canton node.
          Rewards are not live on MainNet.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-40">
              <label className="text-xs text-muted-foreground mb-1 block">Network</label>
              <Select value={network} onValueChange={(v) => onNetworkChange(v as LighthouseNetwork)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="devnet">DevNet</SelectItem>
                  <SelectItem value="mainnet">MainNet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[16rem]">
              <label className="text-xs text-muted-foreground mb-1 block">UpdateId</label>
              <ClearableInput
                placeholder="Paste UpdateId..."
                value={updateId}
                onChange={(v) => { setUpdateId(v); setNotFound(false) }}
                onSubmit={() => void runSearch(updateId, network)}
              />
            </div>
            <Button
              size="sm"
              onClick={() => void runSearch(updateId, network)}
              disabled={searching || !updateId.trim()}
            >
              {searching ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-1.5" />}
              {searching ? 'Searching...' : 'Search'}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={carryTicks} onCheckedChange={setCarryTicks} id="carry-ticks" />
            <label htmlFor="carry-ticks" className="text-xs text-muted-foreground">
              Remember featured apps for next search
            </label>
          </div>
        </CardContent>
      </Card>

      {searchError && <ErrorDisplay error={searchError} />}
      {notFound && (
        <EmptyState
          icon={Gauge}
          title="Transaction not found"
          description={`No transaction with this UpdateId on ${network}.`}
        />
      )}

      {response && verdict && traffic && attribution && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Transaction</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Badge variant="outline" className="text-[10px] capitalize">{network}</Badge>
                <MetaItem
                  label="Round"
                  value={response.transaction.round}
                  valueClassName="text-violet-600 dark:text-violet-400"
                  valueTestId="tx-round"
                />
                <MetaItem
                  label="Recorded"
                  value={verdict.record_time}
                  valueClassName="text-muted-foreground"
                />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <MetaItem
                  label="Total"
                  value={`${attribution.total.toLocaleString()} B`}
                  valueClassName="text-sky-600 dark:text-sky-400"
                />
                {response.transaction.traffic_cost?.cost_usd != null && (
                  <MetaItem
                    label="Cost"
                    value={`$${response.transaction.traffic_cost.cost_usd}`}
                    valueClassName="text-emerald-600 dark:text-emerald-400"
                  />
                )}
              </div>
              <MetaItem
                label="Submitter"
                value={partyHint(verdict.submitting_parties?.[0] ?? 'unknown')}
                valueClassName="text-foreground"
              />
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <MetaItem
                  label="App envelopes"
                  value={`${attribution.appEnvelopeTraffic.toLocaleString()} B`}
                  valueClassName="text-sky-600 dark:text-sky-400"
                />
                <MetaItem
                  label="Leftover"
                  value={`${attribution.leftover.toLocaleString()} B`}
                  valueClassName="text-amber-600 dark:text-amber-400"
                />
                <MetaItem
                  label="Attributed"
                  value={`${attribution.weightSum.toLocaleString()} B`}
                  valueClassName="text-emerald-600 dark:text-emerald-400"
                />
                <MetaItem
                  label="Rounding"
                  value={`${attribution.roundingResidue.toLocaleString()} B`}
                  valueClassName="text-muted-foreground"
                  valueTestId="tx-rounding"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Leftover is envelopes with no featured confirmer. Rounding is bytes dropped by CIP-104 integer division
                {attribution.roundingResidue > 0 ? ` (${attribution.total.toLocaleString()} − ${attribution.weightSum.toLocaleString()}).` : '.'}
              </p>
              {!hasVisibleEvents(response.events) && (
                <p className="text-xs text-muted-foreground">
                  Events hidden (privacy). Attribution uses the mediator verdict.
                </p>
              )}
              <a
                className="inline-flex text-xs font-medium text-primary underline underline-offset-2"
                href={lighthouseExplorerUrl(network, response.transaction.update_id)}
                target="_blank"
                rel="noreferrer"
              >
                Open in Lighthouse
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Featured apps</CardTitle>
              <CardDescription>
                {checked.length} / {featuredCandidates.length} ticked. Nothing is featured until you tick it.
                DSO is the Decentralized Synchronizer Operator and is not a featured app.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {featuredCandidates.map((partyId, index) => (
                <div key={partyId} className="flex items-start gap-2 text-sm">
                  <input
                    id={`featured-app-${index}`}
                    type="checkbox"
                    className="mt-1"
                    checked={checked.includes(partyId)}
                    onChange={(e) => onToggleParty(partyId, e.target.checked)}
                  />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`featured-app-${index}`} className="font-medium cursor-pointer">
                      {partyHint(partyId)}
                    </label>
                    <IdDisplay
                      id={partyId}
                      truncate={0}
                      className="text-[10px] text-muted-foreground"
                    />
                    <label className="mt-1 block text-[10px] text-muted-foreground" htmlFor={`org-${index}`}>
                      Organization
                    </label>
                    <Input
                      id={`org-${index}`}
                      aria-label={`Organization for ${partyHint(partyId)}`}
                      className="h-7 text-xs"
                      placeholder={partyHint(partyId)}
                      value={orgLabels[partyId] ?? ''}
                      onChange={(e) => onOrgLabelChange(partyId, e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Envelopes</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-2">Views</th>
                    <th className="p-2 text-right">Cost</th>
                    <th className="p-2">Confirmers</th>
                    <th className="p-2">Featured</th>
                    <th className="p-2 text-right">Per app</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.envelopes.map((e, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 font-mono">{e.viewIds.length ? e.viewIds.join(', ') : '(empty)'}</td>
                      <td className="p-2 text-right font-mono">{e.cost.toLocaleString()}</td>
                      <td className="p-2">{e.confirmers.map(partyHint).join(', ') || '—'}</td>
                      <td className="p-2">{e.appConfirmers.map(partyHint).join(', ') || '—'}</td>
                      <td className="p-2 text-right font-mono">{e.leftover ? 'leftover' : e.perApp.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Per-app weights</CardTitle>
              <CardDescription>
                Assign the same organization name to roll parties together. Totals are CIP-104 integer weights.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={groupByOrganization}
                  onCheckedChange={setGroupByOrganization}
                  id="group-by-org"
                />
                <label htmlFor="group-by-org" className="text-xs text-muted-foreground">
                  Group by organization
                </label>
              </div>
              {attribution.weights.length === 0 && (
                <p className="text-xs text-muted-foreground">Tick featured confirmers to attribute leftover traffic.</p>
              )}
              {groupByOrganization
                ? organizationWeights.map((g) => (
                    <div key={g.organization} className="space-y-1" data-testid={`org-group-${g.organization}`}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <div className="font-medium">{g.organization}</div>
                        <span className="font-mono" data-testid={`org-weight-${g.organization}`}>
                          {g.weight.toLocaleString()}
                        </span>
                      </div>
                      {g.members.map((w) => (
                        <div key={w.partyId} className="flex items-center justify-between gap-2 pl-3 text-xs text-muted-foreground">
                          <div>
                            <div>{w.hint}</div>
                            <IdDisplay id={w.partyId} truncate={12} />
                          </div>
                          <span className="font-mono">{w.weight.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  ))
                : attribution.weights.map((w) => (
                    <div key={w.partyId} className="flex items-center justify-between gap-2 text-sm">
                      <div>
                        <div className="font-medium">{w.hint}</div>
                        <IdDisplay id={w.partyId} truncate={12} />
                        <div className="text-[10px] text-muted-foreground">
                          {organizationOf(w.partyId, w.hint, orgLabels)}
                        </div>
                      </div>
                      <span className="font-mono">{w.weight.toLocaleString()}</span>
                    </div>
                  ))}
            </CardContent>
          </Card>

          <details>
            <summary className="text-xs text-muted-foreground cursor-pointer">Raw JSON</summary>
            <JsonViewer data={response} />
          </details>
        </div>
      )}
    </div>
  )
}
