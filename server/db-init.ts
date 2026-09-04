import pg from 'pg'

export async function initDatabase(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS template_index (
        network TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cron_meta (
        id INTEGER PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cron_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at TIMESTAMPTZ
      );
    `)
    console.log('[db-init] PostgreSQL schema initialized')
  } finally {
    await client.end()
  }
}
