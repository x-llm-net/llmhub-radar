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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  getCurrentTenantBrand,
  tenantBrandQueryKey,
  updateCurrentTenantBrand,
} from './api'
import { TenantBrandEditor } from './brand-editor'
import type { TenantBrand } from './types'

export function TenantBrandSettings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const setTenantBrand = useSystemConfigStore((state) => state.setTenantBrand)
  const brandQuery = useQuery({
    queryKey: tenantBrandQueryKey,
    queryFn: getCurrentTenantBrand,
  })
  const updateMutation = useMutation({
    mutationFn: (input: { brand: TenantBrand; logoFile?: File }) =>
      updateCurrentTenantBrand(input.brand, input.logoFile),
    onSuccess: async (response) => {
      if (!response.success || !response.data) {
        toast.error(response.message || t('Request failed'))
        return
      }
      setTenantBrand(response.data.brand)
      await queryClient.invalidateQueries({ queryKey: tenantBrandQueryKey })
      toast.success(t('Brand saved'))
    },
    onError: (error) => toast.error(error.message || t('Request failed')),
  })

  const brand = brandQuery.data?.data?.brand
  let content = <Skeleton className='h-80 w-full rounded-lg' />
  if (brandQuery.isError) {
    content = (
      <Alert variant='destructive'>
        <AlertTitle>{t('Failed to load brand settings')}</AlertTitle>
        <AlertDescription>
          {t('Refresh the page and try again.')}
        </AlertDescription>
      </Alert>
    )
  } else if (brand) {
    content = (
      <TenantBrandEditor
        brand={brand}
        saving={updateMutation.isPending}
        onSave={(input, logoFile) =>
          updateMutation.mutate({ brand: input, logoFile })
        }
      />
    )
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Brand Settings')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <div className='mx-auto max-w-3xl pb-6'>{content}</div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
