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
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { Switch } from '@/components/ui/switch'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import { updateHubProviderSettlement } from '../api'
import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'

const schema = z.object({
  platformFeePercent: z.coerce.number().min(0).max(100),
  minimumWithdrawalAmount: z.coerce.number().min(0),
  fallbackReferralEnabled: z.boolean(),
  fallbackReferralPercent: z.coerce.number().min(0).max(100),
})

type Values = z.infer<typeof schema>

type ProviderSettlementSettingsSectionProps = {
  defaultValues: {
    platformFeeBasisPoints: number
    minimumWithdrawalQuota: number
    fallbackReferralEnabled: boolean
    fallbackReferralBasisPoints: number
  }
}

export function ProviderSettlementSettingsSection({
  defaultValues,
}: ProviderSettlementSettingsSectionProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const updateSettlement = useMutation({
    mutationFn: updateHubProviderSettlement,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-options'] })
      toast.success(t('Setting updated successfully'))
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to update setting'))
    },
  })
  const { meta } = getCurrencyDisplay()
  const form = useForm<Values>({
    resolver: zodResolver(schema) as Resolver<Values>,
    defaultValues: {
      platformFeePercent: defaultValues.platformFeeBasisPoints / 100,
      minimumWithdrawalAmount: quotaUnitsToDollars(
        defaultValues.minimumWithdrawalQuota
      ),
      fallbackReferralEnabled: defaultValues.fallbackReferralEnabled,
      fallbackReferralPercent: defaultValues.fallbackReferralBasisPoints / 100,
    },
  })
  const { isDirty, isSubmitting } = form.formState

  async function onSubmit(values: Values) {
    const platformFeeBasisPoints = Math.round(values.platformFeePercent * 100)
    const minimumWithdrawalQuota = parseQuotaFromDollars(
      values.minimumWithdrawalAmount
    )
    const fallbackReferralBasisPoints = Math.round(
      values.fallbackReferralPercent * 100
    )
    await updateSettlement.mutateAsync({
      platform_fee_basis_points: platformFeeBasisPoints,
      minimum_withdrawal_quota: minimumWithdrawalQuota,
      fallback_referral_enabled: values.fallbackReferralEnabled,
      fallback_referral_basis_points: fallbackReferralBasisPoints,
    })
    form.reset({
      ...values,
      platformFeePercent: platformFeeBasisPoints / 100,
      minimumWithdrawalAmount: quotaUnitsToDollars(minimumWithdrawalQuota),
      fallbackReferralPercent: fallbackReferralBasisPoints / 100,
    })
  }

  return (
    <SettingsSection title={t('Provider settlement')}>
      <FormNavigationGuard when={isDirty} />
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateSettlement.isPending || isSubmitting}
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
            name='fallbackReferralEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Fallback referral commission')}</FormLabel>
                  <FormDescription>
                    {t(
                      'When a provider brings the user but another provider serves a fallback request, transfer a commission from the serving provider income. User charges and platform fees stay unchanged.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <FormField
            control={form.control}
            name='fallbackReferralPercent'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Fallback referral rate')}</FormLabel>
                <FormControl>
                  <InputGroup>
                    <InputGroupInput
                      type='number'
                      min={0}
                      max={100}
                      step={0.01}
                      disabled={!form.watch('fallbackReferralEnabled')}
                      {...field}
                    />
                    <InputGroupAddon align='inline-end'>%</InputGroupAddon>
                  </InputGroup>
                </FormControl>
                <FormDescription>
                  {t(
                    'Calculated from the final user charge and deducted from the provider that actually serves the request. The default is 1%.'
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
