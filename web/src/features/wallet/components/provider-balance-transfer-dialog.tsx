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
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'

interface ProviderBalanceTransferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableQuota: number
  pending: boolean
  onConfirm: (amountQuota: number, idempotencyKey: string) => Promise<boolean>
}

export function ProviderBalanceTransferDialog(
  props: ProviderBalanceTransferDialogProps
) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const { meta } = getCurrencyDisplay()
  const amountQuota = parseQuotaFromDollars(Number(amount))
  const canSubmit =
    Number(amount) > 0 &&
    amountQuota > 0 &&
    amountQuota <= props.availableQuota &&
    idempotencyKey !== '' &&
    !props.pending

  useEffect(() => {
    if (!props.open) return
    setAmount('')
    setIdempotencyKey(crypto.randomUUID())
  }, [props.open])

  const handleConfirm = async () => {
    if (!canSubmit) return
    const success = await props.onConfirm(amountQuota, idempotencyKey)
    if (success) props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Transfer to balance')}
      description={t(
        'Move withdrawable provider earnings to your account balance. Transferred earnings cannot be withdrawn again.'
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
            {t('Confirm transfer')}
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
          <Label htmlFor='provider-balance-transfer-amount'>
            {t('Transfer amount')} ({getCurrencyLabel()})
          </Label>
          <Input
            id='provider-balance-transfer-amount'
            type='number'
            min={0}
            max={quotaUnitsToDollars(props.availableQuota)}
            step={meta.kind === 'tokens' ? 1 : 0.01}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={t('Enter transfer amount')}
          />
          {amount && amountQuota > props.availableQuota && (
            <p className='text-destructive text-xs'>
              {t('Amount exceeds available earnings')}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  )
}
