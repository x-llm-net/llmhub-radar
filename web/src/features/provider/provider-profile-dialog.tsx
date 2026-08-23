/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Pencil, Save, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getProviderRootDomain } from '@/lib/provider-domain'
import { useProviderLogoURL } from '@/lib/provider-logo'

import { updateProvider } from './api'
import { ProviderContactFields } from './provider-contact-fields'
import { ProviderWebsiteEvidenceImage } from './provider-website-evidence-image'
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
    logo_url: provider.logo_url.startsWith('/api/hub/')
      ? ''
      : provider.logo_url,
    contact_type: provider.contact_type || 'qq',
    contact_value: provider.contact_value,
    support_type: provider.support_type || 'community',
    support_value: provider.support_value,
  }
}

function websiteOrigin(value: string): string {
  try {
    return new URL(value.trim()).origin
  } catch {
    return ''
  }
}

export function ProviderProfileDialog(props: ProviderProfileDialogProps) {
  const { t } = useTranslation()
  const editingApplication = props.provider.status !== 'active'
  const [verifyWebsite, setVerifyWebsite] = useState(false)
  const [websiteEvidence, setWebsiteEvidence] = useState<File | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState('')
  const existingLogoURL = useProviderLogoURL(props.provider.logo_url)
  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: valuesFromProvider(props.provider),
  })
  const website = form.watch('website').trim()
  const currentWebsiteOrigin = websiteOrigin(website)
  const verificationApplies =
    currentWebsiteOrigin !== '' &&
    currentWebsiteOrigin === props.provider.website_verified_origin
  const verificationPending =
    verificationApplies &&
    props.provider.website_verification_status === 'pending'
  const verificationVerified =
    verificationApplies &&
    props.provider.website_verification_status === 'verified'
  const existingManualEvidence =
    verificationApplies &&
    props.provider.website_verification_method === 'manual' &&
    props.provider.website_evidence_asset_id > 0
  const mutation = useMutation({
    mutationFn: (input: {
      values: ProviderFormValues
      websiteEvidence?: File
      logoFile?: File
    }) => updateProvider(input.values, input.websiteEvidence, input.logoFile),
    onSuccess: (response) => {
      if (!response.success || !response.data) {
        toast.error(response.message || t('Failed to update provider profile'))
        return
      }
      props.onSaved(response)
      props.onOpenChange(false)
      toast.success(
        t(
          props.provider.status === 'rejected'
            ? 'Provider application resubmitted'
            : 'Provider profile updated'
        )
      )
    },
    onError: () => toast.error(t('Failed to update provider profile')),
  })

  useEffect(() => {
    if (props.open) {
      form.reset(valuesFromProvider(props.provider))
      setVerifyWebsite(false)
      setWebsiteEvidence(null)
      setLogoFile(null)
    }
  }, [form, props.open, props.provider])

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(existingLogoURL)
      return
    }
    const previewURL = URL.createObjectURL(logoFile)
    setLogoPreview(previewURL)
    return () => URL.revokeObjectURL(previewURL)
  }, [existingLogoURL, logoFile])

  useEffect(() => {
    if (website) return
    setVerifyWebsite(false)
    setWebsiteEvidence(null)
  }, [website])

  const onSubmit = (values: ProviderFormValues) => {
    if (verifyWebsite && !websiteEvidence) {
      toast.error(t('Select a verification screenshot'))
      return
    }
    mutation.mutate({
      values,
      websiteEvidence: verifyWebsite
        ? (websiteEvidence ?? undefined)
        : undefined,
      logoFile: logoFile ?? undefined,
    })
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!mutation.isPending) props.onOpenChange(open)
      }}
      title={t(editingApplication ? 'Edit application' : 'Edit public profile')}
      description={t(
        editingApplication
          ? 'Saving changes will submit the application for review again.'
          : 'These details are shown on your public channel provider homepage.'
      )}
      contentClassName='sm:max-w-2xl'
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
          onSubmit={form.handleSubmit(onSubmit)}
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
            <Label htmlFor='provider-profile-website'>{t('Website')}</Label>
            <Input
              id='provider-profile-website'
              placeholder='https://example.com'
              {...form.register('website')}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'Optional. Before verification, the website is visible only to you and administrators. After verification, it can be shown publicly as your official website.'
              )}
            </p>
            {form.formState.errors.website && (
              <p className='text-destructive text-sm'>
                {t(
                  form.formState.errors.website.message ??
                    'Website must be a valid HTTP or HTTPS URL'
                )}
              </p>
            )}
          </div>

          {website && (
            <div className='grid gap-4 rounded-md border p-4'>
              {verificationVerified ? (
                <div className='flex items-start gap-3'>
                  <ShieldCheck className='text-success mt-0.5 size-5 shrink-0' />
                  <div className='grid gap-1'>
                    <p className='text-sm font-medium'>
                      {t('Website ownership verified')}
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'After verification, your official website is shown publicly with verified ownership. The active subdomain stays unchanged so existing links and API Base URLs keep working.'
                      )}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {verificationPending && (
                    <div className='flex items-start gap-3'>
                      <ShieldCheck className='text-warning mt-0.5 size-5 shrink-0' />
                      <div className='grid gap-1'>
                        <p className='text-sm font-medium'>
                          {t('Screenshot submitted for review')}
                        </p>
                        <p className='text-muted-foreground text-xs'>
                          {t(
                            'Verification publishes your official website with verified ownership and lets the administrator enable the clean subdomain.'
                          )}
                        </p>
                      </div>
                    </div>
                  )}

                  {existingManualEvidence && (
                    <ProviderWebsiteEvidenceImage
                      assetId={props.provider.website_evidence_asset_id}
                      alt={t('Submitted verification screenshot')}
                      className='max-h-48 max-w-full rounded-md border object-contain'
                    />
                  )}

                  <div className='flex items-start gap-3 border-t pt-4'>
                    <Checkbox
                      id='provider-profile-verify-website'
                      checked={verifyWebsite}
                      onCheckedChange={(checked) => {
                        const enabled = checked === true
                        setVerifyWebsite(enabled)
                        if (!enabled) setWebsiteEvidence(null)
                      }}
                    />
                    <div className='grid gap-1'>
                      <Label htmlFor='provider-profile-verify-website'>
                        {t(
                          existingManualEvidence
                            ? 'Replace image'
                            : 'Verify website ownership (recommended)'
                        )}
                      </Label>
                      {!verificationPending && (
                        <p className='text-muted-foreground text-xs'>
                          {t(
                            'Verification publishes your official website with verified ownership and lets the administrator enable the clean subdomain.'
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  {verifyWebsite ? (
                    <div className='grid gap-2 border-t pt-4'>
                      <Label htmlFor='provider-profile-evidence'>
                        {t('Verification screenshot')}
                      </Label>
                      <Input
                        id='provider-profile-evidence'
                        type='file'
                        accept='image/png,image/jpeg,image/webp'
                        onChange={(event) =>
                          setWebsiteEvidence(
                            event.target.files?.item(0) ?? null
                          )
                        }
                      />
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'Upload a screenshot showing the browser address bar and the logged-in management page. Mask API keys, balances, and order details.'
                        )}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {t('PNG, JPEG, or WebP, up to 5 MB.')}
                      </p>
                    </div>
                  ) : (
                    !verificationPending && (
                      <div className='bg-muted/30 flex items-start gap-2 rounded-md px-3 py-2 text-xs'>
                        <ShieldCheck className='text-muted-foreground mt-0.5 size-4 shrink-0' />
                        <p className='text-muted-foreground'>
                          {t(
                            'Without verification, the website stays private and the suffixed subdomain becomes fixed after onboarding approval.'
                          )}
                        </p>
                      </div>
                    )
                  )}
                </>
              )}
            </div>
          )}

          <div className='grid gap-2'>
            <Label htmlFor='provider-profile-slug'>
              {t('Provider subdomain')}
            </Label>
            <InputGroup>
              <InputGroupInput
                id='provider-profile-slug'
                autoCapitalize='none'
                autoCorrect='off'
                spellCheck={false}
                placeholder='your-name'
                readOnly
                {...form.register('slug')}
              />
              <InputGroupAddon align='inline-end'>
                .{getProviderRootDomain()}
              </InputGroupAddon>
            </InputGroup>
            <p className='text-muted-foreground text-xs'>
              {t(
                'The active subdomain is fixed so existing API Base URLs keep working.'
              )}
            </p>
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
            <Label htmlFor='provider-profile-description'>
              {t('Description')}
            </Label>
            <p className='text-muted-foreground text-xs'>
              {t('Supports Markdown formatting.')}
            </p>
            <Textarea
              id='provider-profile-description'
              className='min-h-28 resize-y'
              placeholder={t('Describe the services you provide')}
              {...form.register('description')}
            />
            {form.watch('description').trim() && (
              <div className='bg-muted/30 rounded-md border p-3'>
                <p className='text-muted-foreground mb-2 text-xs font-medium'>
                  {t('Markdown preview')}
                </p>
                <RichContent content={form.watch('description')} breaks />
              </div>
            )}
            {form.formState.errors.description && (
              <p className='text-destructive text-sm'>
                {t(
                  form.formState.errors.description.message ??
                    'Provider description must be at most 1000 characters'
                )}
              </p>
            )}
          </div>

          <div className='grid gap-3'>
            <div className='grid gap-1'>
              <Label htmlFor='provider-profile-logo'>
                {t('Provider logo')}
              </Label>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Upload a logo for your public provider page. This is the default option for providers without their own website.'
                )}
              </p>
            </div>
            <Input
              id='provider-profile-logo'
              type='file'
              accept='image/png,image/jpeg,image/webp'
              onChange={(event) =>
                setLogoFile(event.target.files?.item(0) ?? null)
              }
            />
            {logoPreview && (
              <img
                src={logoPreview}
                alt={t('Provider logo preview')}
                className='size-20 rounded-lg border object-cover'
              />
            )}
            <p className='text-muted-foreground text-xs'>
              {t('PNG, JPEG, or WebP, up to 512 KB. Optional.')}
            </p>
          </div>

          <ProviderContactFields form={form} idPrefix='provider-profile' />
        </form>
      </Form>
    </Dialog>
  )
}
