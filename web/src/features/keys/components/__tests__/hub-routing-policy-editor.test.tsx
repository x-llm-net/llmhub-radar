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
import { after, afterEach, describe, test } from 'node:test'

import { Window } from 'happy-dom'

import { formatHubMultiplier } from '../../lib/multiplier'
import type { HubTokenRoutingOptions } from '../../types'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'PointerEvent',
  'MouseEvent',
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
const { HubRoutingPolicyEditor } = await import('../hub-routing-policy-editor')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const options: HubTokenRoutingOptions = {
  mode: 'channels',
  provider_id: 7,
  channels: [
    {
      channel_id: 30,
      name: 'Premium GPT',
      multiplier: 0.6,
      models: ['gpt-5'],
      available: true,
    },
    {
      channel_id: 10,
      name: 'Economy GPT',
      multiplier: 0.3,
      models: ['gpt-5', 'gpt-image-1'],
      available: true,
    },
    {
      channel_id: 20,
      name: 'Claude',
      multiplier: 0.4,
      models: ['claude-sonnet-4'],
      available: true,
    },
    {
      channel_id: 40,
      name: 'Unpublished',
      multiplier: 0.2,
      models: ['gpt-5'],
      available: false,
    },
  ],
}
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined
let changed: number[] | undefined

async function renderEditor(value: number[] = [], suppliedOptions = options) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root?.render(
      <I18nextProvider i18n={i18n}>
        <HubRoutingPolicyEditor
          options={suppliedOptions}
          value={value}
          onChange={(ids) => {
            changed = ids
          }}
        />
      </I18nextProvider>
    )
  )
}

function namedControl(name: string): HTMLElement {
  const result = [
    ...document.querySelectorAll<HTMLElement>('[aria-label]'),
  ].find((element) => element.getAttribute('aria-label') === name)
  assert.ok(result, name)
  return result
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  changed = undefined
})
after(() => domWindow.close())

describe('Hub channel routing editor', () => {
  test('formats live multipliers without insignificant trailing zeroes', () => {
    assert.equal(formatHubMultiplier(0.8), '0.8x')
    assert.equal(formatHubMultiplier(0.125), '0.125x')
    assert.equal(formatHubMultiplier(1), '1x')
  })

  test('sorts the catalog by multiplier and selects the whole channel', async () => {
    await renderEditor([20])
    const labels = [
      ...namedControl('Available channels').querySelectorAll(
        '[role="checkbox"]'
      ),
    ].map((node) => node.getAttribute('aria-label'))
    assert.deepEqual(labels, [
      'Select Unpublished',
      'Select Economy GPT',
      'Select Claude',
      'Select Premium GPT',
    ])
    assert.ok(
      namedControl('Available channels').textContent?.includes('gpt-image-1')
    )
    await act(async () => namedControl('Select Economy GPT').click())
    assert.deepEqual(changed, [20, 10])
  })

  test('preserves explicit order and moves a selected channel up', async () => {
    await renderEditor([30, 10, 20])
    assert.equal(
      (namedControl('Move Premium GPT up') as HTMLButtonElement).disabled,
      true
    )
    assert.equal(
      (namedControl('Move Claude down') as HTMLButtonElement).disabled,
      true
    )
    await act(async () => namedControl('Move Claude up').click())
    assert.deepEqual(changed, [30, 20, 10])
  })

  test('filters by exact model text without exposing model selection controls', async () => {
    await renderEditor()
    const input = namedControl('Search channels or models') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(
      domWindow.HTMLInputElement.prototype,
      'value'
    )?.set
    assert.ok(setter)
    await act(async () => {
      setter.call(input, 'GPT-IMAGE-1')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const choices =
      namedControl('Available channels').querySelectorAll('[role="checkbox"]')
    assert.equal(choices.length, 1)
    assert.equal(choices[0].getAttribute('aria-label'), 'Select Economy GPT')
  })

  test('keeps an unpublished selected channel removable and blocks selecting another unavailable channel', async () => {
    await renderEditor([40])
    assert.equal(
      namedControl('Select Unpublished').getAttribute('aria-checked'),
      'true'
    )
    await act(async () => namedControl('Remove Unpublished').click())
    assert.deepEqual(changed, [])
  })

  test('blocks unavailable new selections and the ninth selection', async () => {
    const channels = Array.from({ length: 9 }, (_, index) => ({
      ...options.channels[0],
      channel_id: index + 1,
      name: `Channel ${index + 1}`,
    }))
    await renderEditor([1, 2, 3, 4, 5, 6, 7, 8], { ...options, channels })
    assert.equal(
      namedControl('Select Channel 9').getAttribute('aria-disabled'),
      'true'
    )
    assert.notEqual(
      namedControl('Select Channel 1').getAttribute('aria-disabled'),
      'true'
    )
  })

  test('shows deleted selections and removes them without resetting the remaining order', async () => {
    await renderEditor([99, 10])
    assert.ok(document.body.textContent?.includes('Channel no longer exists'))
    await act(async () => namedControl('Remove Channel #99').click())
    assert.deepEqual(changed, [10])
  })

  test('shows an empty catalog state', async () => {
    await renderEditor([], { ...options, channels: [] })
    assert.equal(
      document.querySelector('[role="status"]')?.textContent,
      'No channels available'
    )
    assert.equal(document.querySelectorAll('[role="checkbox"]').length, 0)
  })
})
