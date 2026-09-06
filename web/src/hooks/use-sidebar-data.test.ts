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

import { isProviderSurfaceVisible } from '@/lib/provider-domain'

describe('provider navigation host scope', () => {
  test('shows provider navigation on the tenant root', () => {
    assert.equal(isProviderSurfaceVisible(null, '343246113.xyz'), true)
  })

  test('shows it on the current provider subdomain only', () => {
    assert.equal(
      isProviderSurfaceVisible('provider-a', 'provider-a.343246113.xyz'),
      true
    )
    assert.equal(
      isProviderSurfaceVisible('provider-a', 'provider-b.343246113.xyz'),
      false
    )
  })
})
