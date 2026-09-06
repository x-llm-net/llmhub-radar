/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import type { TenantAdminTenant } from './types'

export function TenantPlatformFeeEditor(props: {
  tenant: TenantAdminTenant
  isBusy: boolean
  onSave: (platformFeeBasisPoints: number | null) => void
}) {
  const { t } = useTranslation()
  const [useGlobal, setUseGlobal] = useState(true)
  const [feePercent, setFeePercent] = useState('')
  const parsedFee = Number(feePercent)
  const canSubmit =
    !props.isBusy &&
    (useGlobal ||
      (Number.isFinite(parsedFee) && parsedFee >= 0 && parsedFee <= 100))

  useEffect(() => {
    const settlement = props.tenant.settlement
    const followsGlobal = settlement.platform_fee_basis_points == null
    setUseGlobal(followsGlobal)
    setFeePercent(
      String(
        (settlement.platform_fee_basis_points ??
          settlement.effective_platform_fee_basis_points) / 100
      )
    )
  }, [props.tenant])

  let effectivePercent =
    props.tenant.settlement.effective_platform_fee_basis_points / 100
  if (useGlobal) {
    effectivePercent =
      props.tenant.settlement.global_platform_fee_basis_points / 100
  } else if (Number.isFinite(parsedFee) && parsedFee >= 0 && parsedFee <= 100) {
    effectivePercent = parsedFee
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Platform fee')}</CardTitle>
        <CardDescription>
          {t(
            'Taken from the reseller gross profit, not from the user charge. Changes only affect earnings created afterwards.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-4'>
        <div className='flex items-center justify-between gap-4 rounded-md border px-3 py-3'>
          <div className='min-w-0'>
            <Label htmlFor={`tenant-global-fee-${props.tenant.id}`}>
              {t('Follow global service fee')}
            </Label>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t('Current global fee: {{percent}}%', {
                percent:
                  props.tenant.settlement.global_platform_fee_basis_points /
                  100,
              })}
            </p>
          </div>
          <Switch
            id={`tenant-global-fee-${props.tenant.id}`}
            checked={useGlobal}
            onCheckedChange={setUseGlobal}
            disabled={props.isBusy}
          />
        </div>

        {!useGlobal && (
          <div className='grid gap-2'>
            <Label htmlFor={`tenant-platform-fee-${props.tenant.id}`}>
              {t('Individual platform service fee')}
            </Label>
            <InputGroup>
              <InputGroupInput
                id={`tenant-platform-fee-${props.tenant.id}`}
                type='number'
                min={0}
                max={100}
                step={0.01}
                value={feePercent}
                onChange={(event) => setFeePercent(event.target.value)}
                disabled={props.isBusy}
              />
              <InputGroupAddon align='inline-end'>%</InputGroupAddon>
            </InputGroup>
          </div>
        )}

        <div className='text-muted-foreground text-sm'>
          {t('Platform fee')}: {effectivePercent}%
        </div>
        <Button
          type='button'
          disabled={!canSubmit}
          onClick={() =>
            props.onSave(
              useGlobal ? null : Math.round(Number(feePercent) * 100)
            )
          }
        >
          <Save />
          {t('Save')}
        </Button>
      </CardContent>
    </Card>
  )
}
