/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CirclePlus, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatQuota, formatTimestamp } from '@/lib/format'

import {
  adminProviderEarningsQueryKey,
  createAdminProviderEarningAdjustment,
  getAdminProviderEarnings,
  getAdminProviderEarningSummary,
} from './api'
import { ProviderAdjustmentDialog } from './provider-adjustment-dialog'
import type { HubProviderAdminItem } from './types'

function earningStatusMeta(status: 'pending' | 'settled' | 'cancelled') {
  if (status === 'settled') {
    return { label: 'Settled', variant: 'success' as const }
  }
  if (status === 'pending') {
    return { label: 'Pending', variant: 'warning' as const }
  }
  return { label: 'Cancelled', variant: 'neutral' as const }
}

interface ProviderSettlementSheetProps {
  provider: HubProviderAdminItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  allowAdjustment?: boolean
}

export function ProviderSettlementSheet(props: ProviderSettlementSheetProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const allowAdjustment = props.allowAdjustment ?? true
  const [adjustmentOpen, setAdjustmentOpen] = useState(false)
  const providerId = props.provider?.id ?? 0
  const queryKey = adminProviderEarningsQueryKey(providerId)
  const summary = useQuery({
    queryKey: [...queryKey, 'summary'],
    queryFn: () => getAdminProviderEarningSummary(providerId),
    enabled: props.open && providerId > 0,
  })
  const earnings = useQuery({
    queryKey: [...queryKey, 'list'],
    queryFn: () => getAdminProviderEarnings(providerId, 1, 100),
    enabled: props.open && providerId > 0,
  })
  const adjustment = useMutation({
    mutationFn: (payload: { amountQuota: number; remark: string }) =>
      createAdminProviderEarningAdjustment(
        providerId,
        payload.amountQuota,
        payload.remark
      ),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to adjust provider earnings'))
        return
      }
      await queryClient.invalidateQueries({ queryKey })
      toast.success(t('Provider earnings adjusted'))
    },
    onError: () => toast.error(t('Failed to adjust provider earnings')),
  })
  const data = summary.data?.data
  const earningItems = earnings.data?.data?.items ?? []
  const statItems = [
    [t('Total provider earnings'), data?.settled_income_quota ?? 0],
    [t('Pending settlement'), data?.reserved_withdrawal_quota ?? 0],
    [t('Available to withdraw'), data?.withdrawable_quota ?? 0],
    [t('Total withdrawn'), data?.paid_withdrawal_quota ?? 0],
  ] as const

  return (
    <>
      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetContent className='w-full sm:max-w-4xl'>
          <SheetHeader className='border-b pr-12'>
            <SheetTitle>{t('Provider earnings')}</SheetTitle>
            <SheetDescription>
              {props.provider?.name || '-'} / {t('Provider service fee')}{' '}
              {(data?.provider_service_fee_basis_points ??
                props.provider?.effective_provider_service_fee_basis_points ??
                1000) / 100}
              %
            </SheetDescription>
          </SheetHeader>
          <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4'>
            <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
              {statItems.map(([label, value]) => (
                <div key={label} className='rounded-lg border px-3 py-3'>
                  <p className='text-muted-foreground text-xs'>{label}</p>
                  <p className='mt-1.5 text-lg font-semibold tabular-nums'>
                    {summary.isLoading ? '-' : formatQuota(value)}
                  </p>
                </div>
              ))}
            </div>
            <div className='flex items-center justify-between'>
              <h3 className='font-medium'>{t('Earning details')}</h3>
              {allowAdjustment && (
                <Button size='sm' onClick={() => setAdjustmentOpen(true)}>
                  <CirclePlus />
                  {t('Manual adjustment')}
                </Button>
              )}
            </div>
            <div className='overflow-hidden rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Time')}</TableHead>
                    <TableHead>{t('Model')}</TableHead>
                    <TableHead>{t('Consumer')}</TableHead>
                    <TableHead>{t('Charged')}</TableHead>
                    <TableHead>{t('Provider income')}</TableHead>
                    <TableHead>{t('Status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {earnings.isLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className='h-28 text-center'>
                        <Loader2 className='mx-auto animate-spin' />
                      </TableCell>
                    </TableRow>
                  )}
                  {!earnings.isLoading && earningItems.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className='text-muted-foreground h-28 text-center'
                      >
                        {t('No earning records yet')}
                      </TableCell>
                    </TableRow>
                  )}
                  {!earnings.isLoading &&
                    earningItems.length > 0 &&
                    earningItems.map((item) => {
                      const status = earningStatusMeta(item.status)
                      let sourceLabel = item.model_name || '-'
                      if (item.entry_type === 'adjustment') {
                        sourceLabel = t('Manual adjustment')
                      } else if (item.entry_type === 'balance_transfer') {
                        sourceLabel = t('Transfer to balance')
                      } else if (item.earning_role === 'referral') {
                        sourceLabel = t('Fallback referral commission')
                      }
                      const isBalanceTransfer =
                        item.entry_type === 'balance_transfer'
                      const displayedIncomeQuota =
                        item.earning_role === 'referral'
                          ? item.referral_income_quota
                          : item.provider_income_quota
                      let chargedLabel = '-'
                      if (!isBalanceTransfer) {
                        chargedLabel = formatQuota(item.gross_quota)
                        if (item.earning_role === 'referral') {
                          chargedLabel = t('Commission basis: {{amount}}', {
                            amount: formatQuota(item.gross_quota),
                          })
                        }
                      }
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            {formatTimestamp(item.created_at)}
                          </TableCell>
                          <TableCell className='max-w-48 truncate'>
                            {sourceLabel}
                          </TableCell>
                          <TableCell>
                            {item.consumer_user_id
                              ? `#${item.consumer_user_id}`
                              : '-'}
                          </TableCell>
                          <TableCell>{chargedLabel}</TableCell>
                          <TableCell>
                            <p>{formatQuota(displayedIncomeQuota)}</p>
                            {item.earning_role !== 'referral' &&
                              item.referral_income_quota > 0 && (
                                <p className='text-muted-foreground text-xs'>
                                  {t(
                                    'Referral commission deducted: {{amount}}',
                                    {
                                      amount: formatQuota(
                                        item.referral_income_quota
                                      ),
                                    }
                                  )}
                                </p>
                              )}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              label={t(status.label)}
                              variant={status.variant}
                              copyable={false}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                </TableBody>
              </Table>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <ProviderAdjustmentDialog
        open={adjustmentOpen}
        onOpenChange={setAdjustmentOpen}
        providerName={props.provider?.name || '-'}
        pending={adjustment.isPending}
        onConfirm={async (amountQuota, remark) => {
          const response = await adjustment.mutateAsync({
            amountQuota,
            remark,
          })
          return response.success === true
        }}
      />
    </>
  )
}
