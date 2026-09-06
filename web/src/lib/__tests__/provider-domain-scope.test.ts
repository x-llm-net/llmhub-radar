import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  isProviderSurfaceVisible,
  isTenantRootHostname,
} from '../provider-domain.ts'

describe('provider management host scope', () => {
  test('keeps the provider entry available on the tenant root', () => {
    assert.equal(isTenantRootHostname('343246113.xyz'), true)
    assert.equal(isProviderSurfaceVisible(null, '343246113.xyz'), true)
  })

  test('shows a provider only on its own provider subdomain', () => {
    assert.equal(isProviderSurfaceVisible('alpha', 'alpha.343246113.xyz'), true)
    assert.equal(isProviderSurfaceVisible('alpha', 'beta.343246113.xyz'), false)
  })

  test('hides the provider entry on another provider subdomain without a provider', () => {
    assert.equal(isProviderSurfaceVisible(null, 'beta.343246113.xyz'), false)
  })

  test('treats local root and provider hosts consistently', () => {
    assert.equal(isTenantRootHostname('localhost'), true)
    assert.equal(isProviderSurfaceVisible(null, 'localhost'), true)
    assert.equal(isProviderSurfaceVisible('alpha', 'alpha.localhost'), true)
    assert.equal(isProviderSurfaceVisible('alpha', 'beta.localhost'), false)
  })
})
