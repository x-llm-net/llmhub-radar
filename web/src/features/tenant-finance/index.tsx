/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  BanknoteArrowDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ProviderBalanceTransferDialog } from '@/features/wallet/components/provider-balance-transfer-dialog'
import type { ProviderPayoutAccountFormValue } from '@/features/wallet/components/provider-payout-account-dialog'
import { ProviderPayoutAccounts } from '@/features/wallet/components/provider-payout-accounts'
import { ProviderWithdrawalDialog } from '@/features/wallet/components/provider-withdrawal-dialog'
import type {
  HubProviderEarning,
  HubProviderPayoutAccount,
  HubProviderWithdrawalStatus,
} from '@/features/wallet/types'
import { useHubAdminAccess } from '@/hooks/use-hub-admin-access'
import { formatQuota, formatTimestamp } from '@/lib/format'

import {
  createTenantPayoutAccount,
  createTenantWithdrawal,
  deleteTenantPayoutAccount,
  getTenantEarningSummary,
  getTenantEarnings,
  getTenantPayoutAccounts,
  getTenantPayoutAssetBlob,
  getTenantWithdrawals,
  tenantFinanceAccountsQueryKey,
  tenantFinanceEarningsQueryKey,
  tenantFinanceSummaryQueryKey,
  tenantFinanceWithdrawalsQueryKey,
  transferTenantEarningsToBalance,
  updateTenantPayoutAccount,
  uploadTenantPayoutQRCode,
} from './api'

const PAGE_SIZE = 20

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

export function TenantFinance() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const access = useHubAdminAccess()
  const canOperate = access.data?.can_operate_tenant_finance === true
  const [earningsPage, setEarningsPage] = useState(1)
  const [withdrawalsPage, setWithdrawalsPage] = useState(1)
  const [withdrawalOpen, setWithdrawalOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)

  const summary = useQuery({
    queryKey: tenantFinanceSummaryQueryKey,
    queryFn: getTenantEarningSummary,
  })
  const earnings = useQuery({
    queryKey: [...tenantFinanceEarningsQueryKey, earningsPage],
    queryFn: () => getTenantEarnings(earningsPage, PAGE_SIZE),
    placeholderData: (previous) => previous,
  })
  const withdrawals = useQuery({
    queryKey: [...tenantFinanceWithdrawalsQueryKey, withdrawalsPage],
    queryFn: () => getTenantWithdrawals(withdrawalsPage, PAGE_SIZE),
    placeholderData: (previous) => previous,
  })
  const accounts = useQuery({
    queryKey: tenantFinanceAccountsQueryKey,
    queryFn: getTenantPayoutAccounts,
    enabled: canOperate,
  })

  const refreshFinance = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tenantFinanceSummaryQueryKey }),
      queryClient.invalidateQueries({
        queryKey: tenantFinanceEarningsQueryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: tenantFinanceWithdrawalsQueryKey,
      }),
    ])
  }

  const transfer = useMutation({
    mutationFn: (payload: { amountQuota: number; idempotencyKey: string }) =>
      transferTenantEarningsToBalance({
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
      await refreshFinance()
      toast.success(t('Provider earnings transferred to balance'))
    },
    onError: () => toast.error(t('Failed to transfer provider earnings')),
  })

  const withdrawal = useMutation({
    mutationFn: (payload: { amountQuota: number; payoutAccountId: number }) =>
      createTenantWithdrawal({
        amount_quota: payload.amountQuota,
        payout_account_id: payload.payoutAccountId,
      }),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to submit withdrawal'))
        return
      }
      await refreshFinance()
      toast.success(t('Withdrawal request submitted'))
    },
    onError: () => toast.error(t('Failed to submit withdrawal')),
  })

  const saveAccount = useMutation({
    mutationFn: async (payload: {
      account: HubProviderPayoutAccount | null
      value: ProviderPayoutAccountFormValue
    }) => {
      let qrCodeAssetId = payload.value.qrCodeAssetId
      if (payload.value.qrCodeFile) {
        const upload = await uploadTenantPayoutQRCode(payload.value.qrCodeFile)
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
        ? updateTenantPayoutAccount(payload.account.id, input)
        : createTenantPayoutAccount(input)
    },
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to save payout account'))
        return
      }
      await queryClient.invalidateQueries({
        queryKey: tenantFinanceAccountsQueryKey,
      })
      toast.success(t('Payout account saved'))
    },
    onError: () => toast.error(t('Failed to save payout account')),
  })

  const deleteAccount = useMutation({
    mutationFn: (account: HubProviderPayoutAccount) =>
      deleteTenantPayoutAccount(account.id),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to delete payout account'))
        return
      }
      await queryClient.invalidateQueries({
        queryKey: tenantFinanceAccountsQueryKey,
      })
      toast.success(t('Payout account deleted'))
    },
    onError: () => toast.error(t('Failed to delete payout account')),
  })

  const summaryData = summary.data?.data
  const earningItems = earnings.data?.data?.items ?? []
  const withdrawalItems = withdrawals.data?.data?.items ?? []
  const accountItems = accounts.data?.data ?? []
  const availableQuota = summaryData?.withdrawable_quota ?? 0
  const renderEarningRows = () => {
    if (earnings.isLoading) {
      return (
        <TableRow>
          <TableCell colSpan={5} className='h-24 text-center'>
            <Loader2 className='mx-auto animate-spin' />
          </TableCell>
        </TableRow>
      )
    }
    if (earningItems.length === 0) {
      return (
        <TableRow>
          <TableCell
            colSpan={5}
            className='text-muted-foreground h-24 text-center'
          >
            {t('No earning records yet')}
          </TableCell>
        </TableRow>
      )
    }
    return earningItems.map((item: HubProviderEarning) => {
      const isTransfer = item.entry_type === 'balance_transfer'
      let status = t('Cancelled')
      if (item.status === 'settled') status = t('Settled')
      if (item.status === 'pending') status = t('Pending')
      return (
        <TableRow key={item.id}>
          <TableCell>{formatTimestamp(item.created_at)}</TableCell>
          <TableCell className='max-w-64 truncate font-medium'>
            {isTransfer ? t('Transfer to balance') : item.model_name || '-'}
          </TableCell>
          <TableCell>
            {isTransfer ? '-' : formatQuota(item.gross_quota)}
          </TableCell>
          <TableCell>{status}</TableCell>
          <TableCell className='text-right tabular-nums'>
            {formatQuota(item.reseller_net_income_quota)}
          </TableCell>
        </TableRow>
      )
    })
  }

  return (
    <div className='container mx-auto max-w-6xl space-y-6 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>{t('Tenant Finance')}</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          {t('View and settle the net earnings generated by this tenant.')}
        </p>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        {[
          [
            t('Settled tenant earnings'),
            summaryData?.settled_income_quota ?? 0,
          ],
          [
            t('Pending tenant earnings'),
            summaryData?.pending_income_quota ?? 0,
          ],
          [t('Withdrawable'), availableQuota],
          [
            t('Transferred to balance'),
            summaryData?.transferred_balance_quota ?? 0,
          ],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardHeader className='pb-2'>
              <CardTitle className='text-muted-foreground text-sm font-medium'>
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className='text-xl font-semibold tabular-nums'>
                {formatQuota(Number(value))}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {canOperate && (
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            onClick={() => setTransferOpen(true)}
            disabled={availableQuota <= 0}
          >
            <ArrowRightLeft />
            {t('Transfer to balance')}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => setWithdrawalOpen(true)}
            disabled={availableQuota <= 0}
          >
            <BanknoteArrowDown />
            {t('Request withdrawal')}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('Tenant earnings')}</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Time')}</TableHead>
                  <TableHead>{t('Source')}</TableHead>
                  <TableHead>{t('User charge')}</TableHead>
                  <TableHead>{t('Status')}</TableHead>
                  <TableHead className='text-right'>
                    {t('Net earnings')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{renderEarningRows()}</TableBody>
            </Table>
          </div>
          <Pager
            page={earningsPage}
            total={earnings.data?.data?.total ?? 0}
            onPageChange={setEarningsPage}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Tenant withdrawals')}</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Time')}</TableHead>
                  <TableHead>{t('Amount')}</TableHead>
                  <TableHead>{t('Payout method')}</TableHead>
                  <TableHead>{t('Status')}</TableHead>
                  <TableHead>{t('Review remark')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawals.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className='h-24 text-center'>
                      <Loader2 className='mx-auto animate-spin' />
                    </TableCell>
                  </TableRow>
                )}
                {!withdrawals.isLoading && withdrawalItems.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className='text-muted-foreground h-24 text-center'
                    >
                      {t('No withdrawal records yet')}
                    </TableCell>
                  </TableRow>
                )}
                {withdrawalItems.map((item) => {
                  const state = withdrawalStatus(item.status)
                  return (
                    <TableRow key={item.id}>
                      <TableCell>{formatTimestamp(item.created_at)}</TableCell>
                      <TableCell className='font-medium tabular-nums'>
                        {formatQuota(item.amount_quota)}
                      </TableCell>
                      <TableCell>{item.payout_method || '-'}</TableCell>
                      <TableCell>
                        <StatusBadge variant={state.variant}>
                          {t(state.label)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className='max-w-64 truncate'>
                        {item.admin_remark || '-'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <Pager
            page={withdrawalsPage}
            total={withdrawals.data?.data?.total ?? 0}
            onPageChange={setWithdrawalsPage}
          />
        </CardContent>
      </Card>

      {canOperate && (
        <ProviderPayoutAccounts
          accounts={accountItems}
          loading={accounts.isLoading}
          pending={saveAccount.isPending || deleteAccount.isPending}
          onSave={async (account, value) => {
            const response = await saveAccount.mutateAsync({ account, value })
            return response.success === true
          }}
          onDelete={async (account) => {
            const response = await deleteAccount.mutateAsync(account)
            return response.success === true
          }}
          getAssetBlob={getTenantPayoutAssetBlob}
        />
      )}

      <ProviderWithdrawalDialog
        open={withdrawalOpen}
        onOpenChange={setWithdrawalOpen}
        availableQuota={availableQuota}
        minimumWithdrawalQuota={summaryData?.minimum_withdrawal_quota ?? 0}
        accounts={accountItems}
        accountsLoading={accounts.isLoading}
        pending={withdrawal.isPending}
        onManageAccounts={() => {
          setWithdrawalOpen(false)
          document
            .querySelector('#provider-payout-accounts')
            ?.scrollIntoView({ behavior: 'smooth' })
        }}
        onConfirm={async (amountQuota, payoutAccountId) => {
          const response = await withdrawal.mutateAsync({
            amountQuota,
            payoutAccountId,
          })
          return response.success === true
        }}
      />
      <ProviderBalanceTransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        availableQuota={availableQuota}
        pending={transfer.isPending}
        onConfirm={async (amountQuota, idempotencyKey) => {
          const response = await transfer.mutateAsync({
            amountQuota,
            idempotencyKey,
          })
          return response.success === true
        }}
      />
    </div>
  )
}
