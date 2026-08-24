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

import { api } from '@/lib/api'

import type { TenantBrand, TenantBrandResponse } from './types'

export const tenantBrandQueryKey = ['hub-admin', 'brand'] as const

export async function getCurrentTenantBrand(): Promise<TenantBrandResponse> {
  const response = await api.get('/api/hub/admin/brand')
  return response.data
}

export async function updateCurrentTenantBrand(
  brand: TenantBrand
): Promise<TenantBrandResponse> {
  const response = await api.put('/api/hub/admin/brand', brand)
  return response.data
}
