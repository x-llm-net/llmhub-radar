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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'

import type { HubProviderPayoutAccount } from '../types'
import { PayoutAccountDetails } from './payout-account'

interface ProviderWithdrawalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableQuota: number
  minimumWithdrawalQuota: number
  accounts: HubProviderPayoutAccount[]
  accountsLoading: boolean
  pending: boolean
  onManageAccounts: () => void
  onConfirm: (amountQuota: number, payoutAccountId: number) => Promise<boolean>
}

export function ProviderWithdrawalDialog(props: ProviderWithdrawalDialogProps) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  const [payoutAccountId, setPayoutAccountId] = useState<number>(0)
  const { meta } = getCurrencyDisplay()
  const amountQuota = parseQuotaFromDollars(Number(amount))
  const canSubmit =
    Number(amount) > 0 &&
    amountQuota > 0 &&
    amountQuota >= props.minimumWithdrawalQuota &&
    amountQuota <= props.availableQuota &&
    payoutAccountId > 0 &&
    !props.pending

  useEffect(() => {
    if (!props.open) return
    setAmount('')
    const preferred =
      props.accounts.find((account) => account.is_default) ?? props.accounts[0]
    setPayoutAccountId(preferred?.id ?? 0)
  }, [props.accounts, props.open])

  const handleConfirm = async () => {
    if (!canSubmit) return
    const success = await props.onConfirm(amountQuota, payoutAccountId)
    if (success) props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Request withdrawal')}
      description={t(
        'Submit your available provider earnings for administrator review.'
      )}
      contentHeight='auto'
      bodyClassName='space-y-4'
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
          <Button type='button' onClick={handleConfirm} disabled={!canSubmit}>
            {props.pending && <Loader2 className='animate-spin' />}
            {t('Submit request')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='bg-muted/50 rounded-md border px-3 py-2.5'>
          <p className='text-muted-foreground text-xs'>{t('Available')}</p>
          <p className='mt-1 text-lg font-semibold tabular-nums'>
            {formatQuota(props.availableQuota)}
          </p>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='provider-withdrawal-amount'>
            {t('Withdrawal amount')} ({getCurrencyLabel()})
          </Label>
          <Input
            id='provider-withdrawal-amount'
            type='number'
            min={quotaUnitsToDollars(props.minimumWithdrawalQuota)}
            max={quotaUnitsToDollars(props.availableQuota)}
            step={meta.kind === 'tokens' ? 1 : 0.01}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={t('Enter withdrawal amount')}
          />
          {amount && amountQuota > props.availableQuota && (
            <p className='text-destructive text-xs'>
              {t('Amount exceeds available earnings')}
            </p>
          )}
          {amount &&
            amountQuota > 0 &&
            amountQuota < props.minimumWithdrawalQuota && (
              <p className='text-destructive text-xs'>
                {t('Minimum withdrawal amount is {{amount}}', {
                  amount: formatQuota(props.minimumWithdrawalQuota),
                })}
              </p>
            )}
          {props.minimumWithdrawalQuota > 0 && !amount && (
            <p className='text-muted-foreground text-xs'>
              {t('Minimum withdrawal amount is {{amount}}', {
                amount: formatQuota(props.minimumWithdrawalQuota),
              })}
            </p>
          )}
        </div>
        <div className='space-y-2'>
          <Label>{t('Payout account')}</Label>
          {props.accounts.length > 0 ? (
            <>
              <Select
                items={props.accounts.map((account) => ({
                  value: account.id.toString(),
                  label: `${account.details.recipient_name} · ${account.masked_summary || t('QR code')}`,
                }))}
                value={payoutAccountId > 0 ? payoutAccountId.toString() : null}
                onValueChange={(value) =>
                  setPayoutAccountId(value ? Number(value) : 0)
                }
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {props.accounts.map((account) => (
                      <SelectItem
                        key={account.id}
                        value={account.id.toString()}
                      >
                        {account.details.recipient_name} ·{' '}
                        {account.masked_summary || t('QR code')}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {props.accounts
                .filter((account) => account.id === payoutAccountId)
                .map((account) => (
                  <div
                    key={account.id}
                    className='bg-muted/40 rounded-md border px-3 py-2.5'
                  >
                    <PayoutAccountDetails
                      method={account.method}
                      details={account.details}
                      maskedSummary={account.masked_summary}
                      compact
                    />
                  </div>
                ))}
            </>
          ) : (
            <div className='bg-muted/40 space-y-3 rounded-md border px-3 py-3'>
              <p className='text-muted-foreground text-sm'>
                {props.accountsLoading
                  ? t('Loading payout accounts')
                  : t('Add a payout account before requesting a withdrawal.')}
              </p>
              {!props.accountsLoading && (
                <Button
                  type='button'
                  variant='outline'
                  onClick={props.onManageAccounts}
                >
                  {t('Manage payout accounts')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
