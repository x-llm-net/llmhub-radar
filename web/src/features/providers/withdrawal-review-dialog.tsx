/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  PayoutAccountDetails,
  PayoutQRCodeImage,
} from '@/features/wallet/components/payout-account'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatQuota } from '@/lib/format'

import type {
  HubProviderWithdrawalAdminItem,
  HubProviderWithdrawalStatus,
} from './types'

interface WithdrawalReviewDialogProps {
  withdrawal: HubProviderWithdrawalAdminItem | null
  targetStatus: HubProviderWithdrawalStatus | null
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onConfirm: (value: WithdrawalReviewValue) => Promise<boolean>
}

export interface WithdrawalReviewValue {
  remark: string
  payoutCurrency: string
  payoutAmountMinor: number
  exchangeRate: string
}

function getActionLabel(
  status: HubProviderWithdrawalStatus | null,
  t: (key: string) => string
) {
  if (status === 'approved') return t('Approve withdrawal')
  if (status === 'paid') return t('Confirm payout')
  return t('Reject withdrawal')
}

function getRemarkLabel(
  status: HubProviderWithdrawalStatus | null,
  t: (key: string) => string
) {
  return status === 'paid' ? t('Payment reference') : t('Administrator note')
}

function getRemarkPlaceholder(
  status: HubProviderWithdrawalStatus | null,
  t: (key: string) => string
) {
  if (status === 'paid') return t('Enter the transfer reference or payout note')
  if (status === 'rejected') return t('Enter the rejection reason')
  return t('Optional review note')
}

export function WithdrawalReviewDialog(props: WithdrawalReviewDialogProps) {
  const { t } = useTranslation()
  const [remark, setRemark] = useState('')
  const [payoutAmount, setPayoutAmount] = useState('')
  const payoutQRCodeAssetId =
    props.withdrawal?.payout_account?.qr_code_asset_id ?? 0
  const showPaymentQRCode =
    props.targetStatus === 'paid' && payoutQRCodeAssetId > 0
  const requiresRemark =
    props.targetStatus === 'paid' || props.targetStatus === 'rejected'
  const { config: currencyConfig } = getCurrencyDisplay()
  const requestedAmountUsd =
    (props.withdrawal?.amount_quota ?? 0) / currencyConfig.quotaPerUnit
  const payoutAmountNumber = Number(payoutAmount)
  const payoutAmountMinor = Math.round(payoutAmountNumber * 100)
  const exchangeRate =
    requestedAmountUsd > 0 && payoutAmountNumber > 0
      ? (payoutAmountNumber / requestedAmountUsd)
          .toFixed(8)
          .replace(/\.?0+$/, '')
      : ''
  const paymentIsValid =
    props.targetStatus !== 'paid' ||
    (payoutAmountNumber > 0 &&
      payoutAmountMinor > 0 &&
      Number(exchangeRate) > 0)
  const canSubmit =
    Boolean(props.withdrawal && props.targetStatus) &&
    (!requiresRemark || remark.trim().length > 0) &&
    paymentIsValid &&
    !props.pending

  useEffect(() => {
    if (!props.open) return
    setRemark('')
    setPayoutAmount(
      props.withdrawal?.payout_amount_minor
        ? (props.withdrawal.payout_amount_minor / 100).toFixed(2)
        : (
            ((props.withdrawal?.amount_quota ?? 0) /
              currencyConfig.quotaPerUnit) *
            currencyConfig.usdExchangeRate
          ).toFixed(2)
    )
  }, [
    currencyConfig.quotaPerUnit,
    currencyConfig.usdExchangeRate,
    props.open,
    props.targetStatus,
    props.withdrawal,
  ])

  const actionLabel = getActionLabel(props.targetStatus, t)

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={actionLabel}
      description={t('{{provider}} requested {{amount}}.', {
        provider: props.withdrawal?.provider_name || '-',
        amount: formatQuota(props.withdrawal?.amount_quota ?? 0),
      })}
      contentHeight='auto'
      contentClassName={showPaymentQRCode ? 'sm:max-w-[760px]' : 'sm:max-w-xl'}
      footerClassName='border-t bg-muted/20 py-3 sm:p-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={props.pending}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            variant={
              props.targetStatus === 'rejected' ? 'destructive' : 'default'
            }
            onClick={async () => {
              if (!canSubmit) return
              const success = await props.onConfirm({
                remark: remark.trim(),
                payoutCurrency: 'CNY',
                payoutAmountMinor,
                exchangeRate,
              })
              if (success) props.onOpenChange(false)
            }}
            disabled={!canSubmit}
          >
            {props.pending && <Loader2 className='animate-spin' />}
            {actionLabel}
          </Button>
        </>
      }
    >
      <div
        className={
          showPaymentQRCode
            ? 'grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_16rem]'
            : 'space-y-5'
        }
      >
        <div className='min-w-0 space-y-5'>
          <section className='space-y-3'>
            <p className='text-muted-foreground text-xs font-medium'>
              {t('Payout account')}
            </p>
            {props.withdrawal?.payout_account ? (
              <PayoutAccountDetails
                method={props.withdrawal.payout_account.method}
                details={props.withdrawal.payout_account.details}
              />
            ) : (
              <p className='text-sm break-words whitespace-pre-wrap'>
                {props.withdrawal?.applicant_note || '-'}
              </p>
            )}
          </section>
          {props.targetStatus === 'paid' && (
            <div className='space-y-2 border-t pt-5'>
              <Label htmlFor='withdrawal-payout-amount'>
                {t('Actual payout amount')}
              </Label>
              <InputGroup>
                <InputGroupAddon>¥</InputGroupAddon>
                <InputGroupInput
                  id='withdrawal-payout-amount'
                  type='number'
                  min={0}
                  step={0.01}
                  value={payoutAmount}
                  onChange={(event) => setPayoutAmount(event.target.value)}
                  placeholder='0.00'
                />
                <InputGroupAddon align='inline-end'>CNY</InputGroupAddon>
              </InputGroup>
            </div>
          )}
          <div className='space-y-2'>
            <Label htmlFor='withdrawal-admin-remark'>
              {getRemarkLabel(props.targetStatus, t)}
              {requiresRemark && (
                <span className='text-destructive ml-0.5' aria-hidden='true'>
                  *
                </span>
              )}
            </Label>
            <Textarea
              id='withdrawal-admin-remark'
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              maxLength={1000}
              placeholder={getRemarkPlaceholder(props.targetStatus, t)}
              className='min-h-20 resize-none'
              aria-required={requiresRemark}
            />
          </div>
        </div>
        {showPaymentQRCode && (
          <aside className='space-y-2 sm:border-l sm:pl-6'>
            <p className='text-muted-foreground text-xs font-medium'>
              {t('Payment QR code')}
            </p>
            <PayoutQRCodeImage
              assetId={payoutQRCodeAssetId}
              alt={t('Payment QR code')}
              className='size-64 max-w-full'
              previewable
            />
          </aside>
        )}
      </div>
    </Dialog>
  )
}
