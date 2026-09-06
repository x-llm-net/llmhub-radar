/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

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

import type { TenantAdminTenant } from '../types'

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
const { TenantPlatformFeeEditor } = await import('../platform-fee-editor')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Platform fee': 'Platform fee',
        'Taken from the reseller gross profit, not from the user charge. Changes only affect earnings created afterwards.':
          'Taken from the reseller gross profit, not from the user charge. Changes only affect earnings created afterwards.',
        'Follow global service fee': 'Follow global service fee',
        'Current global fee: {{percent}}%': 'Current global fee: {{percent}}%',
        'Individual platform service fee': 'Individual platform service fee',
        Save: 'Save',
      },
    },
  },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

function changeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    domWindow.HTMLInputElement.prototype,
    'value'
  )?.set
  assert.ok(valueSetter)
  valueSetter.call(input, value)
  input.dispatchEvent(
    new domWindow.Event('input', { bubbles: true }) as unknown as Event
  )
}

const tenant: TenantAdminTenant = {
  id: 1,
  name: 'Test tenant',
  slug: 'test-tenant',
  status: 'active',
  created_at: 0,
  updated_at: 0,
  brand: { name: '', logo_url: '' },
  domains: [],
  members: [],
  settlement: {
    platform_fee_basis_points: null,
    effective_platform_fee_basis_points: 3000,
    global_platform_fee_basis_points: 3000,
  },
}

describe('tenant platform fee editor', () => {
  after(() => {
    domWindow.close()
  })

  test('saves a tenant override and then restores the global default', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const saved: Array<number | null> = []

    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <TenantPlatformFeeEditor
            tenant={tenant}
            isBusy={false}
            onSave={(value) => saved.push(value)}
          />
        </I18nextProvider>
      )
    })

    const globalSwitch = container.querySelector<HTMLButtonElement>(
      '#tenant-global-fee-1'
    )
    assert.ok(globalSwitch)
    assert.equal(container.querySelector('#tenant-platform-fee-1'), null)

    await act(async () => globalSwitch.click())
    const feeInput = container.querySelector<HTMLInputElement>(
      '#tenant-platform-fee-1'
    )
    assert.ok(feeInput)
    await act(async () => changeInputValue(feeInput, '20'))

    const saveButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save'
    )
    assert.ok(saveButton)
    await act(async () => saveButton.click())
    assert.deepEqual(saved, [2000])

    await act(async () => globalSwitch.click())
    await act(async () => saveButton.click())
    assert.deepEqual(saved, [2000, null])

    await act(async () => root.unmount())
    container.remove()
  })
})
