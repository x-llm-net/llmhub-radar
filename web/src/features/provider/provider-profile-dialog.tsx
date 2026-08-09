/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Pencil, Save } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getProviderRootDomain } from '@/lib/provider-domain'

import { updateProvider } from './api'
import {
  providerFormSchema,
  type HubProvider,
  type HubProviderResponse,
  type ProviderFormValues,
} from './types'

type ProviderProfileDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: HubProvider
  onSaved: (response: HubProviderResponse) => void
}

function valuesFromProvider(provider: HubProvider): ProviderFormValues {
  return {
    name: provider.name,
    slug: provider.slug,
    website: provider.website,
    description: provider.description,
    logo_url: provider.logo_url,
  }
}

export function ProviderProfileDialog(props: ProviderProfileDialogProps) {
  const { t } = useTranslation()
  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: valuesFromProvider(props.provider),
  })
  const mutation = useMutation({
    mutationFn: updateProvider,
    onSuccess: (response) => {
      if (!response.success || !response.data) {
        toast.error(response.message || t('Failed to update provider profile'))
        return
      }
      props.onSaved(response)
      props.onOpenChange(false)
      toast.success(t('Provider profile updated'))
    },
    onError: () => toast.error(t('Failed to update provider profile')),
  })

  useEffect(() => {
    if (props.open) form.reset(valuesFromProvider(props.provider))
  }, [form, props.open, props.provider])

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!mutation.isPending) props.onOpenChange(open)
      }}
      title={t('Edit public profile')}
      description={t(
        'These details are shown on your public channel provider homepage.'
      )}
      contentClassName='sm:max-w-xl'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form='provider-public-profile-form'
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <Save className='animate-pulse' />
            ) : (
              <Pencil />
            )}
            {mutation.isPending ? t('Saving...') : t('Save changes')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id='provider-public-profile-form'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className='grid gap-5'
        >
          <div className='grid gap-2'>
            <Label htmlFor='provider-profile-name'>{t('Provider name')}</Label>
            <Input id='provider-profile-name' {...form.register('name')} />
            {form.formState.errors.name && (
              <p className='text-destructive text-sm'>
                {t(
                  form.formState.errors.name.message ??
                    'Provider name is required'
                )}
              </p>
            )}
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='provider-profile-slug'>
              {t('Provider subdomain')}
            </Label>
            <Input
              id='provider-profile-slug'
              autoCapitalize='none'
              autoCorrect='off'
              spellCheck={false}
              {...form.register('slug')}
            />
            <code className='text-muted-foreground overflow-hidden text-xs text-ellipsis'>
              https://{form.watch('slug') || 'your-name'}.
              {getProviderRootDomain()}
            </code>
            {form.formState.errors.slug && (
              <p className='text-destructive text-sm'>
                {t(
                  form.formState.errors.slug.message ??
                    'Provider subdomain must use 3-63 lowercase letters, numbers, or hyphens'
                )}
              </p>
            )}
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='provider-profile-website'>{t('Website')}</Label>
            <Input
              id='provider-profile-website'
              placeholder='https://example.com'
              {...form.register('website')}
            />
            {form.formState.errors.website && (
              <p className='text-destructive text-sm'>
                {t(
                  form.formState.errors.website.message ??
                    'Website must be a valid HTTP or HTTPS URL'
                )}
              </p>
            )}
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='provider-profile-description'>
              {t('Description')}
            </Label>
            <Textarea
              id='provider-profile-description'
              className='min-h-28 resize-y'
              placeholder={t('Describe the services you provide')}
              {...form.register('description')}
            />
            {form.formState.errors.description && (
              <p className='text-destructive text-sm'>
                {t(
                  form.formState.errors.description.message ??
                    'Provider description must be at most 1000 characters'
                )}
              </p>
            )}
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='provider-profile-logo'>{t('Logo URL')}</Label>
            <Input
              id='provider-profile-logo'
              placeholder='https://example.com/logo.png'
              {...form.register('logo_url')}
            />
            {form.formState.errors.logo_url && (
              <p className='text-destructive text-sm'>
                {t(
                  form.formState.errors.logo_url.message ??
                    'Logo URL must be a valid HTTP or HTTPS URL'
                )}
              </p>
            )}
          </div>
        </form>
      </Form>
    </Dialog>
  )
}
