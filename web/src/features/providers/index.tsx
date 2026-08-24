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
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  getHubAdminTenants,
  tenantAdminQueryKey,
} from '@/features/tenant-admin/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { ProviderCreateDialog } from './provider-create-dialog'
import { ProviderWithdrawals } from './provider-withdrawals'
import { ProvidersTable } from './providers-table'
import { TenantWithdrawals } from './tenant-withdrawals'

export function Providers() {
  const { t } = useTranslation()
  const [createOpen, setCreateOpen] = useState(false)
  const user = useAuthStore((state) => state.auth.user)
  const isPlatformAdmin = (user?.role ?? 0) >= ROLE.SUPER_ADMIN
  const tenantsQuery = useQuery({
    queryKey: tenantAdminQueryKey,
    queryFn: getHubAdminTenants,
    enabled: isPlatformAdmin,
  })
  const tenants = tenantsQuery.data?.data?.items ?? []
  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Providers')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button type='button' onClick={() => setCreateOpen(true)}>
            <Plus />
            {t('Create provider')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <Tabs defaultValue='providers' className='min-h-0 flex-1 gap-3'>
            <TabsList>
              <TabsTrigger value='providers'>{t('Providers')}</TabsTrigger>
              <TabsTrigger value='withdrawals'>
                {t('Withdrawal requests')}
              </TabsTrigger>
              <TabsTrigger value='tenant-withdrawals'>
                {t('Tenant withdrawals')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value='providers' className='min-h-0'>
              <ProvidersTable />
            </TabsContent>
            <TabsContent value='withdrawals' className='min-h-0'>
              <ProviderWithdrawals />
            </TabsContent>
            <TabsContent value='tenant-withdrawals' className='min-h-0'>
              <TenantWithdrawals />
            </TabsContent>
          </Tabs>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <ProviderCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        isPlatformAdmin={isPlatformAdmin}
        tenants={tenants}
      />
    </>
  )
}
