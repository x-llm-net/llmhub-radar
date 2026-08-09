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
import { Textarea } from '@/components/ui/textarea'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { parseQuotaFromDollars } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ProviderAdjustmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerName: string
  pending: boolean
  onConfirm: (amountQuota: number, remark: string) => Promise<boolean>
}

export function ProviderAdjustmentDialog(props: ProviderAdjustmentDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'credit' | 'debit'>('credit')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const { meta } = getCurrencyDisplay()
  const unsignedQuota = parseQuotaFromDollars(Number(amount))
  const canSubmit =
    unsignedQuota > 0 && remark.trim().length > 0 && !props.pending

  useEffect(() => {
    if (!props.open) return
    setMode('credit')
    setAmount('')
    setRemark('')
  }, [props.open])

  const handleConfirm = async () => {
    if (!canSubmit) return
    const amountQuota = mode === 'debit' ? -unsignedQuota : unsignedQuota
    const success = await props.onConfirm(amountQuota, remark.trim())
    if (success) props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Adjust provider earnings')}
      description={t('Create an auditable earnings adjustment for {{name}}.', {
        name: props.providerName,
      })}
      contentHeight='auto'
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
            {t('Confirm adjustment')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='space-y-2'>
          <Label>{t('Adjustment type')}</Label>
          <div className='bg-muted grid grid-cols-2 gap-1 rounded-lg p-1'>
            {(['credit', 'debit'] as const).map((value) => (
              <Button
                key={value}
                type='button'
                variant='ghost'
                size='sm'
                className={cn(
                  'h-8',
                  mode === value &&
                    'bg-background text-foreground shadow-sm hover:bg-background'
                )}
                onClick={() => setMode(value)}
              >
                {t(value === 'credit' ? 'Add earnings' : 'Deduct earnings')}
              </Button>
            ))}
          </div>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='provider-adjustment-amount'>
            {t('Amount')} ({getCurrencyLabel()})
          </Label>
          <Input
            id='provider-adjustment-amount'
            type='number'
            min={0}
            step={meta.kind === 'tokens' ? 1 : 0.01}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={t('Enter adjustment amount')}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='provider-adjustment-remark'>{t('Reason')}</Label>
          <Textarea
            id='provider-adjustment-remark'
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            maxLength={1000}
            placeholder={t('A reason is required for the audit trail')}
          />
        </div>
      </div>
    </Dialog>
  )
}
