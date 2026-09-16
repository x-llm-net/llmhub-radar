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
import { after, afterEach, describe, test } from 'node:test'

import { Window } from 'happy-dom'
import type React from 'react'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
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
const { PublicHomeHeader } = await import('../public-home-header')
const { PublicHomeHero } = await import('../public-home-hero')
const { useAuthStore } = await import('@/stores/auth-store')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

let renderedRoot: ReturnType<typeof createRoot> | null = null
let renderedContainer: HTMLDivElement | null = null

async function render(node: React.ReactNode): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
  })
  renderedRoot = root
  renderedContainer = container
  return container
}

afterEach(async () => {
  if (renderedRoot) {
    await act(async () => renderedRoot?.unmount())
  }
  renderedContainer?.remove()
  renderedRoot = null
  renderedContainer = null
  useAuthStore.getState().auth.reset('complete')
})

after(() => domWindow.close())

describe('public home actions', () => {
  test('shows sign-in and sign-up entry for anonymous visitors', async () => {
    const container = await render(<PublicHomeHeader />)
    const link = container.querySelector<HTMLAnchorElement>('.hub-console-link')

    assert.equal(link?.getAttribute('href'), '/sign-in')
    assert.equal(link?.textContent?.replaceAll(/\s/g, ''), 'Signin/Signup')
  })

  test('shows the console entry for authenticated users', async () => {
    useAuthStore.getState().auth.setBundle({
      access_token: 'access-token',
      token_type: 'Bearer',
      access_expires_at: 2_000_000_000,
      user: { id: 1, username: 'admin', role: 10 },
      session: {
        sid: 'session-a',
        current: true,
        login_method: 'password',
        ip: '127.0.0.1',
        user_agent: 'test',
        created_at: 1,
        last_active_at: 1,
        expires_at: 2_000_000_000,
      },
    })

    const container = await render(<PublicHomeHeader />)
    const link = container.querySelector<HTMLAnchorElement>('.hub-console-link')

    assert.equal(link?.getAttribute('href'), '/dashboard/overview')
    assert.equal(link?.textContent?.replaceAll(/\s/g, ''), 'Openconsole')
  })

  test('links the hero action to API key creation', async () => {
    const container = await render(
      <PublicHomeHero
        home={{
          provider_count: 0,
          published_model_count: 0,
          last_probe_at: 0,
          generated_at: 0,
          families: [],
        }}
      />
    )
    const link = container.querySelector<HTMLAnchorElement>(
      '.hub-secondary-button'
    )

    assert.equal(link?.getAttribute('href'), '/keys')
    assert.equal(link?.textContent?.trim(), 'Create API key')
  })
})
