/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  BanknoteArrowDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Loader2,
  ReceiptText,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatQuota, formatTimestamp } from '@/lib/format'

import {
  createProviderPayoutAccount,
  createProviderWithdrawal,
  deleteProviderPayoutAccount,
  getProviderEarnings,
  getProviderEarningSummary,
  getProviderPayoutAccounts,
  getProviderWithdrawals,
  providerEarningSummaryQueryKey,
  transferProviderEarningsToBalance,
  updateProviderPayoutAccount,
  uploadProviderPayoutQRCode,
} from '../api'
import type {
  HubProviderPayoutAccount,
  HubProviderEarningStatus,
  HubProviderWithdrawalStatus,
} from '../types'
import { PayoutAccountDetails } from './payout-account'
import { formatPaidAmount } from './payout-account-utils'
import { ProviderBalanceTransferDialog } from './provider-balance-transfer-dialog'
import type { ProviderPayoutAccountFormValue } from './provider-payout-account-dialog'
import { ProviderPayoutAccounts } from './provider-payout-accounts'
import { ProviderWithdrawalDialog } from './provider-withdrawal-dialog'

const PAGE_SIZE = 20
const earningsQueryKey = ['hub-provider', 'earnings'] as const
const withdrawalsQueryKey = ['hub-provider', 'withdrawals'] as const
const payoutAccountsQueryKey = ['hub-provider', 'payout-accounts'] as const

function earningStatus(status: HubProviderEarningStatus): {
  label: string
  variant: StatusVariant
} {
  if (status === 'settled') return { label: 'Settled', variant: 'success' }
  if (status === 'pending') return { label: 'Pending', variant: 'warning' }
  return { label: 'Cancelled', variant: 'neutral' }
}

function withdrawalStatus(status: HubProviderWithdrawalStatus): {
  label: string
  variant: StatusVariant
} {
  if (status === 'paid') return { label: 'Paid', variant: 'success' }
  if (status === 'approved') return { label: 'Approved', variant: 'info' }
  if (status === 'pending') return { label: 'Pending', variant: 'warning' }
  return { label: 'Rejected', variant: 'danger' }
}

function Pager(props: {
  page: number
  total: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation()
  const pageCount = Math.max(1, Math.ceil(props.total / PAGE_SIZE))
  if (props.total <= PAGE_SIZE) return null
  return (
    <div className='flex items-center justify-end gap-2 border-t px-3 py-3'>
      <span className='text-muted-foreground mr-1 text-xs'>
        {t('Page {{page}} of {{total}}', {
          page: props.page,
          total: pageCount,
        })}
      </span>
      <Button
        type='button'
        variant='outline'
        size='icon-sm'
        onClick={() => props.onPageChange(props.page - 1)}
        disabled={props.page <= 1}
        aria-label={t('Previous page')}
      >
        <ChevronLeft />
      </Button>
      <Button
        type='button'
        variant='outline'
        size='icon-sm'
        onClick={() => props.onPageChange(props.page + 1)}
        disabled={props.page >= pageCount}
        aria-label={t('Next page')}
      >
        <ChevronRight />
      </Button>
    </div>
  )
}

interface ProviderEarningsProps {
  onBalanceChanged?: () => Promise<void> | void
}

export function ProviderEarnings(props: ProviderEarningsProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [earningsPage, setEarningsPage] = useState(1)
  const [withdrawalsPage, setWithdrawalsPage] = useState(1)
  const [withdrawalOpen, setWithdrawalOpen] = useState(false)
  const [balanceTransferOpen, setBalanceTransferOpen] = useState(false)
  const summary = useQuery({
    queryKey: providerEarningSummaryQueryKey,
    queryFn: getProviderEarningSummary,
  })
  const earnings = useQuery({
    queryKey: [...earningsQueryKey, earningsPage],
    queryFn: () => getProviderEarnings(earningsPage, PAGE_SIZE),
    placeholderData: (previous) => previous,
  })
  const withdrawals = useQuery({
    queryKey: [...withdrawalsQueryKey, withdrawalsPage],
    queryFn: () => getProviderWithdrawals(withdrawalsPage, PAGE_SIZE),
    placeholderData: (previous) => previous,
  })
  const payoutAccounts = useQuery({
    queryKey: payoutAccountsQueryKey,
    queryFn: getProviderPayoutAccounts,
  })
  const createWithdrawal = useMutation({
    mutationFn: (payload: { amountQuota: number; payoutAccountId: number }) =>
      createProviderWithdrawal({
        amount_quota: payload.amountQuota,
        payout_account_id: payload.payoutAccountId,
      }),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to submit withdrawal'))
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: providerEarningSummaryQueryKey,
        }),
        queryClient.invalidateQueries({ queryKey: withdrawalsQueryKey }),
      ])
      toast.success(t('Withdrawal request submitted'))
    },
    onError: () => toast.error(t('Failed to submit withdrawal')),
  })
  const transferToBalance = useMutation({
    mutationFn: (payload: { amountQuota: number; idempotencyKey: string }) =>
      transferProviderEarningsToBalance({
        amount_quota: payload.amountQuota,
        idempotency_key: payload.idempotencyKey,
      }),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(
          response.message || t('Failed to transfer provider earnings')
        )
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: providerEarningSummaryQueryKey,
        }),
        queryClient.invalidateQueries({ queryKey: earningsQueryKey }),
        props.onBalanceChanged?.(),
      ])
      toast.success(t('Provider earnings transferred to balance'))
    },
    onError: () => toast.error(t('Failed to transfer provider earnings')),
  })
  const savePayoutAccount = useMutation({
    mutationFn: async (payload: {
      account: HubProviderPayoutAccount | null
      value: ProviderPayoutAccountFormValue
    }) => {
      let qrCodeAssetId = payload.value.qrCodeAssetId
      if (payload.value.qrCodeFile) {
        const upload = await uploadProviderPayoutQRCode(
          payload.value.qrCodeFile
        )
        if (!upload.success || !upload.data?.id) {
          return { success: false, message: upload.message }
        }
        qrCodeAssetId = upload.data.id
      }
      const input = {
        method: payload.value.method,
        details: payload.value.details,
        qr_code_asset_id: qrCodeAssetId,
        is_default: payload.value.isDefault,
      }
      return payload.account
        ? updateProviderPayoutAccount(payload.account.id, input)
        : createProviderPayoutAccount(input)
    },
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to save payout account'))
        return
      }
      await queryClient.invalidateQueries({ queryKey: payoutAccountsQueryKey })
      toast.success(t('Payout account saved'))
    },
    onError: () => toast.error(t('Failed to save payout account')),
  })
  const deletePayoutAccount = useMutation({
    mutationFn: (account: HubProviderPayoutAccount) =>
      deleteProviderPayoutAccount(account.id),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to delete payout account'))
        return
      }
      await queryClient.invalidateQueries({ queryKey: payoutAccountsQueryKey })
      toast.success(t('Payout account deleted'))
    },
    onError: () => toast.error(t('Failed to delete payout account')),
  })
  const summaryData = summary.data?.data
  const feePercent =
    (summaryData?.provider_service_fee_basis_points ?? 1000) / 100
  const minimumWithdrawalQuota = summaryData?.minimum_withdrawal_quota ?? 0
  const earningItems = earnings.data?.data?.items ?? []
  const withdrawalItems = withdrawals.data?.data?.items ?? []
  const payoutAccountItems = payoutAccounts.data?.data ?? []
  const renderEarningRows = () => {
    if (earnings.isLoading) {
      return (
        <TableRow>
          <TableCell colSpan={6} className='h-28 text-center'>
            <Loader2 className='mx-auto animate-spin' />
          </TableCell>
        </TableRow>
      )
    }
    if (earningItems.length === 0) {
      return (
        <TableRow>
          <TableCell
            colSpan={6}
            className='text-muted-foreground h-28 text-center'
          >
            {t('No earning records yet')}
          </TableCell>
        </TableRow>
      )
    }
    return earningItems.map((item) => {
      const status = earningStatus(item.status)
      const isBalanceTransfer = item.entry_type === 'balance_transfer'
      let sourceLabel = item.model_name || '-'
      if (item.entry_type === 'adjustment') {
        sourceLabel = t('Manual adjustment')
      } else if (isBalanceTransfer) {
        sourceLabel = t('Transfer to balance')
      } else if (item.earning_role === 'referral') {
        sourceLabel = t('Fallback referral commission')
      }
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
          <TableCell>{formatTimestamp(item.created_at)}</TableCell>
          <TableCell className='max-w-56 truncate font-medium'>
            {sourceLabel}
          </TableCell>
          <TableCell>
            {item.consumer_user_id > 0 ? `#${item.consumer_user_id}` : '-'}
          </TableCell>
          <TableCell>{chargedLabel}</TableCell>
          <TableCell
            className={
              item.provider_income_quota < 0
                ? 'text-destructive'
                : 'font-medium'
            }
          >
            <p>{formatQuota(item.provider_income_quota)}</p>
            {item.earning_role !== 'referral' &&
              item.referral_income_quota > 0 && (
                <p className='text-muted-foreground text-xs'>
                  {t('Referral commission deducted: {{amount}}', {
                    amount: formatQuota(item.referral_income_quota),
                  })}
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
    })
  }
  const renderWithdrawalRows = () => {
    if (withdrawals.isLoading) {
      return (
        <TableRow>
          <TableCell colSpan={6} className='h-28 text-center'>
            <Loader2 className='mx-auto animate-spin' />
          </TableCell>
        </TableRow>
      )
    }
    if (withdrawalItems.length === 0) {
      return (
        <TableRow>
          <TableCell
            colSpan={6}
            className='text-muted-foreground h-28 text-center'
          >
            {t('No withdrawal records yet')}
          </TableCell>
        </TableRow>
      )
    }
    return withdrawalItems.map((item) => {
      const status = withdrawalStatus(item.status)
      return (
        <TableRow key={item.id}>
          <TableCell>{formatTimestamp(item.created_at)}</TableCell>
          <TableCell className='font-medium'>
            {formatQuota(item.amount_quota)}
          </TableCell>
          <TableCell>
            <StatusBadge
              label={t(status.label)}
              variant={status.variant}
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
            {formatPaidAmount(item.payout_currency, item.payout_amount_minor)}
          </TableCell>
          <TableCell className='max-w-64 truncate'>
            {item.admin_remark || '-'}
          </TableCell>
        </TableRow>
      )
    })
  }
  const stats = [
    {
      label: t('Total provider earnings'),
      value: summaryData?.settled_income_quota ?? 0,
      icon: CircleDollarSign,
      detail:
        (summaryData?.referral_income_quota ?? 0) > 0
          ? t('Includes referral commissions: {{amount}}', {
              amount: formatQuota(summaryData?.referral_income_quota ?? 0),
            })
          : undefined,
    },
    {
      label: t('Available earnings'),
      value: summaryData?.withdrawable_quota ?? 0,
      icon: BanknoteArrowDown,
      description: t('Transfer to balance or request withdrawal'),
      detail:
        (summaryData?.reserved_withdrawal_quota ?? 0) > 0
          ? t('Withdrawal in progress: {{amount}}', {
              amount: formatQuota(summaryData?.reserved_withdrawal_quota ?? 0),
            })
          : undefined,
    },
    {
      label: t('Transferred to balance'),
      value: summaryData?.transferred_balance_quota ?? 0,
      icon: ArrowRightLeft,
    },
    {
      label: t('Total withdrawn'),
      value: summaryData?.paid_withdrawal_quota ?? 0,
      icon: ReceiptText,
    },
  ]

  return (
    <div className='space-y-5'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h2 className='text-base font-semibold'>{t('Provider earnings')}</h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(
              'Successful user charges are settled automatically. The current provider service fee is {{percent}}%.',
              { percent: feePercent }
            )}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={() => setBalanceTransferOpen(true)}
            disabled={
              summary.isLoading ||
              (summaryData?.withdrawable_quota ?? 0) <= 0 ||
              transferToBalance.isPending
            }
          >
            <ArrowRightLeft />
            {t('Transfer to balance')}
          </Button>
          <Button
            type='button'
            onClick={() => setWithdrawalOpen(true)}
            disabled={
              summary.isLoading ||
              (summaryData?.withdrawable_quota ?? 0) <= 0 ||
              createWithdrawal.isPending
            }
          >
            <BanknoteArrowDown />
            {t('Request withdrawal')}
          </Button>
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        {stats.map((stat) => (
          <Card key={stat.label} size='sm' className='rounded-lg'>
            <CardHeader className='grid grid-cols-[1fr_auto] items-center'>
              <CardTitle className='text-muted-foreground font-normal'>
                {stat.label}
              </CardTitle>
              <stat.icon className='text-muted-foreground size-4' />
            </CardHeader>
            <CardContent className='space-y-1'>
              {summary.isLoading ? (
                <Skeleton className='h-7 w-28' />
              ) : (
                <>
                  <p className='text-xl font-semibold tabular-nums'>
                    {formatQuota(stat.value)}
                  </p>
                  {stat.description && (
                    <p className='text-muted-foreground text-xs'>
                      {stat.description}
                    </p>
                  )}
                  {stat.detail && (
                    <p className='text-muted-foreground text-xs'>
                      {stat.detail}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <ProviderPayoutAccounts
        accounts={payoutAccountItems}
        loading={payoutAccounts.isLoading}
        pending={savePayoutAccount.isPending || deletePayoutAccount.isPending}
        onSave={async (account, value) => {
          const response = await savePayoutAccount.mutateAsync({
            account,
            value,
          })
          return response.success === true
        }}
        onDelete={async (account) => {
          const response = await deletePayoutAccount.mutateAsync(account)
          return response.success === true
        }}
      />

      <Tabs defaultValue='earnings' className='gap-3'>
        <TabsList>
          <TabsTrigger value='earnings'>{t('Earning details')}</TabsTrigger>
          <TabsTrigger value='withdrawals'>
            {t('Withdrawal history')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value='earnings'>
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
              <TableBody>{renderEarningRows()}</TableBody>
            </Table>
            <Pager
              page={earningsPage}
              total={earnings.data?.data?.total ?? 0}
              onPageChange={setEarningsPage}
            />
          </div>
        </TabsContent>
        <TabsContent value='withdrawals'>
          <div className='overflow-hidden rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Requested at')}</TableHead>
                  <TableHead>{t('Amount')}</TableHead>
                  <TableHead>{t('Status')}</TableHead>
                  <TableHead>{t('Payout account')}</TableHead>
                  <TableHead>{t('Paid amount')}</TableHead>
                  <TableHead>{t('Administrator note')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{renderWithdrawalRows()}</TableBody>
            </Table>
            <Pager
              page={withdrawalsPage}
              total={withdrawals.data?.data?.total ?? 0}
              onPageChange={setWithdrawalsPage}
            />
          </div>
        </TabsContent>
      </Tabs>

      <ProviderWithdrawalDialog
        open={withdrawalOpen}
        onOpenChange={setWithdrawalOpen}
        availableQuota={summaryData?.withdrawable_quota ?? 0}
        minimumWithdrawalQuota={minimumWithdrawalQuota}
        accounts={payoutAccountItems}
        accountsLoading={payoutAccounts.isLoading}
        pending={createWithdrawal.isPending}
        onManageAccounts={() => {
          setWithdrawalOpen(false)
          requestAnimationFrame(() =>
            document
              .querySelector('#provider-payout-accounts')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          )
        }}
        onConfirm={async (amountQuota, payoutAccountId) => {
          const response = await createWithdrawal.mutateAsync({
            amountQuota,
            payoutAccountId,
          })
          return response.success === true
        }}
      />
      <ProviderBalanceTransferDialog
        open={balanceTransferOpen}
        onOpenChange={setBalanceTransferOpen}
        availableQuota={summaryData?.withdrawable_quota ?? 0}
        pending={transferToBalance.isPending}
        onConfirm={async (amountQuota, idempotencyKey) => {
          const response = await transferToBalance.mutateAsync({
            amountQuota,
            idempotencyKey,
          })
          return response.success === true
        }}
      />
    </div>
  )
}
