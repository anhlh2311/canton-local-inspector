import axios, { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LighthouseTransactionResponse } from '@/types/lighthouse'
import {
  fetchTransactionByUpdateId,
  LIGHTHOUSE_HOSTS,
  lighthouseExplorerUrl,
  lighthouseProxyRequestPath,
} from './lighthouse'

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>()
  return {
    ...actual,
    default: {
      ...actual.default,
      get: vi.fn(),
    },
  }
})

const mockedGet = vi.mocked(axios.get)

function encodeOriginBase64url(origin: string): string {
  return btoa(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encodedOriginSegment(path: string): string {
  return path.slice(1, path.indexOf('/api/transactions/'))
}

function createAxiosError(status: number, data?: unknown): AxiosError {
  return new AxiosError(
    'Request failed',
    AxiosError.ERR_BAD_REQUEST,
    undefined,
    undefined,
    {
      status,
      statusText: 'Error',
      data,
      headers: {},
      config: {} as never,
    },
  )
}

function validResponse(): LighthouseTransactionResponse {
  return {
    events: {
      verdict: {
        update_id: '1220abc',
        record_time: '2026-01-01T00:00:00Z',
        submitting_parties: null,
        traffic_summary: {
          total_traffic_cost: 100,
          envelope_traffic_summaries: [{ view_ids: [1], traffic_cost: 100 }],
        },
        transaction_views: {
          views: [{ view_id: 1, informees: ['party'], sub_views: [], confirming_parties: null }],
        },
      },
    },
    transaction: {
      update_id: '1220abc',
      record_time: '2026-01-01T00:00:00Z',
      round: 1,
      traffic_cost: null,
    },
  }
}

describe('LIGHTHOUSE_HOSTS', () => {
  it('maps devnet and mainnet API origins', () => {
    expect(LIGHTHOUSE_HOSTS.devnet.apiOrigin).toBe('https://lighthouse.devnet.cantonloop.com')
    expect(LIGHTHOUSE_HOSTS.mainnet.apiOrigin).toBe('https://lighthouse.xyz')
  })
})

describe('lighthouseExplorerUrl', () => {
  it('uses the network explorer origin', () => {
    expect(lighthouseExplorerUrl('devnet', 'abc')).toBe(
      'https://lighthouse.devnet.cantonloop.com/transactions/abc',
    )
    expect(lighthouseExplorerUrl('mainnet', 'abc')).toBe(
      'https://lighthouse.xyz/transactions/abc',
    )
  })
})

describe('lighthouseProxyRequestPath', () => {
  it('encodes devnet origin as base64url then appends /api/transactions/{id}', () => {
    const path = lighthouseProxyRequestPath('devnet', '1220abc')
    expect(path.startsWith('/')).toBe(true)
    expect(path.endsWith('/api/transactions/1220abc')).toBe(true)
    expect(path).not.toContain('https://')
    expect(encodedOriginSegment(path)).toBe(
      encodeOriginBase64url(LIGHTHOUSE_HOSTS.devnet.apiOrigin),
    )
  })

  it('encodes mainnet origin as base64url then appends /api/transactions/{id}', () => {
    const path = lighthouseProxyRequestPath('mainnet', '1220abc')
    expect(path.startsWith('/')).toBe(true)
    expect(path.endsWith('/api/transactions/1220abc')).toBe(true)
    expect(path).not.toContain('https://')
    expect(encodedOriginSegment(path)).toBe(
      encodeOriginBase64url(LIGHTHOUSE_HOSTS.mainnet.apiOrigin),
    )
  })
})

describe('fetchTransactionByUpdateId', () => {
  beforeEach(() => {
    mockedGet.mockReset()
  })

  it('returns data when verdict has traffic_summary and transaction_views', async () => {
    const data = validResponse()
    mockedGet.mockResolvedValue({ data })

    const result = await fetchTransactionByUpdateId('1220abc', 'devnet')

    expect(result).toBe(data)
    const expectedPath = lighthouseProxyRequestPath('devnet', '1220abc')
    expect(mockedGet).toHaveBeenCalledWith(`/proxy/remote${expectedPath}`, { timeout: 30000 })
  })

  it('throws when traffic_summary is missing', async () => {
    const data = validResponse()
    data.events.verdict!.traffic_summary = null
    mockedGet.mockResolvedValue({ data })

    await expect(fetchTransactionByUpdateId('1220abc', 'devnet')).rejects.toThrow(
      'Response has no traffic summary',
    )
  })

  it('throws when envelope_traffic_summaries is missing', async () => {
    const data = validResponse()
    data.events.verdict!.traffic_summary!.envelope_traffic_summaries = undefined as never
    mockedGet.mockResolvedValue({ data })

    await expect(fetchTransactionByUpdateId('1220abc', 'devnet')).rejects.toThrow(
      'Response has no traffic summary',
    )
  })

  it('throws when total_traffic_cost is null', async () => {
    const data = validResponse()
    data.events.verdict!.traffic_summary!.total_traffic_cost = null as never
    mockedGet.mockResolvedValue({ data })

    await expect(fetchTransactionByUpdateId('1220abc', 'devnet')).rejects.toThrow(
      'Response has no traffic summary',
    )
  })

  it('throws when transaction_views.views is missing', async () => {
    const data = validResponse()
    data.events.verdict!.transaction_views = null
    mockedGet.mockResolvedValue({ data })

    await expect(fetchTransactionByUpdateId('1220abc', 'devnet')).rejects.toThrow(
      'Response has no traffic summary',
    )
  })

  it('throws when transaction_views.views is not an array', async () => {
    const data = validResponse()
    data.events.verdict!.transaction_views!.views = {} as never
    mockedGet.mockResolvedValue({ data })

    await expect(fetchTransactionByUpdateId('1220abc', 'devnet')).rejects.toThrow(
      'Response has no traffic summary',
    )
  })

  it('throws when transaction is missing', async () => {
    const data = validResponse()
    data.transaction = undefined as never
    mockedGet.mockResolvedValue({ data })

    await expect(fetchTransactionByUpdateId('1220abc', 'devnet')).rejects.toThrow(
      'Response has no traffic summary',
    )
  })

  it('maps HTTP 404 to transaction not found', async () => {
    mockedGet.mockRejectedValue(createAxiosError(404))

    await expect(fetchTransactionByUpdateId('1220abc', 'devnet')).rejects.toThrow(
      'Transaction not found on this network',
    )
  })

  it('maps HTTP 401 to sign-in prompt', async () => {
    mockedGet.mockRejectedValue(createAxiosError(401))

    await expect(fetchTransactionByUpdateId('1220abc', 'devnet')).rejects.toThrow(
      'Sign in to use the proxy',
    )
  })

  it('maps HTTP 502 with details to proxy failure message', async () => {
    mockedGet.mockRejectedValue(createAxiosError(502, { details: 'upstream timeout' }))

    await expect(fetchTransactionByUpdateId('1220abc', 'devnet')).rejects.toThrow(
      'Proxy request failed: upstream timeout',
    )
  })

  it('maps HTTP 502 without details to generic proxy failure', async () => {
    mockedGet.mockRejectedValue(createAxiosError(502))

    await expect(fetchTransactionByUpdateId('1220abc', 'devnet')).rejects.toThrow(
      'Proxy request failed',
    )
  })
})
