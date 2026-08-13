/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

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

import type { ProviderFormValues } from './types'

type ProviderContactFieldsProps = {
  form: UseFormReturn<ProviderFormValues>
  idPrefix: string
}

const contactTypes = ['wechat', 'telegram', 'email', 'phone', 'other'] as const
const supportTypes = [
  'community',
  'customer_service',
  'announcement',
  'email',
  'other',
] as const

function contactTypeLabel(value: (typeof contactTypes)[number]): string {
  switch (value) {
    case 'wechat':
      return 'WeChat'
    case 'telegram':
      return 'Telegram'
    case 'email':
      return 'Email'
    case 'phone':
      return 'Phone'
    case 'other':
      return 'Other'
  }
}

function supportTypeLabel(value: (typeof supportTypes)[number]): string {
  switch (value) {
    case 'community':
      return 'Community'
    case 'customer_service':
      return 'Customer service'
    case 'announcement':
      return 'Announcement channel'
    case 'email':
      return 'Email'
    case 'other':
      return 'Other'
  }
}

export function ProviderContactFields(props: ProviderContactFieldsProps) {
  const { t } = useTranslation()
  const contactType = props.form.watch('contact_type')
  const supportType = props.form.watch('support_type')

  return (
    <div className='grid gap-5 border-t pt-5'>
      <div>
        <h3 className='text-sm font-medium'>{t('Contact information')}</h3>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t(
            'Review contact is private. The public support entry is shown to users on your provider homepage.'
          )}
        </p>
      </div>

      <div className='grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]'>
        <div className='grid gap-2'>
          <Label htmlFor={`${props.idPrefix}-contact-type`}>
            {t('Review contact method')}
          </Label>
          <Select
            value={contactType}
            onValueChange={(value) => {
              if (!value) return
              props.form.setValue('contact_type', value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }}
          >
            <SelectTrigger
              id={`${props.idPrefix}-contact-type`}
              className='w-full'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {contactTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(contactTypeLabel(type))}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-2'>
          <Label htmlFor={`${props.idPrefix}-contact-value`}>
            {t('Review contact')}
          </Label>
          <Input
            id={`${props.idPrefix}-contact-value`}
            placeholder={t('Used only for application review and operations')}
            {...props.form.register('contact_value')}
          />
          {props.form.formState.errors.contact_value && (
            <p className='text-destructive text-sm'>
              {t(
                props.form.formState.errors.contact_value.message ??
                  'Review contact is required'
              )}
            </p>
          )}
        </div>
      </div>

      <div className='grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]'>
        <div className='grid gap-2'>
          <Label htmlFor={`${props.idPrefix}-support-type`}>
            {t('Public support type')}
          </Label>
          <Select
            value={supportType}
            onValueChange={(value) => {
              if (!value) return
              props.form.setValue('support_type', value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }}
          >
            <SelectTrigger
              id={`${props.idPrefix}-support-type`}
              className='w-full'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {supportTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(supportTypeLabel(type))}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-2'>
          <Label htmlFor={`${props.idPrefix}-support-value`}>
            {t('Public support entry')}
            <span className='text-muted-foreground ml-1 font-normal'>
              ({t('Optional')})
            </span>
          </Label>
          <Input
            id={`${props.idPrefix}-support-value`}
            placeholder={t('Group link, support account, channel, or email')}
            {...props.form.register('support_value')}
          />
          {props.form.formState.errors.support_value && (
            <p className='text-destructive text-sm'>
              {t(
                props.form.formState.errors.support_value.message ??
                  'Public support entry must be at most 512 characters'
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
