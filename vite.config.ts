import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Canton node port mappings
const nodes = [
  { id: 'trading-partner', jsonApi: 1975, validatorApi: 1903 },
  { id: 'app-user', jsonApi: 2975, validatorApi: 2903 },
  { id: 'app-provider', jsonApi: 3975, validatorApi: 3903 },
  { id: 'super-validator', jsonApi: 4975, validatorApi: 4903 },
]

// Build proxy config for each node
const proxy: Record<string, object> = {}
for (const node of nodes) {
  proxy[`/proxy/json/${node.id}`] = {
    target: `http://localhost:${node.jsonApi}`,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(`/proxy/json/${node.id}`, ''),
  }
  proxy[`/proxy/validator/${node.id}`] = {
    target: `http://localhost:${node.validatorApi}`,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(`/proxy/validator/${node.id}`, ''),
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy,
  },
})
