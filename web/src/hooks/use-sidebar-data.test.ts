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

import { ROLE } from '@/lib/roles'

import { shouldShowProviderNavigation } from './use-sidebar-data'

describe('shouldShowProviderNavigation', () => {
  test('shows provider navigation for every authorized context', () => {
    const authorizedContexts = [
      {
        hasProvider: true,
        providerSlug: 'provider-a',
        tenantMemberRole: null,
        userRole: ROLE.USER,
      },
      {
        hasProvider: false,
        providerSlug: null,
        tenantMemberRole: null,
        userRole: ROLE.USER,
      },
      {
        hasProvider: false,
        providerSlug: 'provider-a',
        tenantMemberRole: 'owner',
        userRole: ROLE.USER,
      },
      {
        hasProvider: false,
        providerSlug: 'provider-a',
        tenantMemberRole: null,
        userRole: ROLE.SUPER_ADMIN,
      },
    ]

    for (const context of authorizedContexts) {
      assert.equal(shouldShowProviderNavigation(context), true)
    }
  })

  test('hides provider navigation from regular users on provider domains', () => {
    assert.equal(
      shouldShowProviderNavigation({
        hasProvider: false,
        providerSlug: 'provider-a',
        tenantMemberRole: 'member',
        userRole: ROLE.USER,
      }),
      false
    )
  })
})
