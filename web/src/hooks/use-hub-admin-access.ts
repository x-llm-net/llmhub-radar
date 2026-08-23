import { useQuery } from '@tanstack/react-query'

import {
  getHubAdminAccess,
  hubAdminAccessQueryKey,
} from '@/features/providers/api'
import type { HubAdminAccess } from '@/features/providers/types'
import { useAuthStore } from '@/stores/auth-store'

export function useHubAdminAccess() {
  const isAuthenticated = useAuthStore((state) => Boolean(state.auth.user))

  return useQuery<HubAdminAccess | null>({
    queryKey: hubAdminAccessQueryKey,
    enabled: isAuthenticated,
    retry: false,
    staleTime: 60 * 1000,
    queryFn: async () => {
      try {
        const response = await getHubAdminAccess()
        return response.success ? (response.data ?? null) : null
      } catch {
        return null
      }
    },
  })
}
