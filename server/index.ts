import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDatabase } from './db-init.js'
import { startCron, runInitialIndexing } from './cron.js'
import templatesRouter from './routes/templates.js'
import indexerRouter from './routes/indexer.js'
import proxyRouter from './routes/proxy.js'
import tokenRouter from './routes/token.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000

async function main() {
  // Initialize PostgreSQL schema if DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    console.log('[server] Initializing PostgreSQL...')
    await initDatabase(process.env.DATABASE_URL)
  }

  const app = express()

  // Parse JSON bodies (needed for POST routes)
  app.use(express.json())

  // CORS headers for all API routes
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  })

  // API routes
  app.use('/api/templates', templatesRouter)
  app.use('/api/cron/index-templates', indexerRouter)
  app.use('/api/proxy', proxyRouter)
  app.use('/api/auth/token', tokenRouter)

  // Serve static files from Vite build output
  const distPath = path.resolve(__dirname, '..', 'dist')
  app.use(express.static(distPath))

  // SPA fallback: serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API route not found' })
    }
    res.sendFile(path.join(distPath, 'index.html'))
  })

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Canton Inspector running at http://localhost:${PORT}`)
  })

  // Start cron scheduler
  startCron()

  // Run initial indexing after a short delay
  setTimeout(() => { runInitialIndexing() }, 5000)
}

main().catch((err) => {
  console.error('[server] Fatal error:', err)
  process.exit(1)
})
