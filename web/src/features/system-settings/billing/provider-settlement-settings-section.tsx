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
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const schema = z.object({
  platformFeePercent: z.coerce.number().min(0).max(100),
  minimumWithdrawalAmount: z.coerce.number().min(0),
})

type Values = z.infer<typeof schema>

type ProviderSettlementSettingsSectionProps = {
  defaultValues: {
    platformFeeBasisPoints: number
    minimumWithdrawalQuota: number
  }
}

export function ProviderSettlementSettingsSection({
  defaultValues,
}: ProviderSettlementSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const { meta } = getCurrencyDisplay()
  const form = useForm<Values>({
    resolver: zodResolver(schema) as Resolver<Values>,
    defaultValues: {
      platformFeePercent: defaultValues.platformFeeBasisPoints / 100,
      minimumWithdrawalAmount: quotaUnitsToDollars(
        defaultValues.minimumWithdrawalQuota
      ),
    },
  })
  const { isDirty, isSubmitting } = form.formState

  async function onSubmit(values: Values) {
    const platformFeeBasisPoints = Math.round(values.platformFeePercent * 100)
    const minimumWithdrawalQuota = parseQuotaFromDollars(
      values.minimumWithdrawalAmount
    )
    const updates: Array<{ key: string; value: number }> = []

    if (platformFeeBasisPoints !== defaultValues.platformFeeBasisPoints) {
      updates.push({
        key: 'hub_provider_settlement_setting.platform_fee_basis_points',
        value: platformFeeBasisPoints,
      })
    }
    if (minimumWithdrawalQuota !== defaultValues.minimumWithdrawalQuota) {
      updates.push({
        key: 'hub_provider_settlement_setting.minimum_withdrawal_quota',
        value: minimumWithdrawalQuota,
      })
    }
    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }
    form.reset(values)
  }

  return (
    <SettingsSection title={t('Provider settlement')}>
      <FormNavigationGuard when={isDirty} />
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
          />
          <FormDirtyIndicator isDirty={isDirty} />
          <FormField
            control={form.control}
            name='platformFeePercent'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Default platform service fee')}</FormLabel>
                <FormControl>
                  <InputGroup>
                    <InputGroupInput
                      type='number'
                      min={0}
                      max={100}
                      step={0.01}
                      {...field}
                    />
                    <InputGroupAddon align='inline-end'>%</InputGroupAddon>
                  </InputGroup>
                </FormControl>
                <FormDescription>
                  {t(
                    'Used for providers without an individual fee. Changes only affect earnings created afterwards.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='minimumWithdrawalAmount'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Minimum withdrawal amount')}</FormLabel>
                <FormControl>
                  <InputGroup>
                    <InputGroupInput
                      type='number'
                      min={0}
                      step={meta.kind === 'tokens' ? 1 : 0.01}
                      {...field}
                    />
                    <InputGroupAddon align='inline-end'>
                      {getCurrencyLabel()}
                    </InputGroupAddon>
                  </InputGroup>
                </FormControl>
                <FormDescription>
                  {t(
                    'Providers must request at least this amount. Set to 0 to keep withdrawals unrestricted.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
