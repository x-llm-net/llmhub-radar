import { createFileRoute, redirect } from '@tanstack/react-router'

import { getHubAdminAccess } from '@/features/providers/api'
import { TenantAdmin } from '@/features/tenant-admin'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/tenant-admin/')({
  beforeLoad: async () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user) {
      throw redirect({ to: '/403' })
    }
    if (auth.user.role >= ROLE.SUPER_ADMIN) return

    // Tenant members use the tenant-scoped brand page. Keep the platform
    // tenant registry restricted to root users, but make a direct visit useful.
    try {
      const response = await getHubAdminAccess()
      if (response.success && response.data?.can_manage_brand) {
        throw redirect({ to: '/tenant-brand' })
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'to' in error) throw error
    }
    throw redirect({ to: '/403' })
  },
  component: TenantAdmin,
})
