import pg from 'pg'
import type { TemplateStorage, TemplateIndex, CronMeta, NodeAuthConfig } from './interface.js'

export class PostgresStorage implements TemplateStorage {
  private pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString })
  }

  async getTemplateIndex(network: string): Promise<TemplateIndex | null> {
    const result = await this.pool.query(
      'SELECT data FROM template_index WHERE network = $1',
      [network]
    )
    return result.rows[0]?.data ?? null
  }

  async setTemplateIndex(network: string, data: TemplateIndex): Promise<void> {
    await this.pool.query(
      `INSERT INTO template_index (network, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (network) DO UPDATE SET data = $2, updated_at = NOW()`,
      [network, JSON.stringify(data)]
    )
  }

  async getCronMeta(): Promise<CronMeta | null> {
    const result = await this.pool.query('SELECT data FROM cron_meta WHERE id = 1')
    return result.rows[0]?.data ?? null
  }

  async setCronMeta(meta: CronMeta): Promise<void> {
    await this.pool.query(
      `INSERT INTO cron_meta (id, data, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
      [JSON.stringify(meta)]
    )
  }

  async getLastRunTimestamp(): Promise<number | null> {
    await this.pool.query(
      "DELETE FROM cron_state WHERE expires_at IS NOT NULL AND expires_at < NOW()"
    )
    const result = await this.pool.query(
      "SELECT value FROM cron_state WHERE key = 'lastRunTs'"
    )
    return result.rows[0] ? Number(result.rows[0].value) : null
  }

  async setLastRunTimestamp(ts: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO cron_state (key, value)
       VALUES ('lastRunTs', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [String(ts)]
    )
  }

  async acquireLock(ttlSeconds: number): Promise<boolean> {
    await this.pool.query(
      "DELETE FROM cron_state WHERE key = 'lock' AND expires_at IS NOT NULL AND expires_at < NOW()"
    )
    try {
      await this.pool.query(
        `INSERT INTO cron_state (key, value, expires_at)
         VALUES ('lock', 'running', NOW() + $1 * INTERVAL '1 second')`,
        [ttlSeconds]
      )
      return true
    } catch {
      return false
    }
  }

  async releaseLock(): Promise<void> {
    await this.pool.query("DELETE FROM cron_state WHERE key = 'lock'")
  }

  async getCredentials(nodeId: string): Promise<NodeAuthConfig | null> {
    if (process.env.CANTON_NODES_AUTH) {
      try {
        const configs = JSON.parse(process.env.CANTON_NODES_AUTH) as Record<string, NodeAuthConfig>
        return configs[nodeId] ?? null
      } catch { /* fall through */ }
    }
    return null
  }
}
