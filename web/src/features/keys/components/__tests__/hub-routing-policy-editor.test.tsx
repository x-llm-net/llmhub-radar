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
  mode: 'public_pool',
  families: [
    {
      key: 'openai',
      min_multiplier: 0.001,
      max_multiplier: 100,
      slider_max_multiplier: 1,
      step: 0.001,
      available_channel_count: 2,
      provider_count: 3,
      availability: [
        {
          multiplier: 0.1,
          channel_count: 1,
          provider_count: 2,
          provider_ids: [1, 2],
        },
        {
          multiplier: 0.2,
          channel_count: 1,
          provider_count: 2,
          provider_ids: [2, 3],
        },
      ],
    },
  ],
  tier_ceilings: {
    openai: { special: 0.1, low: 0.2, medium: 0.5, high: 1 },
  },
}

describe('Hub routing policy editor', () => {
  after(() => {
    domWindow.close()
  })

  test('shows precise range inputs and deduplicates providers across multiplier buckets', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <HubRoutingPolicyEditor
            options={options}
            value={[
              {
                family: 'openai',
                min_multiplier: 0.1,
                max_multiplier: 0.2,
              },
            ]}
            onChange={() => undefined}
          />
        </I18nextProvider>
      )
    )

    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="number"]'
    )
    assert.equal(inputs.length, 2)
    assert.equal(inputs[0]?.step, '0.001')
    assert.equal(inputs[1]?.max, '100')
    assert.equal(inputs[0]?.value, '0.1')
    assert.equal(inputs[1]?.value, '0.2')
    assert.equal(
      container.textContent?.includes('2 channels / 3 providers'),
      true
    )
    assert.equal(container.textContent?.includes('Economy'), true)

    await act(async () => root.unmount())
    container.remove()
  })

  test('keeps premium multiplier ranges editable above the baseline', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <HubRoutingPolicyEditor
            options={options}
            value={[
              {
                family: 'openai',
                min_multiplier: 5,
                max_multiplier: 6,
              },
            ]}
            onChange={() => undefined}
          />
        </I18nextProvider>
      )
    )

    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="number"]'
    )
    assert.equal(inputs[0]?.value, '5')
    assert.equal(inputs[1]?.value, '6')
    assert.equal(inputs[1]?.max, '100')
    assert.equal(container.textContent?.includes('High quality'), true)

    await act(async () => root.unmount())
    container.remove()
  })

  test('offers tier-based range presets without changing the form shape', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let nextValue: Array<{
      family: string
      min_multiplier: number
      max_multiplier: number
    }> = []

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <HubRoutingPolicyEditor
            options={options}
            value={[
              {
                family: 'openai',
                min_multiplier: 0.1,
                max_multiplier: 0.2,
              },
            ]}
            onChange={(value) => {
              nextValue = value
            }}
          />
        </I18nextProvider>
      )
    )

    const standardPreset = container.querySelector<HTMLButtonElement>(
      '[data-multiplier-preset="standard"]'
    )
    assert.ok(standardPreset)
    await act(async () => standardPreset.click())

    assert.deepEqual(nextValue, [
      {
        family: 'openai',
        min_multiplier: 0.2,
        max_multiplier: 0.5,
      },
    ])

    const highPreset = container.querySelector<HTMLButtonElement>(
      '[data-multiplier-preset="high"]'
    )
    assert.ok(highPreset)
    await act(async () => highPreset.click())
    assert.deepEqual(nextValue, [
      {
        family: 'openai',
        min_multiplier: 0.5,
        max_multiplier: 1,
      },
    ])

    await act(async () => root.unmount())
    container.remove()
  })

  test('defaults newly added families to the configured standard tier', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let nextValue: Array<{
      family: string
      min_multiplier: number
      max_multiplier: number
    }> = []

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <HubRoutingPolicyEditor
            options={options}
            value={[]}
            onChange={(value) => {
              nextValue = value
            }}
          />
        </I18nextProvider>
      )
    )

    const addButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add model family')
    )
    assert.ok(addButton)
    await act(async () => addButton.click())

    assert.deepEqual(nextValue, [
      {
        family: 'openai',
        min_multiplier: 0.2,
        max_multiplier: 0.5,
        exact_multipliers: undefined,
      },
    ])

    await act(async () => root.unmount())
    container.remove()
  })

  test('initializes premium-only families with a valid range', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let nextValue: Array<{
      family: string
      min_multiplier: number
      max_multiplier: number
      exact_multipliers?: number[]
    }> = []
    const premiumOptions: HubTokenRoutingOptions = {
      ...options,
      families: [
        {
          ...options.families[0],
          min_multiplier: 5,
          max_multiplier: 6,
          slider_max_multiplier: 6,
        },
      ],
    }

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <HubRoutingPolicyEditor
            options={premiumOptions}
            value={[]}
            onChange={(value) => {
              nextValue = value
            }}
          />
        </I18nextProvider>
      )
    )

    const addButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add model family')
    )
    assert.ok(addButton)
    await act(async () => addButton.click())

    assert.equal(nextValue[0]?.min_multiplier, 5)
    assert.equal(nextValue[0]?.max_multiplier, 5)

    await act(async () => root.unmount())
    container.remove()
  })

  test('allows selecting multiple published provider multipliers', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let nextValue: Array<{
      family: string
      min_multiplier: number
      max_multiplier: number
      exact_multipliers?: number[]
    }> = []
    const baseFamily = options.families[0]
    assert.ok(baseFamily)
    const providerOptions: HubTokenRoutingOptions = {
      ...options,
      mode: 'provider',
      provider_id: 7,
      families: [
        {
          ...baseFamily,
          exact_multipliers: [0.2, 0.5],
          availability: [
            { multiplier: 0.2, channel_count: 1, provider_count: 1 },
            { multiplier: 0.5, channel_count: 1, provider_count: 1 },
          ],
        },
      ],
    }

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <HubRoutingPolicyEditor
            options={providerOptions}
            value={[
              {
                family: 'openai',
                min_multiplier: 0.2,
                max_multiplier: 0.2,
                exact_multipliers: [0.2],
              },
            ]}
            onChange={(value) => {
              nextValue = value
            }}
          />
        </I18nextProvider>
      )
    )

    const checkboxes =
      container.querySelectorAll<HTMLElement>('[role="checkbox"]')
    assert.equal(checkboxes.length, 2)
    await act(async () => checkboxes[1]?.click())

    assert.deepEqual(nextValue[0]?.exact_multipliers, [0.2, 0.5])

    await act(async () => root.unmount())
    container.remove()
  })
})
