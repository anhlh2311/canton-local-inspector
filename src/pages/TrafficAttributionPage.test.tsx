// @vitest-environment jsdom

import { StrictMode, type ChangeEvent, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'jotai'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LighthouseTransactionResponse } from '@/types/lighthouse'
import { fetchTransactionByUpdateId } from '@/api/lighthouse'

vi.mock('@/api/lighthouse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/lighthouse')>()
  return {
    ...actual,
    fetchTransactionByUpdateId: vi.fn(),
  }
})

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string
      onValueChange: (value: string) => void
      children: ReactNode
    }) => React.createElement(
      'select',
      {
        'aria-label': 'Network',
        value,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => onValueChange(event.target.value),
      },
      children,
    ),
    SelectContent: ({ children }: { children: ReactNode }) => children,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
      React.createElement('option', { value }, children)
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => children,
    SelectValue: () => null,
  }
})

vi.mock('@/components/common/JsonViewer', () => ({
  JsonViewer: () => null,
}))

const rememberedParty = 'remembered-party::1220abc'
localStorage.setItem('canton-inspector-cip104-network', JSON.stringify('mainnet'))
localStorage.setItem('canton-inspector-cip104-carry-ticks', JSON.stringify(true))
localStorage.setItem(
  'canton-inspector-cip104-featured-parties',
  JSON.stringify([rememberedParty]),
)
const { TrafficAttributionPage } = await import('./TrafficAttributionPage')
localStorage.clear()

const mockedFetch = vi.mocked(fetchTransactionByUpdateId)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function validResponse(updateId: string, round: number): LighthouseTransactionResponse {
  return {
    events: {
      verdict: {
        update_id: updateId,
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
      update_id: updateId,
      record_time: '2026-01-01T00:00:00Z',
      round,
      traffic_cost: null,
    },
  }
}

describe('TrafficAttributionPage searches', () => {
  beforeEach(() => {
    localStorage.clear()
    mockedFetch.mockReset()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('hydrates stored CIP-104 preferences before bootstrapping an updateId search', async () => {
    localStorage.setItem('canton-inspector-cip104-network', JSON.stringify('mainnet'))
    localStorage.setItem('canton-inspector-cip104-carry-ticks', JSON.stringify(true))
    localStorage.setItem(
      'canton-inspector-cip104-featured-parties',
      JSON.stringify([rememberedParty]),
    )
    const response = validResponse('stored-preferences', 3)
    response.events.verdict!.transaction_views!.views[0].confirming_parties = [
      { parties: [rememberedParty], threshold: 1 },
    ]
    mockedFetch.mockResolvedValue(response)

    render(
      <Provider>
        <MemoryRouter initialEntries={['/?updateId=stored-preferences']}>
          <TrafficAttributionPage />
        </MemoryRouter>
      </Provider>,
    )

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('stored-preferences', 'mainnet'))
    expect((await screen.findByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('does not offer the DSO party as a featured app', async () => {
    const dso = 'DSO::1220dso'
    const app = 'kairo-executor::1220app'
    const response = validResponse('dso-tx', 4)
    response.events.verdict!.transaction_views!.views[0].confirming_parties = [
      { parties: [dso, app], threshold: 2 },
    ]
    mockedFetch.mockResolvedValue(response)

    render(
      <Provider>
        <MemoryRouter initialEntries={['/?updateId=dso-tx&network=devnet']}>
          <TrafficAttributionPage />
        </MemoryRouter>
      </Provider>,
    )

    expect(await screen.findByText('kairo-executor')).toBeTruthy()
    expect(screen.getByText('kairo-executor::1220app')).toBeTruthy()
    expect(screen.getByTitle('Copy to clipboard')).toBeTruthy()
    expect(screen.queryByText('DSO')).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })

  it('discards an older response and keeps searching for the latest request', async () => {
    const first = deferred<LighthouseTransactionResponse>()
    const second = deferred<LighthouseTransactionResponse>()
    mockedFetch
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    render(
      <StrictMode>
        <Provider>
          <MemoryRouter initialEntries={['/?updateId=first&network=devnet']}>
            <TrafficAttributionPage />
          </MemoryRouter>
        </Provider>
      </StrictMode>,
    )

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1))
    expect(mockedFetch).toHaveBeenNthCalledWith(1, 'first', 'devnet')

    fireEvent.change(screen.getByRole('combobox', { name: 'Network' }), {
      target: { value: 'mainnet' },
    })

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2))
    expect(mockedFetch).toHaveBeenNthCalledWith(2, 'first', 'mainnet')

    await act(async () => {
      first.resolve(validResponse('first', 1))
      await first.promise
    })
    expect(
      (screen.getByRole('button', { name: 'Searching...' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    await act(async () => {
      second.resolve(validResponse('first', 2))
      await second.promise
    })

    expect(await screen.findByText('round 2')).toBeTruthy()
    expect(screen.queryByText('round 1')).toBeNull()
  })
})
