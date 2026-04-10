export interface TemplateEntry {
  templateId: string
  packageId: string
  packageName: string
  module: string
  entity: string
}

export interface TemplateIndex {
  updatedAt: string | null
  network: string
  templates: TemplateEntry[]
}

export interface CronMeta {
  lastRun: string
  durationMs: number
  results: Record<string, { status: string; templateCount: number; error?: string; updatedAt: string }>
}

export interface NodeAuthConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  audience: string
  validatorAudience?: string
}

export interface TemplateStorage {
  getTemplateIndex(network: string): Promise<TemplateIndex | null>
  setTemplateIndex(network: string, data: TemplateIndex): Promise<void>
  getCronMeta(): Promise<CronMeta | null>
  setCronMeta(meta: CronMeta): Promise<void>
  getLastRunTimestamp(): Promise<number | null>
  setLastRunTimestamp(ts: number): Promise<void>
  acquireLock(ttlSeconds: number): Promise<boolean>
  releaseLock(): Promise<void>
  getCredentials(nodeId: string): Promise<NodeAuthConfig | null>
}
