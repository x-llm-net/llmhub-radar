import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { getProviderRootDomain } from '../../../../lib/provider-domain.ts'
import { resolveServerAddress } from '../server-address.ts'

describe('resolveServerAddress', () => {
  test('uses the production root domain when no frontend override is configured', () => {
    assert.equal(getProviderRootDomain(), 'llm-hub.store')
  })

  test('uses the current origin when the default loopback address points to another port', () => {
    assert.equal(
      resolveServerAddress('http://localhost:3100', 'http://localhost:3000'),
      'http://localhost:3100'
    )
  })

  test('uses the current origin when a loopback default leaks into a public deployment', () => {
    assert.equal(
      resolveServerAddress('https://llm-hub.example', 'http://localhost:3000'),
      'https://llm-hub.example'
    )
  })

  test('keeps an explicitly configured public API address', () => {
    assert.equal(
      resolveServerAddress(
        'https://console.example',
        'https://api.example/base/'
      ),
      'https://api.example/base'
    )
  })

  test('keeps a production provider subdomain even when status points to the platform root', () => {
    assert.equal(
      resolveServerAddress(
        'https://llm-routers.llm-hub.store',
        'https://llm-hub.store'
      ),
      'https://llm-routers.llm-hub.store'
    )
  })

  test('keeps a local provider subdomain when the configured address points elsewhere', () => {
    assert.equal(
      resolveServerAddress(
        'http://llm-routers.localhost:3100',
        'http://localhost:3000'
      ),
      'http://llm-routers.localhost:3100'
    )
  })

  test('falls back to the current origin for an invalid configured address', () => {
    assert.equal(
      resolveServerAddress('http://127.0.0.1:3100', 'not a URL'),
      'http://127.0.0.1:3100'
    )
  })
})
