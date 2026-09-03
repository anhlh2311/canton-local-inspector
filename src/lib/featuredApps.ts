export type FeaturedAppMode = 'manual' | 'featuredAppRight'

export const FEATURED_APP_MODE: FeaturedAppMode = 'manual'

export interface ResolveFeaturedAppsInput {
  mode: FeaturedAppMode
  confirmers: string[]
  remembered: string[]
  carryTicks: boolean
}

export function resolveFeaturedApps(input: ResolveFeaturedAppsInput): string[] {
  if (input.mode === 'featuredAppRight') {
    throw new Error('featuredAppRight resolver is not implemented')
  }
  if (!input.carryTicks) return []
  const confirmerSet = new Set(input.confirmers)
  return input.remembered.filter((p) => confirmerSet.has(p))
}

export function nextRemembered(
  remembered: string[],
  confirmers: string[],
  checked: string[],
): string[] {
  const confirmerSet = new Set(confirmers)
  const kept = remembered.filter((p) => !confirmerSet.has(p))
  return [...kept, ...checked]
}
