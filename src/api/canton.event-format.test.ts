import { describe, expect, it } from 'vitest'
import {
  buildAnyPartyTemplateFilter,
  buildInterfaceFilter,
  buildTemplateFilter,
  buildWildcardFilter,
} from './canton'

/**
 * Canton 3.6 rejects top-level filter/verbose on /v2/state/active-contracts.
 * These builders are what the UI and WebSocket "Load All" path send.
 */
describe('active-contracts request shape', () => {
  it('nests a party template filter under eventFormat', () => {
    const body = buildTemplateFilter('party::abc', '#pkg:Mod:Template', '42')

    expect(body).not.toHaveProperty('filter')
    expect(body).not.toHaveProperty('verbose')
    expect(body.activeAtOffset).toBe('42')
    expect(body.eventFormat).toEqual({
      filtersByParty: {
        'party::abc': {
          cumulative: [{
            identifierFilter: {
              TemplateFilter: {
                value: { templateId: '#pkg:Mod:Template', includeCreatedEventBlob: false },
              },
            },
          }],
        },
      },
      verbose: true,
    })
  })

  it('nests an interface filter under eventFormat', () => {
    const body = buildInterfaceFilter('party::abc', '#pkg:Mod:SomeInterface')

    expect(body).not.toHaveProperty('filter')
    expect(body).not.toHaveProperty('verbose')
    expect(body.eventFormat).toEqual({
      filtersByParty: {
        'party::abc': {
          cumulative: [{
            identifierFilter: {
              InterfaceFilter: {
                value: {
                  interfaceId: '#pkg:Mod:SomeInterface',
                  includeCreatedEventBlob: false,
                  includeInterfaceView: true,
                },
              },
            },
          }],
        },
      },
      verbose: true,
    })
  })

  it('nests filtersForAnyParty under eventFormat', () => {
    const body = buildAnyPartyTemplateFilter('#pkg:Mod:Template')

    expect(body).not.toHaveProperty('filter')
    expect(body.eventFormat.filtersForAnyParty).toEqual({
      cumulative: [{
        identifierFilter: {
          TemplateFilter: {
            value: { templateId: '#pkg:Mod:Template', includeCreatedEventBlob: false },
          },
        },
      }],
    })
    expect(body.eventFormat.verbose).toBe(true)
    expect(body.activeAtOffset).toBeUndefined()
  })

  it('nests a party wildcard under eventFormat', () => {
    const body = buildWildcardFilter('party::abc')

    expect(body.eventFormat.filtersByParty?.['party::abc'].cumulative[0].identifierFilter.WildcardFilter)
      .toEqual({ value: { includeCreatedEventBlob: false } })
    expect(body.eventFormat.verbose).toBe(true)
  })
})
