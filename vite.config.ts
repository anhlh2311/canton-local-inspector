import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import http from 'node:http'
import https from 'node:https'

// Default Canton quickstart port mappings for local proxy
const defaultLocalNodes = [
  { id: 'trading-partner', jsonApi: 1975, validatorApi: 1903 },
  { id: 'app-user', jsonApi: 2975, validatorApi: 2903 },
  { id: 'app-provider', jsonApi: 3975, validatorApi: 3903 },
  { id: 'super-validator', jsonApi: 4975, validatorApi: 4903 },
]

// Also try to parse VITE_NODES from env to add proxy entries for env-configured local nodes
function getEnvLocalNodes(): { id: string; jsonApi: number; validatorApi: number }[] {
  try {
    const raw = process.env.VITE_NODES
    if (!raw) return []
    const nodes = JSON.parse(raw) as Record<string, unknown>[]
    return nodes
      .filter((n) => {
        const url = (n.jsonApiUrl as string) || ''
        return url.includes('localhost') || url.includes('127.0.0.1')
      })
      .map((n) => ({
        id: (n.id as string) || 'env-node',
        jsonApi: Number(n.jsonApiPort) || 0,
        validatorApi: Number(n.validatorApiPort) || 0,
      }))
      .filter((n) => n.jsonApi > 0)
  } catch {
    return []
  }
}

const allLocalNodes = [...defaultLocalNodes, ...getEnvLocalNodes()]
// Deduplicate by id
const seenIds = new Set<string>()
const localNodes = allLocalNodes.filter((n) => {
  if (seenIds.has(n.id)) return false
  seenIds.add(n.id)
  return true
})

// Build proxy config for each local node
const proxy: Record<string, object> = {}
for (const node of localNodes) {
  proxy[`/proxy/json/${node.id}`] = {
    target: `http://localhost:${node.jsonApi}`,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(`/proxy/json/${node.id}`, ''),
  }
  if (node.validatorApi) {
    proxy[`/proxy/validator/${node.id}`] = {
      target: `http://localhost:${node.validatorApi}`,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(`/proxy/validator/${node.id}`, ''),
    }
  }
}

function base64urlDecode(str: string): string {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

/**
 * Custom Vite plugin for dynamic remote proxy.
 * Vite's built-in proxy only supports static targets — this handles
 * /proxy/remote/{base64url-origin}/... and /proxy/oauth2-token/{base64url-origin}/...
 * by forwarding requests to dynamically decoded target URLs.
 */
function dynamicProxyPlugin(): Plugin {
  return {
    name: 'dynamic-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next()

        // Match /proxy/remote/{encodedOrigin}/rest-of-path
        const remoteMatch = req.url.match(/^\/proxy\/remote\/([^/]+)(\/.*)$/)
        // Match /proxy/oauth2-token/{encodedOrigin}/rest-of-path
        const oauthMatch = req.url.match(/^\/proxy\/oauth2-token\/([^/]+)(\/.*)$/)

        const match = remoteMatch || oauthMatch
        if (!match) return next()

        let targetOrigin: string
        try {
          targetOrigin = base64urlDecode(match[1])
        } catch {
          res.statusCode = 400
          res.end('Invalid base64url-encoded origin')
          return
        }

        const targetPath = match[2]
        const targetUrl = new URL(targetPath, targetOrigin)
        const isHttps = targetUrl.protocol === 'https:'
        const transport = isHttps ? https : http

        // Collect request body
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          const body = Buffer.concat(chunks)

          const proxyReq = transport.request(
            {
              hostname: targetUrl.hostname,
              port: targetUrl.port || (isHttps ? 443 : 80),
              path: targetUrl.pathname + targetUrl.search,
              method: req.method,
              headers: {
                ...req.headers,
                host: targetUrl.host,
              },
            },
            (proxyRes) => {
              // Forward status and headers
              res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
              proxyRes.pipe(res)
            }
          )

          proxyReq.on('error', (err) => {
            console.error(`[dynamic-proxy] Error proxying to ${targetUrl.href}:`, err.message)
            if (!res.headersSent) {
              res.statusCode = 502
              res.end(`Proxy error: ${err.message}`)
            }
          })

          if (body.length > 0) {
            proxyReq.write(body)
          }
          proxyReq.end()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dynamicProxyPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy,
  },
})
