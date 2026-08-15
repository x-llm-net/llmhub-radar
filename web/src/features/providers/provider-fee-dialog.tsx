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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import type { HubProviderAdminItem } from './types'

type ProviderFeeDialogProps = {
  provider: HubProviderAdminItem
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (platformFeeBasisPoints: number | null) => void
}

export function ProviderFeeDialog(props: ProviderFeeDialogProps) {
  const { t } = useTranslation()
  const [useGlobal, setUseGlobal] = useState(true)
  const [feePercent, setFeePercent] = useState('')
  const parsedFee = Number(feePercent)
  const canSubmit =
    !props.pending &&
    (useGlobal ||
      (Number.isFinite(parsedFee) && parsedFee >= 0 && parsedFee <= 100))

  useEffect(() => {
    if (!props.open) return
    const followsGlobal = props.provider.platform_fee_basis_points == null
    setUseGlobal(followsGlobal)
    setFeePercent(
      String(
        (props.provider.platform_fee_basis_points ??
          props.provider.effective_platform_fee_basis_points) / 100
      )
    )
  }, [props.open, props.provider])

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Provider service fee')}
      description={t('Configure the platform service fee for {{name}}.', {
        name: props.provider.name,
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
          <Button
            type='button'
            disabled={!canSubmit}
            onClick={() =>
              props.onConfirm(
                useGlobal ? null : Math.round(Number(feePercent) * 100)
              )
            }
          >
            {props.pending && <Loader2 className='animate-spin' />}
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className='space-y-5'>
        <div className='flex items-center justify-between gap-4 rounded-md border px-3 py-3'>
          <div className='min-w-0'>
            <Label htmlFor={`provider-global-fee-${props.provider.id}`}>
              {t('Follow global service fee')}
            </Label>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t('Current global fee: {{percent}}%', {
                percent: props.provider.global_platform_fee_basis_points / 100,
              })}
            </p>
          </div>
          <Switch
            id={`provider-global-fee-${props.provider.id}`}
            checked={useGlobal}
            onCheckedChange={setUseGlobal}
            disabled={props.pending}
          />
        </div>
        {!useGlobal && (
          <div className='space-y-2'>
            <Label htmlFor={`provider-fee-${props.provider.id}`}>
              {t('Individual platform service fee')}
            </Label>
            <InputGroup>
              <InputGroupInput
                id={`provider-fee-${props.provider.id}`}
                type='number'
                min={0}
                max={100}
                step={0.01}
                value={feePercent}
                onChange={(event) => setFeePercent(event.target.value)}
                disabled={props.pending}
              />
              <InputGroupAddon align='inline-end'>%</InputGroupAddon>
            </InputGroup>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Set to 0 for a fee-free provider. The change applies only to future earnings.'
              )}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
