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
import { Check, CircleDollarSign, Power, PowerOff, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { adminProvidersQueryKey, updateAdminProviderStatus } from './api'
import { ProviderReviewDialog } from './provider-review-dialog'
import { ProviderSettlementSheet } from './provider-settlement-sheet'
import type { HubProviderAdminItem } from './types'

export function ProviderRowActions(props: { provider: HubProviderAdminItem }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [targetStatus, setTargetStatus] = useState<
    HubProviderAdminItem['status'] | null
  >(null)
  const [settlementOpen, setSettlementOpen] = useState(false)
  const showSettlement =
    props.provider.status === 'active' || props.provider.status === 'disabled'
  const mutation = useMutation({
    mutationFn: (reviewRemark: string) => {
      if (!targetStatus) throw new Error('Missing provider status')
      return updateAdminProviderStatus(
        props.provider.id,
        targetStatus,
        reviewRemark
      )
    },
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to update provider status'))
        return
      }
      await queryClient.invalidateQueries({ queryKey: adminProvidersQueryKey })
      const completedStatus = targetStatus
      setTargetStatus(null)
      if (completedStatus === 'rejected') {
        toast.success(t('Provider application rejected'))
      } else if (completedStatus === 'disabled') {
        toast.success(t('Provider disabled'))
      } else {
        toast.success(t('Provider approved'))
      }
    },
    onError: () => toast.error(t('Failed to update provider status')),
  })

  return (
    <>
      {showSettlement && (
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
      )}
      {(props.provider.status === 'pending' ||
        props.provider.status === 'rejected') && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                onClick={() => setTargetStatus('active')}
                aria-label={t('Approve provider')}
              />
            }
          >
            <Check />
          </TooltipTrigger>
          <TooltipContent>{t('Approve provider')}</TooltipContent>
        </Tooltip>
      )}
      {props.provider.status === 'pending' && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                onClick={() => setTargetStatus('rejected')}
                aria-label={t('Reject provider')}
              />
            }
          >
            <X />
          </TooltipTrigger>
          <TooltipContent>{t('Reject provider')}</TooltipContent>
        </Tooltip>
      )}
      {props.provider.status === 'active' && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                onClick={() => setTargetStatus('disabled')}
                aria-label={t('Disable provider')}
              />
            }
          >
            <PowerOff />
          </TooltipTrigger>
          <TooltipContent>{t('Disable provider')}</TooltipContent>
        </Tooltip>
      )}
      {props.provider.status === 'disabled' && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                onClick={() => setTargetStatus('active')}
                aria-label={t('Enable provider')}
              />
            }
          >
            <Power />
          </TooltipTrigger>
          <TooltipContent>{t('Enable provider')}</TooltipContent>
        </Tooltip>
      )}
      <ProviderReviewDialog
        provider={props.provider}
        targetStatus={targetStatus}
        open={targetStatus !== null}
        pending={mutation.isPending}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setTargetStatus(null)
        }}
        onConfirm={(reviewRemark) => mutation.mutate(reviewRemark)}
      />
      <ProviderSettlementSheet
        provider={props.provider}
        open={settlementOpen}
        onOpenChange={setSettlementOpen}
      />
    </>
  )
}
