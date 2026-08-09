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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleDollarSign, Power, PowerOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { adminProvidersQueryKey, updateAdminProviderStatus } from './api'
import { ProviderSettlementSheet } from './provider-settlement-sheet'
import type { HubProviderAdminItem } from './types'

export function ProviderRowActions(props: { provider: HubProviderAdminItem }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [settlementOpen, setSettlementOpen] = useState(false)
  const isActive = props.provider.status === 'active'
  const nextStatus = isActive ? 'disabled' : 'active'
  const mutation = useMutation({
    mutationFn: () => updateAdminProviderStatus(props.provider.id, nextStatus),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to update provider status'))
        return
      }
      await queryClient.invalidateQueries({ queryKey: adminProvidersQueryKey })
      setConfirmOpen(false)
      toast.success(t(isActive ? 'Provider disabled' : 'Provider enabled'))
    },
    onError: () => toast.error(t('Failed to update provider status')),
  })

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              onClick={() => setSettlementOpen(true)}
              aria-label={t('Provider earnings')}
            />
          }
        >
          <CircleDollarSign />
        </TooltipTrigger>
        <TooltipContent>{t('Provider earnings')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              onClick={() => setConfirmOpen(true)}
              aria-label={t(isActive ? 'Disable provider' : 'Enable provider')}
            />
          }
        >
          {isActive ? <PowerOff /> : <Power />}
        </TooltipTrigger>
        <TooltipContent>
          {t(isActive ? 'Disable provider' : 'Enable provider')}
        </TooltipContent>
      </Tooltip>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!mutation.isPending) setConfirmOpen(open)
        }}
        title={t(isActive ? 'Disable provider?' : 'Enable provider?')}
        desc={t(
          isActive
            ? 'All supply channels owned by {{name}} will leave the routing pool. Channel configuration and probe history will be preserved.'
            : 'Eligible listed models owned by {{name}} will return to the routing pool.',
          { name: props.provider.name }
        )}
        confirmText={t(isActive ? 'Disable' : 'Enable')}
        destructive={isActive}
        isLoading={mutation.isPending}
        handleConfirm={() => mutation.mutate()}
      />
      <ProviderSettlementSheet
        provider={props.provider}
        open={settlementOpen}
        onOpenChange={setSettlementOpen}
      />
    </>
  )
}
