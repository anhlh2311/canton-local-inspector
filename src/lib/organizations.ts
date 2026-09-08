import type { AppWeight } from './cip104'

export interface OrganizationWeight {
  organization: string
  weight: number
  members: AppWeight[]
}

export function organizationOf(
  partyId: string,
  hint: string,
  labels: Record<string, string>,
): string {
  const named = labels[partyId]?.trim()
  return named || hint
}

export function sumWeightsByOrganization(
  weights: AppWeight[],
  labels: Record<string, string>,
): OrganizationWeight[] {
  const byOrg = new Map<string, OrganizationWeight>()
  for (const member of weights) {
    const organization = organizationOf(member.partyId, member.hint, labels)
    const existing = byOrg.get(organization)
    if (existing) {
      existing.weight += member.weight
      existing.members.push(member)
    } else {
      byOrg.set(organization, { organization, weight: member.weight, members: [member] })
    }
  }
  return [...byOrg.values()].sort((a, b) => b.weight - a.weight || a.organization.localeCompare(b.organization))
}
