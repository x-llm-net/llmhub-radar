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
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react'

import { useProvider } from '@/features/provider/hooks/use-provider'
import { useIsAdmin } from '@/hooks/use-admin'
import { useHubAdminAccess } from '@/hooks/use-hub-admin-access'

import type { ChannelAffinityInfo } from '../types'

export type LogsViewScope = 'all' | 'self'

interface UsageLogsContextValue {
  selectedUserId: number | null
  setSelectedUserId: (userId: number | null) => void
  userInfoDialogOpen: boolean
  setUserInfoDialogOpen: (open: boolean) => void
  affinityTarget: ChannelAffinityInfo | null
  setAffinityTarget: (target: ChannelAffinityInfo | null) => void
  affinityDialogOpen: boolean
  setAffinityDialogOpen: (open: boolean) => void
  sensitiveVisible: boolean
  setSensitiveVisible: (visible: boolean) => void
  viewScope: LogsViewScope
  setViewScope: (scope: LogsViewScope) => void
}

const UsageLogsContext = createContext<UsageLogsContextValue | undefined>(
  undefined
)

export function UsageLogsProvider({ children }: { children: ReactNode }) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [userInfoDialogOpen, setUserInfoDialogOpen] = useState(false)
  const [affinityTarget, setAffinityTarget] =
    useState<ChannelAffinityInfo | null>(null)
  const [affinityDialogOpen, setAffinityDialogOpen] = useState(false)
  const [sensitiveVisible, setSensitiveVisible] = useState(true)
  const [viewScope, setViewScope] = useState<LogsViewScope>('all')

  return (
    <UsageLogsContext.Provider
      value={{
        selectedUserId,
        setSelectedUserId,
        userInfoDialogOpen,
        setUserInfoDialogOpen,
        affinityTarget,
        setAffinityTarget,
        affinityDialogOpen,
        setAffinityDialogOpen,
        sensitiveVisible,
        setSensitiveVisible,
        viewScope,
        setViewScope,
      }}
    >
      {children}
    </UsageLogsContext.Provider>
  )
}

export function useUsageLogsContext() {
  const context = useContext(UsageLogsContext)
  if (!context) {
    throw new Error('useUsageLogsContext must be used within UsageLogsProvider')
  }
  return context
}

/**
 * Resolves the effective admin scope for usage logs: whether the current
 * user is allowed to view all users' logs (`canManageScope`), and whether
 * their current view preference (`viewScope`) has that scope active
 * (`isAdminView`). Data fetching and admin-only UI should key off
 * `isAdminView` rather than raw role, so an admin who switches to "only
 * mine" is treated exactly like a regular user for that view.
 */
export function useLogsViewScope() {
  const isPlatformAdmin = useIsAdmin()
  const hubAdminAccess = useHubAdminAccess()
  const providerQuery = useProvider()
  const { viewScope, setViewScope } = useUsageLogsContext()
  const canUseAdminScope =
    isPlatformAdmin || hubAdminAccess.data?.can_view_channels === true
  const canUseProviderScope = Boolean(providerQuery.provider)
  const canManageScope = canUseAdminScope || canUseProviderScope
  let dataScope: 'admin' | 'tenant' | 'provider' | 'self' = 'self'
  if (viewScope === 'all' && isPlatformAdmin) {
    dataScope = 'admin'
  } else if (
    viewScope === 'all' &&
    hubAdminAccess.data?.tenant_scoped === true
  ) {
    dataScope = 'tenant'
  } else if (viewScope === 'all' && canUseAdminScope) {
    dataScope = 'admin'
  } else if (viewScope === 'all' && canUseProviderScope) {
    dataScope = 'provider'
  }

  return {
    canManageScope,
    viewScope,
    setViewScope,
    dataScope,
    isAdminView: dataScope !== 'self',
    isScopeLoading:
      !isPlatformAdmin && (hubAdminAccess.isLoading || providerQuery.isLoading),
  }
}
