import axios, { isAxiosError } from 'axios'
import type { LighthouseTransactionResponse } from '@/types/lighthouse'

export type LighthouseNetwork = 'devnet' | 'mainnet'

export const LIGHTHOUSE_HOSTS: Record<LighthouseNetwork, { apiOrigin: string; explorerOrigin: string }> = {
  devnet: {
    apiOrigin: 'https://lighthouse.devnet.cantonloop.com',
    explorerOrigin: 'https://lighthouse.devnet.cantonloop.com',
  },
  mainnet: {
    apiOrigin: 'https://lighthouse.xyz',
    explorerOrigin: 'https://lighthouse.xyz',
  },
}

const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'

function encodeOriginBase64url(origin: string): string {
  return btoa(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function lighthouseExplorerUrl(network: LighthouseNetwork, updateId: string): string {
  return `${LIGHTHOUSE_HOSTS[network].explorerOrigin}/transactions/${updateId}`
}

export function lighthouseProxyRequestPath(network: LighthouseNetwork, updateId: string): string {
  const encoded = encodeOriginBase64url(LIGHTHOUSE_HOSTS[network].apiOrigin)
  return `/${encoded}/api/transactions/${encodeURIComponent(updateId)}`
}

function lighthouseProxyUrl(network: LighthouseNetwork, updateId: string): string {
  const rest = lighthouseProxyRequestPath(network, updateId)
  if (isVercel) return `/api/proxy${rest}`
  return `/proxy/remote${rest}`
}

export async function fetchTransactionByUpdateId(
  updateId: string,
  network: LighthouseNetwork,
): Promise<LighthouseTransactionResponse> {
  try {
    const res = await axios.get<LighthouseTransactionResponse>(
      lighthouseProxyUrl(network, updateId),
      { timeout: 30000 },
    )
    const data = res.data
    const verdict = data.events?.verdict
    if (!verdict?.traffic_summary || !verdict.transaction_views?.views) {
      throw new Error('Response has no traffic summary')
    }
    return data
  } catch (err) {
    if (err instanceof Error && err.message === 'Response has no traffic summary') throw err
    if (isAxiosError(err) && err.response?.status === 404) {
      throw new Error('Transaction not found on this network')
    }
    if (isAxiosError(err) && err.response?.status === 401) {
      throw new Error('Sign in to use the proxy')
    }
    if (isAxiosError(err) && err.response?.status === 502) {
      const details = (err.response.data as { details?: string } | undefined)?.details
      throw new Error(details ? `Proxy request failed: ${details}` : 'Proxy request failed')
    }
    throw err instanceof Error ? err : new Error('Failed to fetch transaction')
  }
}
