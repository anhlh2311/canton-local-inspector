import express from 'express'
import https from 'node:https'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDatabase } from './db-init.js'
import { startCron, runInitialIndexing } from './cron.js'
import templatesRouter from './routes/templates.js'
import indexerRouter from './routes/indexer.js'
import proxyRouter from './routes/proxy.js'
import localProxyRouter from './routes/local-proxy.js'
import tokenRouter from './routes/token.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443
const CERT_DIR = process.env.CERT_DIR || path.resolve(__dirname, '..', '.certs')

/** Generate a self-signed certificate if none exists. Requires openssl. */
function ensureSelfSignedCert(): { key: string; cert: string } | null {
  const keyPath = path.join(CERT_DIR, 'key.pem')
  const certPath = path.join(CERT_DIR, 'cert.pem')

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath, 'utf-8'), cert: fs.readFileSync(certPath, 'utf-8') }
  }

  try {
    fs.mkdirSync(CERT_DIR, { recursive: true })
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath, '-out', certPath,
      '-days', '365', '-nodes',
      '-subj', '/CN=canton-inspector',
    ], { stdio: 'pipe' })
    console.log('[server] Generated self-signed certificate in', CERT_DIR)
    return { key: fs.readFileSync(keyPath, 'utf-8'), cert: fs.readFileSync(certPath, 'utf-8') }
  } catch (err) {
    console.warn('[server] Could not generate self-signed cert (openssl not available?):', (err as Error).message)
    return null
  }
}

async function main() {
  // Initialize PostgreSQL schema if DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    console.log('[server] Initializing PostgreSQL...')
    await initDatabase(process.env.DATABASE_URL)
  }

  const app = express()

  // Parse JSON bodies (needed for POST routes)
  app.use(express.json())

  // CORS headers for all API and proxy routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/proxy/')) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      if (req.method === 'OPTIONS') return res.status(204).end()
    }
    next()
  })

  // API routes
  app.use('/api/templates', templatesRouter)
  app.use('/api/cron/index-templates', indexerRouter)
  app.use('/api/proxy', proxyRouter)
  app.use('/api/auth/token', tokenRouter)

  // Vite-style local proxy paths (/proxy/json/*, /proxy/validator/*, /proxy/remote/*)
  // These are the paths the frontend uses when VITE_DEPLOY_ENV=local
  app.use(localProxyRouter)

  // Serve static files from Vite build output
  const distPath = path.resolve(__dirname, '..', 'dist')
  app.use(express.static(distPath))

  // SPA fallback: serve index.html with runtime env vars injected
  const indexHtml = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8')
  const runtimeEnv: Record<string, string> = {}
  if (process.env.VITE_NODES) runtimeEnv.VITE_NODES = process.env.VITE_NODES
  const injectedHtml = indexHtml.replace(
    '</head>',
    `<script>window.__RUNTIME_ENV__=${JSON.stringify(runtimeEnv)}</script></head>`,
  )
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      return next()
    }
    res.setHeader('Content-Type', 'text/html')
    res.send(injectedHtml)
  })

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Canton Inspector running at http://localhost:${PORT}`)
  })

  // Start HTTPS server with self-signed cert (needed for crypto.subtle on non-localhost)
  const tlsCert = ensureSelfSignedCert()
  if (tlsCert) {
    https.createServer(tlsCert, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`[server] Canton Inspector (HTTPS) running at https://localhost:${HTTPS_PORT}`)
    })
  }

  // Start cron scheduler
  startCron()

  // Run initial indexing after a short delay
  setTimeout(() => { runInitialIndexing() }, 5000)
}

main().catch((err) => {
  console.error('[server] Fatal error:', err)
  process.exit(1)
})
