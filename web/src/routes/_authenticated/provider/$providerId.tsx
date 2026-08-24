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
import { createFileRoute, redirect } from '@tanstack/react-router'

import { getHubAdminAccess } from '@/features/providers/api'
import { ProviderDetail } from '@/features/providers/provider-detail'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/provider/$providerId')({
  beforeLoad: async () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user) {
      throw redirect({ to: '/403' })
    }
    if (auth.user.role >= ROLE.ADMIN) return
    try {
      const response = await getHubAdminAccess()
      if (!response.success || !response.data?.can_manage_providers) {
        throw new Error('provider management is unavailable')
      }
    } catch {
      throw redirect({ to: '/403' })
    }
  },
  component: ProviderDetailRoute,
})

function ProviderDetailRoute() {
  const { providerId } = Route.useParams()
  return <ProviderDetail providerId={Number(providerId)} />
}
