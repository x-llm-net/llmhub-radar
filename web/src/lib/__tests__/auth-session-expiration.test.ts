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
import { describe, test } from 'node:test'

import type { AuthBundle } from '@/stores/auth-store'

import {
  applyAuthBundle,
  beginExplicitSignOut,
  cancelExplicitSignOut,
  claimSessionExpirationHandling,
} from '../auth-session'

const bundle: AuthBundle = {
  access_token: 'access-token',
  token_type: 'Bearer',
  access_expires_at: 1_900_000_000,
  user: { id: 1, username: 'test-user', role: 1 },
  session: {
    sid: 'session-a',
    current: true,
    login_method: 'password',
    ip: '127.0.0.1',
    user_agent: 'test',
    created_at: 1,
    last_active_at: 1,
    expires_at: 1_900_000_000,
  },
}

describe('session expiration handling', () => {
  test('handles only the first unauthorized response for an active session', () => {
    applyAuthBundle(bundle, false)

    assert.equal(claimSessionExpirationHandling(), true)
    assert.equal(claimSessionExpirationHandling(), false)
  })

  test('suppresses expiration handling while an explicit sign-out is active', () => {
    applyAuthBundle(bundle, false)
    beginExplicitSignOut()

    assert.equal(claimSessionExpirationHandling(), false)

    cancelExplicitSignOut()
    assert.equal(claimSessionExpirationHandling(), true)
  })

  test('allows a newly authenticated session to handle a future expiration', () => {
    applyAuthBundle(bundle, false)
    assert.equal(claimSessionExpirationHandling(), true)

    applyAuthBundle(
      {
        ...bundle,
        access_token: 'next-access-token',
        session: { ...bundle.session, sid: 'session-b' },
      },
      false
    )

    assert.equal(claimSessionExpirationHandling(), true)
  })
})
