import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { canViewProviderEarnings } from '../lib/provider-visibility.ts'

describe('provider earnings visibility', () => {
  test('shows earnings on the tenant root for an active provider', () => {
    assert.equal(
      canViewProviderEarnings(
        { slug: 'alpha', status: 'active' },
        '343246113.xyz'
      ),
      true
    )
  })

  test('keeps settled earnings available for a disabled provider on its own host', () => {
    assert.equal(
      canViewProviderEarnings(
        { slug: 'alpha', status: 'disabled' },
        'alpha.343246113.xyz'
      ),
      true
    )
  })

  test('hides earnings on another provider host', () => {
    assert.equal(
      canViewProviderEarnings(
        { slug: 'alpha', status: 'active' },
        'beta.343246113.xyz'
      ),
      false
    )
  })

  test('hides earnings for applications that cannot earn yet', () => {
    assert.equal(
      canViewProviderEarnings(
        { slug: 'alpha', status: 'pending' },
        '343246113.xyz'
      ),
      false
    )
  })
})
