/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  Ban,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PayoutAccountDetails } from '@/features/wallet/components/payout-account'
import { formatPaidAmount } from '@/features/wallet/components/payout-account-utils'
import { formatQuota, formatTimestamp } from '@/lib/format'

import {
  adminWithdrawalsQueryKey,
  getAdminProviderWithdrawals,
  updateAdminProviderWithdrawalStatus,
} from './api'
import type {
  HubProviderWithdrawalAdminItem,
  HubProviderWithdrawalStatus,
} from './types'
import {
  WithdrawalReviewDialog,
  type WithdrawalReviewValue,
} from './withdrawal-review-dialog'

const PAGE_SIZE = 20

function getStatusMeta(status: HubProviderWithdrawalStatus): {
  label: string
  variant: StatusVariant
} {
  if (status === 'paid') return { label: 'Paid', variant: 'success' }
  if (status === 'approved') return { label: 'Approved', variant: 'info' }
  if (status === 'pending') return { label: 'Pending', variant: 'warning' }
  return { label: 'Rejected', variant: 'danger' }
}

export function ProviderWithdrawals() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [selected, setSelected] =
    useState<HubProviderWithdrawalAdminItem | null>(null)
  const [targetStatus, setTargetStatus] =
    useState<HubProviderWithdrawalStatus | null>(null)
  const params = {
    status: status === 'all' ? undefined : status,
    p: page,
    page_size: PAGE_SIZE,
  }
  const withdrawals = useQuery({
    queryKey: [...adminWithdrawalsQueryKey, params],
    queryFn: () => getAdminProviderWithdrawals(params),
    placeholderData: (previous) => previous,
  })
  const updateStatus = useMutation({
    mutationFn: (payload: {
      id: number
      status: HubProviderWithdrawalStatus
      value: WithdrawalReviewValue
    }) =>
      updateAdminProviderWithdrawalStatus(
        payload.id,
        payload.status,
        payload.value.remark,
        payload.status === 'paid'
          ? {
              payout_currency: payload.value.payoutCurrency,
              payout_amount_minor: payload.value.payoutAmountMinor,
              exchange_rate: payload.value.exchangeRate,
            }
          : undefined
      ),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to update withdrawal'))
        return
      }
      await queryClient.invalidateQueries({
        queryKey: adminWithdrawalsQueryKey,
      })
      toast.success(t('Withdrawal updated'))
    },
    onError: () => toast.error(t('Failed to update withdrawal')),
  })
  const items = withdrawals.data?.data?.items ?? []
  const total = withdrawals.data?.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const review = (
    item: HubProviderWithdrawalAdminItem,
    nextStatus: HubProviderWithdrawalStatus
  ) => {
    setSelected(item)
    setTargetStatus(nextStatus)
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h2 className='font-medium'>{t('Withdrawal requests')}</h2>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Review provider withdrawals and confirm payouts after transfer.'
            )}
          </p>
        </div>
        <NativeSelect
          value={status}
          onChange={(event) => {
            setStatus(event.target.value)
            setPage(1)
          }}
          aria-label={t('Status')}
        >
          <NativeSelectOption value='all'>{t('All Status')}</NativeSelectOption>
          <NativeSelectOption value='pending'>
            {t('Pending')}
          </NativeSelectOption>
          <NativeSelectOption value='approved'>
            {t('Approved')}
          </NativeSelectOption>
          <NativeSelectOption value='paid'>{t('Paid')}</NativeSelectOption>
          <NativeSelectOption value='rejected'>
            {t('Rejected')}
          </NativeSelectOption>
        </NativeSelect>
      </div>
      <div className='min-h-0 overflow-hidden rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Requested at')}</TableHead>
              <TableHead>{t('Channel Provider')}</TableHead>
              <TableHead>{t('Owner')}</TableHead>
              <TableHead>{t('Amount')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead>{t('Payout account')}</TableHead>
              <TableHead>{t('Paid amount')}</TableHead>
              <TableHead>{t('Administrator note')}</TableHead>
              <TableHead className='text-right'>{t('Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {withdrawals.isLoading && (
              <TableRow>
                <TableCell colSpan={9} className='h-32 text-center'>
                  <Loader2 className='mx-auto animate-spin' />
                </TableCell>
              </TableRow>
            )}
            {!withdrawals.isLoading && items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className='text-muted-foreground h-32 text-center'
                >
                  {t('No withdrawal requests found')}
                </TableCell>
              </TableRow>
            )}
            {!withdrawals.isLoading &&
              items.length > 0 &&
              items.map((item) => {
                const statusMeta = getStatusMeta(item.status)
                return (
                  <TableRow key={item.id}>
                    <TableCell>{formatTimestamp(item.created_at)}</TableCell>
                    <TableCell className='font-medium'>
                      {item.provider_name}
                    </TableCell>
                    <TableCell>
                      <div className='max-w-48'>
                        <p className='truncate'>@{item.owner_username}</p>
                        <p className='text-muted-foreground truncate text-xs'>
                          {item.owner_email}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className='font-medium'>
                      {formatQuota(item.amount_quota)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        label={t(statusMeta.label)}
                        variant={statusMeta.variant}
                        copyable={false}
                      />
                    </TableCell>
                    <TableCell className='min-w-48'>
                      {item.payout_account ? (
                        <PayoutAccountDetails
                          method={item.payout_account.method}
                          details={item.payout_account.details}
                          maskedSummary={item.payout_account.masked_summary}
                          compact
                        />
                      ) : (
                        item.applicant_note || '-'
                      )}
                    </TableCell>
                    <TableCell className='whitespace-nowrap'>
                      {formatPaidAmount(
                        item.payout_currency,
                        item.payout_amount_minor
                      )}
                    </TableCell>
                    <TableCell className='max-w-64 truncate'>
                      {item.admin_remark || '-'}
                    </TableCell>
                    <TableCell>
                      <div className='flex justify-end gap-1'>
                        {item.status === 'pending' && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant='ghost'
                                  size='icon-sm'
                                  onClick={() => review(item, 'paid')}
                                  aria-label={t('Confirm payout')}
                                />
                              }
                            >
                              <BadgeCheck />
                            </TooltipTrigger>
                            <TooltipContent>
                              {t('Confirm payout')}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {item.status === 'approved' && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant='ghost'
                                  size='icon-sm'
                                  onClick={() => review(item, 'paid')}
                                  aria-label={t('Confirm payout')}
                                />
                              }
                            >
                              <BadgeCheck />
                            </TooltipTrigger>
                            <TooltipContent>
                              {t('Confirm payout')}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {(item.status === 'pending' ||
                          item.status === 'approved') && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant='ghost'
                                  size='icon-sm'
                                  onClick={() => review(item, 'rejected')}
                                  aria-label={t('Reject withdrawal')}
                                />
                              }
                            >
                              <Ban />
                            </TooltipTrigger>
                            <TooltipContent>
                              {t('Reject withdrawal')}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
          </TableBody>
        </Table>
        {total > PAGE_SIZE && (
          <div className='flex items-center justify-end gap-2 border-t px-3 py-3'>
            <span className='text-muted-foreground mr-1 text-xs'>
              {t('Page {{page}} of {{total}}', { page, total: pageCount })}
            </span>
            <Button
              variant='outline'
              size='icon-sm'
              onClick={() => setPage((current) => current - 1)}
              disabled={page <= 1}
              aria-label={t('Previous page')}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant='outline'
              size='icon-sm'
              onClick={() => setPage((current) => current + 1)}
              disabled={page >= pageCount}
              aria-label={t('Next page')}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      <WithdrawalReviewDialog
        withdrawal={selected}
        targetStatus={targetStatus}
        open={Boolean(selected && targetStatus)}
        onOpenChange={(open) => {
          if (!open && !updateStatus.isPending) {
            setSelected(null)
            setTargetStatus(null)
          }
        }}
        pending={updateStatus.isPending}
        onConfirm={async (value) => {
          if (!selected || !targetStatus) return false
          const response = await updateStatus.mutateAsync({
            id: selected.id,
            status: targetStatus,
            value,
          })
          return response.success === true
        }}
      />
    </div>
  )
}
