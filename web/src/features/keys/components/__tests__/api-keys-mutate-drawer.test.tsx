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

import type { ApiKey } from '../../types'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLFormElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'KeyboardEvent',
  'PointerEvent',
  'MouseEvent',
  'FocusEvent',
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
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { api } = await import('@/lib/api')
const { ApiKeysProvider } = await import('../api-keys-provider')
const { ApiKeysMutateDrawer } = await import('../api-keys-mutate-drawer')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type ApiMethod = (url: string, data?: unknown) => Promise<{ data: unknown }>
type MockableApi = {
  get: ApiMethod
  post: ApiMethod
  put: ApiMethod
}
type RenderedDrawer = {
  host: HTMLDivElement
  queryClient: InstanceType<typeof QueryClient>
  root: ReturnType<typeof createRoot>
}

const apiClient = api as unknown as MockableApi
const originalGet = apiClient.get
const originalPost = apiClient.post
const originalPut = apiClient.put
let renderedDrawer: RenderedDrawer | null = null

const legacyApiKey: ApiKey = {
  id: 1,
  name: 'legacy-auto',
  key: 'legacy-key',
  status: 1,
  remain_quota: 0,
  used_quota: 0,
  unlimited_quota: true,
  expired_time: -1,
  created_time: 1,
  accessed_time: 1,
  group: 'auto',
  auto_groups: [],
  cross_group_retry: true,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
  hub_routing_policy: null,
}

const providerScopedApiKey: ApiKey = {
  ...legacyApiKey,
  id: 2,
  name: 'provider-scoped',
  group: 'default',
  hub_routing_policy: {
    mode: 'provider',
    provider_id: 7,
    selections: [
      {
        family: 'openai',
        exact_multipliers: [0.8],
      },
    ],
  },
}

function installApiFixtures(
  updatedPayloads: Array<Record<string, unknown>>,
  createdPayloads: Array<Record<string, unknown>> = []
) {
  apiClient.get = async (url) => {
    switch (url) {
      case '/api/status':
        return { data: { data: { default_use_auto_group: true } } }
      case '/api/user/models':
        return { data: { success: true, data: [] } }
      case '/api/user/self/groups':
        return {
          data: {
            success: true,
            data: {
              auto: { desc: 'Automatic routing', ratio: 'auto' },
              default: { desc: 'Standard access', ratio: 1 },
              vip: { desc: 'Priority access', ratio: 2 },
            },
          },
        }
      case '/api/token/auto-groups':
        return {
          data: {
            success: true,
            data: { groups: ['vip', 'default'], max_count: 3 },
          },
        }
      case '/api/token/1':
        return { data: { success: true, data: legacyApiKey } }
      case '/api/token/2':
        return { data: { success: true, data: providerScopedApiKey } }
      case '/api/token/routing-options?provider_id=7':
        return {
          data: {
            success: true,
            data: {
              mode: 'provider',
              provider_id: 7,
              families: [
                {
                  key: 'openai',
                  min_multiplier: 0.01,
                  max_multiplier: 1,
                  slider_max_multiplier: 1,
                  step: 0.001,
                  availability: [
                    {
                      multiplier: 0.8,
                      channel_count: 1,
                      provider_count: 1,
                      provider_ids: [7],
                    },
                  ],
                  exact_multipliers: [0.8],
                  available_channel_count: 1,
                  provider_count: 1,
                },
              ],
              tier_ceilings: {},
            },
          },
        }
      default:
        throw new Error(`Unexpected GET ${url}`)
    }
  }
  apiClient.put = async (url, data) => {
    assert.equal(url, '/api/token/')
    assert.ok(data && typeof data === 'object')
    updatedPayloads.push(data as Record<string, unknown>)
    return { data: { success: true, data: {} } }
  }
  apiClient.post = async (url, data) => {
    assert.equal(url, '/api/token/')
    assert.ok(data && typeof data === 'object')
    createdPayloads.push(data as Record<string, unknown>)
    return { data: { success: true, data: {} } }
  }
}

async function waitForCondition(
  condition: () => boolean,
  failureMessage: string
): Promise<void> {
  if (condition()) return

  await new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!condition()) return
      clearTimeout(timeoutId)
      observer.disconnect()
      resolve()
    })
    const timeoutId = setTimeout(() => {
      observer.disconnect()
      reject(new Error(`${failureMessage}: ${document.body.textContent}`))
    }, 5000)

    observer.observe(document, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })
  })
}

async function renderDrawer(
  currentRow?: ApiKey,
  routingOptionsData?: unknown
): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  })
  const freshAt = Date.now() + 60_000
  queryClient.setQueryData(
    ['status'],
    { default_use_auto_group: true },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['user-models'],
    { success: true, data: [] },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['user-groups'],
    {
      success: true,
      data: {
        auto: { desc: 'Automatic routing', ratio: 'auto' },
        default: { desc: 'Standard access', ratio: 1 },
        vip: { desc: 'Priority access', ratio: 2 },
      },
    },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['token-auto-groups'],
    {
      success: true,
      data: { groups: ['vip', 'default'], max_count: 3 },
    },
    { updatedAt: freshAt }
  )
  if (currentRow) {
    queryClient.setQueryData(
      ['api-key', currentRow.id],
      { success: true, data: currentRow },
      { updatedAt: freshAt }
    )
  }
  if (routingOptionsData !== undefined) {
    queryClient.setQueryData(
      ['hub-token-routing-options', window.location.hostname, undefined],
      routingOptionsData,
      { updatedAt: freshAt }
    )
  }
  renderedDrawer = { host, queryClient, root }

  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <ApiKeysProvider>
            <ApiKeysMutateDrawer
              open
              onOpenChange={() => undefined}
              currentRow={currentRow}
            />
          </ApiKeysProvider>
        </I18nextProvider>
      </QueryClientProvider>
    )
  )
  await act(async () =>
    waitForCondition(() => {
      const saveButton = findButton('Save changes', false)
      return saveButton !== null && !saveButton.disabled
    }, 'API key drawer did not finish initializing')
  )
}

function findButton(text: string, required: true): HTMLButtonElement
function findButton(text: string, required: false): HTMLButtonElement | null
function findButton(text: string, required = true): HTMLButtonElement | null {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((candidate) => candidate.textContent?.includes(text))
  if (required) assert.ok(button, `Expected button containing "${text}"`)
  return button ?? null
}

function getControlByLabel<T extends HTMLElement>(labelText: string): T {
  const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find(
    (candidate) => candidate.textContent?.trim() === labelText
  )
  assert.ok(label, `Expected label "${labelText}"`)
  assert.ok(label.htmlFor)
  const control =
    label.control ??
    label
      .closest('[data-slot="form-item"]')
      ?.querySelector<HTMLElement>(
        '[data-slot="form-control"], input, textarea, button[role="combobox"], [role="group"]'
      )
  assert.ok(control)
  return control as T
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      domWindow.HTMLInputElement.prototype,
      'value'
    )?.set
    assert.ok(valueSetter)
    valueSetter.call(input, value)
    input.dispatchEvent(
      new domWindow.Event('input', { bubbles: true }) as unknown as Event
    )
  })
}

async function selectComboboxOption(
  trigger: HTMLButtonElement,
  optionDescription: string
) {
  await act(async () => trigger.click())
  const option = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
  ].find((candidate) => candidate.textContent?.includes(optionDescription))
  assert.ok(option, `Expected option containing "${optionDescription}"`)
  await act(async () => option.click())
}

afterEach(async () => {
  apiClient.get = originalGet
  apiClient.post = originalPost
  apiClient.put = originalPut
  domWindow.localStorage.clear()
  if (renderedDrawer) {
    await act(async () => renderedDrawer?.root.unmount())
    renderedDrawer.queryClient.clear()
    renderedDrawer.host.remove()
    renderedDrawer = null
  }
  document.body.replaceChildren()
})

after(() => {
  domWindow.close()
})

describe('API keys mutate drawer legacy Auto group integration', () => {
  test('keeps a legacy key on the inherited root Auto order when editing', async () => {
    const updatedPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(updatedPayloads)
    await renderDrawer(legacyApiKey)

    const groupTrigger = getControlByLabel<HTMLButtonElement>('Group')
    assert.equal(groupTrigger.textContent?.includes('auto'), true)
    assert.equal(
      document.body.textContent?.includes(
        'Using the complete global Auto order (2 groups)'
      ),
      true
    )
    assert.deepEqual(
      [
        ...document.querySelectorAll('[data-slot="global-auto-order-name"]'),
      ].map((item) => item.textContent),
      ['vip', 'default']
    )
    assert.equal(findButton('Restore global Auto', true).disabled, true)

    await changeInput(getControlByLabel<HTMLInputElement>('Name'), 'edited')
    await act(async () => findButton('Save changes', true).click())
    await act(async () =>
      waitForCondition(
        () => updatedPayloads.length === 1,
        'legacy API key was not updated'
      )
    )

    assert.equal(updatedPayloads[0]?.name, 'edited')
    assert.equal(updatedPayloads[0]?.group, 'auto')
    assert.deepEqual(updatedPayloads[0]?.auto_groups, [])
    assert.equal(updatedPayloads[0]?.cross_group_retry, true)
    assert.equal(updatedPayloads[0]?.hub_routing_policy, undefined)
  })

  test('preserves an unsaved custom order and mode after Auto to ordinary to Auto changes', async () => {
    const updatedPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(updatedPayloads)
    await renderDrawer(legacyApiKey)

    const autoOrderControl = getControlByLabel<HTMLElement>('Auto group order')
    const addGroupTrigger = autoOrderControl.querySelector<HTMLButtonElement>(
      'button[role="combobox"]'
    )
    assert.ok(addGroupTrigger)
    await selectComboboxOption(addGroupTrigger, 'Priority access')

    assert.ok(document.querySelector('button[aria-label="Remove vip"]'))
    assert.equal(
      document.body.textContent?.includes('1 / 3 groups selected'),
      true
    )
    assert.equal(findButton('Restore global Auto', true).disabled, false)

    const groupTrigger = getControlByLabel<HTMLButtonElement>('Group')
    await selectComboboxOption(groupTrigger, 'Standard access')
    assert.equal(
      document.querySelector('button[aria-label="Remove vip"]'),
      null
    )
    await selectComboboxOption(groupTrigger, 'Automatic routing')

    assert.ok(document.querySelector('button[aria-label="Remove vip"]'))
    assert.equal(
      document.body.textContent?.includes('1 / 3 groups selected'),
      true
    )
    assert.equal(findButton('Restore global Auto', true).disabled, false)

    await changeInput(getControlByLabel<HTMLInputElement>('Name'), 'custom')
    await act(async () => findButton('Save changes', true).click())
    await act(async () =>
      waitForCondition(
        () => updatedPayloads.length === 1,
        'custom-order API key was not updated'
      )
    )
    assert.deepEqual(updatedPayloads[0]?.auto_groups, ['vip'])
  })

  test('blocks new key creation when routing options are unavailable', async () => {
    const updatedPayloads: Array<Record<string, unknown>> = []
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(updatedPayloads, createdPayloads)
    await renderDrawer(undefined, { success: false })

    assert.equal(document.body.textContent?.includes('Failed to load'), true)
    assert.equal(document.body.textContent?.includes('Retry'), true)
    assert.equal(document.body.textContent?.includes('Group'), false)

    await changeInput(getControlByLabel<HTMLInputElement>('Name'), 'blocked')
    await act(async () => findButton('Save changes', true).click())
    assert.equal(createdPayloads.length, 0)
  })

  test('keeps the original provider scope when editing a provider-scoped key', async () => {
    const updatedPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(updatedPayloads)
    await renderDrawer(providerScopedApiKey)

    assert.equal(
      document.body.textContent?.includes('Available provider routes'),
      true
    )

    await act(async () => findButton('Save changes', true).click())
    await act(async () =>
      waitForCondition(
        () => updatedPayloads.length === 1,
        'provider-scoped API key was not updated'
      )
    )
    const policy = updatedPayloads[0]?.hub_routing_policy as
      | Record<string, unknown>
      | undefined
    assert.equal(policy?.mode, 'provider')
    assert.equal(policy?.provider_id, 7)
  })
})
