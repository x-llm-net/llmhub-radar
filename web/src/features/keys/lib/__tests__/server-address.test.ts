import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  getProviderPublicURL,
  getProviderRootDomain,
  getProviderSlugFromHostname,
  getTenantRootDomainFromHostname,
  isHubFirstPartyOrigin,
} from '../../../../lib/provider-domain.ts'
import { resolveServerAddress } from '../server-address.ts'

describe('resolveServerAddress', () => {
  test('uses the production root domain when no frontend override is configured', () => {
    assert.equal(getProviderRootDomain(), 'llm-hub.store')
  })

  test('recognizes a provider below a custom tenant domain', () => {
    assert.equal(getProviderSlugFromHostname('x.343246113.xyz'), 'x')
    assert.equal(getProviderSlugFromHostname('343246113.xyz'), null)
    assert.equal(
      getTenantRootDomainFromHostname('x.343246113.xyz'),
      '343246113.xyz'
    )
  })

  test('rejects nested provider domains beyond the supported shape', () => {
    assert.equal(getProviderSlugFromHostname('x.sub.example.com'), null)
    assert.equal(getTenantRootDomainFromHostname('x.sub.example.com'), null)
    assert.equal(getProviderSlugFromHostname('x..example.com'), null)
    assert.equal(getTenantRootDomainFromHostname('x..example.com'), null)
    assert.equal(getProviderSlugFromHostname('edge.llm-hub.store'), null)
    assert.equal(getTenantRootDomainFromHostname('example.com..'), null)
    assert.equal(getTenantRootDomainFromHostname('127.0'), null)
  })

  test('uses the server-provided tenant URL for provider links', () => {
    assert.equal(
      getProviderPublicURL('x', 'https://x.343246113.xyz/'),
      'https://x.343246113.xyz/'
    )
  })

  test('trusts provider origins only within the same custom tenant root', () => {
    assert.equal(
      isHubFirstPartyOrigin('https://x.343246113.xyz', 'https://343246113.xyz'),
      true
    )
    assert.equal(
      isHubFirstPartyOrigin('https://x.llm-hub.store', 'https://343246113.xyz'),
      false
    )
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
