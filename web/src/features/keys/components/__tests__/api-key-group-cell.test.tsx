/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'

import type { ApiKey } from '../../types'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const
for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { ApiKeyGroupCell } = await import('../api-key-group-cell')
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function CellHarness({ policy }: { policy?: ApiKey['hub_routing_policy'] }) {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <ApiKeyGroupCell
          group='default'
          crossGroupRetry={false}
          shouldReduceMotion
          policy={policy}
        />
      </TooltipProvider>
    </I18nextProvider>
  )
}

describe('API key channel table cell', () => {
  after(() => domWindow.close())

  test('shows the number of selected channels', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <CellHarness
          policy={{ mode: 'channels', provider_id: 9, channel_ids: [4, 2, 7] }}
        />
      )
    )
    assert.equal(container.textContent, '3 channels selected')
    await act(async () => root.unmount())
    container.remove()
  })

  test('marks missing, legacy, and empty policies as requiring channel selection', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const policies: ApiKey['hub_routing_policy'][] = [
      { mode: 'needs_reconfiguration' },
      { mode: 'channels', provider_id: 9, channel_ids: [] },
    ]
    for (const policy of policies) {
      await act(async () => root.render(<CellHarness policy={policy} />))
      assert.equal(container.textContent, 'Channel selection required')
    }
    await act(async () => root.unmount())
    container.remove()
  })

  test('keeps ordinary non-Hub keys on their existing group display', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<CellHarness />))
    assert.equal(container.textContent, 'default')
    await act(async () => root.unmount())
    container.remove()
  })
})
