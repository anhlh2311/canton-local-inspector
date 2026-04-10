import cron from 'node-cron'
import { runIndexing } from './routes/indexer.js'

const SCHEDULE = process.env.CRON_SCHEDULE || '*/10 * * * *'

export function startCron(): void {
  console.log(`[cron] Template indexing scheduled: ${SCHEDULE}`)

  cron.schedule(SCHEDULE, async () => {
    console.log(`[cron] Running template indexing at ${new Date().toISOString()}`)
    try {
      const result = await runIndexing()
      const meta = result as Record<string, unknown>
      console.log(`[cron] Indexing complete in ${meta.durationMs}ms`)
    } catch (err) {
      console.error('[cron] Indexing failed:', err instanceof Error ? err.message : err)
    }
  })
}

export async function runInitialIndexing(): Promise<void> {
  console.log('[cron] Running initial template indexing...')
  try {
    const result = await runIndexing()
    const meta = result as Record<string, unknown>
    console.log(`[cron] Initial indexing complete in ${meta.durationMs}ms`)
  } catch (err) {
    console.error('[cron] Initial indexing failed:', err instanceof Error ? err.message : err)
  }
}
