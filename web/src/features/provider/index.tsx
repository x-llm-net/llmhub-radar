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
import { useNavigate } from '@tanstack/react-router'
import {
  Building2,
  ExternalLink,
  Globe2,
  Pencil,
  Plus,
  ShieldCheck,
  Store,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { Main } from '@/components/layout'
import { RichContent } from '@/components/rich-content'
import { StatusBadge } from '@/components/status-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  ChannelMutateDrawer,
  type ChannelEditorTransport,
} from '@/features/channels/components/drawers/channel-mutate-drawer'
import {
  getProviderPublicURL,
  getProviderRootDomain,
  providerSlugFromName,
} from '@/lib/provider-domain'
import { useProviderLogoURL } from '@/lib/provider-logo'

import {
  createProvider,
  createProviderChannel,
  deleteProviderChannel,
  fetchProviderChannelModels,
  getProviderChannel,
  getProviderChannelGroups,
  getProviderChannelModels,
  getProviderChannelPrefillGroups,
  previewProviderChannelModels,
  updateProviderChannel,
} from './api'
import {
  providerChannelsQueryKey,
  providerQueryKey,
  useProvider,
} from './hooks/use-provider'
import { ProviderChannelModelsDialog } from './probe-dialog'
import { ProviderApplicationState } from './provider-application-state'
import { ProviderChannelsTable } from './provider-channels-table'
import { ProviderContactFields } from './provider-contact-fields'
import { ProviderEarningsSummary } from './provider-earnings-summary'
import { ProviderOriginClaims } from './provider-origin-claims'
import { ProviderProfileDialog } from './provider-profile-dialog'
import { ProviderWebsiteVerification } from './provider-website-verification'
import {
  DEFAULT_HUB_SUPPLY_SETTINGS,
  providerFormSchema,
  type HubProviderChannel,
  type ProviderFormValues,
} from './types'

const providerChannelTransport: ChannelEditorTransport = {
  queryKeyPrefix: providerChannelsQueryKey,
  getChannel: async (channelId) => {
    const response = await getProviderChannel(channelId)
    return {
      success: response.success,
      message: response.message,
      data: response.data?.channel,
    }
  },
  create: async (payload, supply) => {
    const response = await createProviderChannel(payload, supply)
    return { success: response.success, message: response.message }
  },
  update: async (channelId, payload, supply) => {
    const response = await updateProviderChannel(channelId, payload, supply)
    return { success: response.success, message: response.message }
  },
  previewModels: previewProviderChannelModels,
  fetchStoredModels: fetchProviderChannelModels,
  getGroups: getProviderChannelGroups,
  getAllModels: getProviderChannelModels,
  getPrefillGroups: () => getProviderChannelPrefillGroups(),
}

function ProviderPageSkeleton() {
  return (
    <Main>
      <div className='flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-6'>
        <div className='mx-auto flex max-w-4xl flex-col gap-4'>
          <Skeleton className='h-8 w-48' />
          <Skeleton className='h-48 w-full rounded-xl' />
          <Skeleton className='h-32 w-full rounded-xl' />
        </div>
      </div>
    </Main>
  )
}

function ProviderPageError(props: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <Main>
      <div className='flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-6'>
        <div className='mx-auto w-full max-w-3xl'>
          <ErrorState
            title={t('Failed to load provider')}
            onRetry={props.onRetry}
          />
        </div>
      </div>
    </Main>
  )
}

export function ProviderOnboarding() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [verifyWebsite, setVerifyWebsite] = useState(false)
  const [websiteEvidence, setWebsiteEvidence] = useState<File | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState('')
  const providerQuery = useProvider()
  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: {
      name: '',
      slug: '',
      website: '',
      description: '',
      logo_url: '',
      contact_type: 'qq',
      contact_value: '',
      support_type: 'community',
      support_value: '',
    },
  })
  const website = form.watch('website').trim()
  const mutation = useMutation({
    mutationFn: (input: {
      values: ProviderFormValues
      websiteEvidence?: File
      logoFile?: File
    }) => createProvider(input.values, input.websiteEvidence, input.logoFile),
    onSuccess: (response) => {
      if (!response.success || !response.data) {
        toast.error(response.message || t('Failed to create provider'))
        return
      }
      queryClient.setQueryData(providerQueryKey, response)
      toast.success(t('Provider application submitted'))
      navigate({ to: '/provider' })
    },
    onError: () => toast.error(t('Failed to create provider')),
  })

  useEffect(() => {
    if (
      !providerQuery.isLoading &&
      !providerQuery.isError &&
      providerQuery.provider
    ) {
      navigate({ to: '/provider', replace: true })
    }
  }, [
    navigate,
    providerQuery.isError,
    providerQuery.isLoading,
    providerQuery.provider,
  ])

  useEffect(() => {
    if (website) return
    setVerifyWebsite(false)
    setWebsiteEvidence(null)
  }, [website])

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview('')
      return
    }
    const previewURL = URL.createObjectURL(logoFile)
    setLogoPreview(previewURL)
    return () => URL.revokeObjectURL(previewURL)
  }, [logoFile])

  if (providerQuery.isError) {
    return <ProviderPageError onRetry={() => void providerQuery.refetch()} />
  }

  if (providerQuery.isLoading || providerQuery.provider) {
    return <ProviderPageSkeleton />
  }

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
  const nameField = form.register('name')

  return (
    <Main>
      <div className='min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-6'>
        <div className='mx-auto flex w-full max-w-3xl flex-col gap-6'>
          <div>
            <div className='bg-primary/10 text-primary mb-3 flex size-11 items-center justify-center rounded-xl'>
              <Store className='size-5' aria-hidden='true' />
            </div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {t('Open Channel Supply')}
            </h1>
            <p className='text-muted-foreground mt-2 max-w-2xl text-sm'>
              {t(
                'Create your provider profile first. Supply channels will be configured in the next step.'
              )}
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('Provider profile')}</CardTitle>
              <CardDescription>
                {t('This information is shown with the services you provide.')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className='grid gap-5'
                >
                  <div className='grid gap-2'>
                    <Label htmlFor='provider-name'>{t('Provider name')}</Label>
                    <Input
                      id='provider-name'
                      {...nameField}
                      onChange={(event) => {
                        void nameField.onChange(event)
                        if (!form.getFieldState('slug').isDirty) {
                          form.setValue(
                            'slug',
                            providerSlugFromName(event.target.value),
                            { shouldValidate: true }
                          )
                        }
                      }}
                      autoFocus
                    />
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
                    <Label htmlFor='provider-website'>{t('Website')}</Label>
                    <Input
                      id='provider-website'
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
                      <div className='flex items-start gap-3'>
                        <Checkbox
                          id='provider-verify-website'
                          checked={verifyWebsite}
                          onCheckedChange={(checked) => {
                            const enabled = checked === true
                            setVerifyWebsite(enabled)
                            if (!enabled) setWebsiteEvidence(null)
                          }}
                        />
                        <div className='grid gap-1'>
                          <Label htmlFor='provider-verify-website'>
                            {t('Verify website ownership (recommended)')}
                          </Label>
                          <p className='text-muted-foreground text-xs'>
                            {t(
                              'Verification publishes your official website with verified ownership and lets the administrator enable the clean subdomain.'
                            )}
                          </p>
                        </div>
                      </div>

                      {verifyWebsite ? (
                        <div className='grid gap-2 border-t pt-4'>
                          <Label htmlFor='provider-onboarding-evidence'>
                            {t('Verification screenshot')}
                          </Label>
                          <Input
                            id='provider-onboarding-evidence'
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
                        <div className='bg-muted/30 flex items-start gap-2 rounded-md px-3 py-2 text-xs'>
                          <ShieldCheck className='text-muted-foreground mt-0.5 size-4 shrink-0' />
                          <p className='text-muted-foreground'>
                            {t(
                              'Without verification, the website stays private and the suffixed subdomain becomes fixed after onboarding approval.'
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className='grid gap-2'>
                    <Label htmlFor='provider-slug'>
                      {t('Provider subdomain')}
                    </Label>
                    <InputGroup>
                      <InputGroupInput
                        id='provider-slug'
                        autoCapitalize='none'
                        autoCorrect='off'
                        spellCheck={false}
                        placeholder='your-name'
                        {...form.register('slug')}
                      />
                      <InputGroupAddon align='inline-end'>
                        -xxxx.{getProviderRootDomain()}
                      </InputGroupAddon>
                    </InputGroup>
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'The platform first assigns a suffixed subdomain. If website ownership is verified before onboarding approval, the administrator can promote it to the clean subdomain; after approval, the active subdomain is fixed.'
                      )}
                    </p>
                    {form.formState.errors.slug && (
                      <p className='text-destructive text-sm'>
                        {t(
                          form.formState.errors.slug.message ??
                            'Provider subdomain must use 1-63 lowercase letters, numbers, or hyphens'
                        )}
                      </p>
                    )}
                  </div>

                  <div className='grid gap-2'>
                    <Label htmlFor='provider-description'>
                      {t('Description')}
                    </Label>
                    <p className='text-muted-foreground text-xs'>
                      {t('Supports Markdown formatting.')}
                    </p>
                    <Textarea
                      id='provider-description'
                      className='min-h-28 resize-y'
                      placeholder={t('Describe the services you provide')}
                      {...form.register('description')}
                    />
                    {form.watch('description').trim() && (
                      <div className='bg-muted/30 rounded-md border p-3'>
                        <p className='text-muted-foreground mb-2 text-xs font-medium'>
                          {t('Markdown preview')}
                        </p>
                        <RichContent
                          content={form.watch('description')}
                          breaks
                        />
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
                      <Label htmlFor='provider-logo'>
                        {t('Provider logo')}
                      </Label>
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'Upload a logo for your public provider page. This is the default option for providers without their own website.'
                        )}
                      </p>
                    </div>
                    <Input
                      id='provider-logo'
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

                  <ProviderContactFields form={form} idPrefix='provider' />

                  <div className='flex justify-end border-t pt-5'>
                    <Button type='submit' disabled={mutation.isPending}>
                      <Plus className='size-4' aria-hidden='true' />
                      {mutation.isPending
                        ? t('Submitting...')
                        : t('Submit application')}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </Main>
  )
}

export function ProviderWorkspace() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = useState(false)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [editorChannel, setEditorChannel] = useState<HubProviderChannel | null>(
    null
  )
  const [probeChannel, setProbeChannel] = useState<HubProviderChannel | null>(
    null
  )
  const [channelToDelete, setChannelToDelete] =
    useState<HubProviderChannel | null>(null)
  const providerQuery = useProvider()
  const logoURL = useProviderLogoURL(providerQuery.provider?.logo_url)
  const deleteMutation = useMutation({
    mutationFn: async (channelId: number) => {
      const response = await deleteProviderChannel(channelId)
      if (!response.success) {
        throw new Error(response.message || t('Failed to delete channel'))
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: providerChannelsQueryKey,
      })
      setChannelToDelete(null)
      toast.success(t('Channel deleted'))
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : t('Failed to delete channel')
      ),
  })

  useEffect(() => {
    if (
      !providerQuery.isLoading &&
      !providerQuery.isError &&
      !providerQuery.provider
    ) {
      navigate({ to: '/provider/onboarding', replace: true })
    }
  }, [
    navigate,
    providerQuery.isError,
    providerQuery.isLoading,
    providerQuery.provider,
  ])

  if (providerQuery.isError) {
    return (
      <ProviderPageError
        onRetry={() => {
          void providerQuery.refetch()
        }}
      />
    )
  }

  if (providerQuery.isLoading || !providerQuery.provider) {
    return <ProviderPageSkeleton />
  }

  const provider = providerQuery.provider
  if (provider.status !== 'active') {
    return (
      <ProviderApplicationState
        provider={provider}
        onSaved={(response) => {
          queryClient.setQueryData(providerQueryKey, response)
        }}
      />
    )
  }
  const initials = provider.name.slice(0, 1).toUpperCase()

  const openCreateChannel = () => {
    setEditorChannel(null)
    setEditorOpen(true)
  }

  return (
    <Main>
      <div className='flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-6'>
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-6'>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {t('Channel Supply')}
            </h1>
            <p className='text-muted-foreground mt-2 text-sm'>
              {t('Manage the services you provide.')}
            </p>
          </div>

          <Card>
            <CardContent className='flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6'>
              <div className='flex min-w-0 items-center gap-4'>
                <Avatar className='size-14 rounded-2xl'>
                  <AvatarImage src={logoURL || undefined} alt='' />
                  <AvatarFallback className='bg-primary/10 text-primary rounded-2xl text-lg'>
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <h2 className='truncate text-lg font-semibold'>
                      {provider.name}
                    </h2>
                    <StatusBadge
                      label={t('Active')}
                      variant='success'
                      copyable={false}
                    />
                  </div>
                  {provider.website && (
                    <a
                      href={provider.website}
                      target='_blank'
                      rel='noreferrer'
                      className='text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1 text-sm'
                    >
                      <Globe2 className='size-3.5' aria-hidden='true' />
                      {provider.website}
                    </a>
                  )}
                </div>
              </div>
              <div className='flex w-full flex-col gap-3 sm:w-auto sm:items-end'>
                <div className='grid w-full gap-2 sm:flex sm:w-auto'>
                  <Button
                    type='button'
                    size='lg'
                    render={
                      <a
                        href={getProviderPublicURL(provider.slug)}
                        target='_blank'
                        rel='noreferrer'
                      />
                    }
                  >
                    <ExternalLink className='size-4' aria-hidden='true' />
                    {t('Preview public homepage')}
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='lg'
                    onClick={() => setProfileEditorOpen(true)}
                  >
                    <Pencil className='size-4' aria-hidden='true' />
                    {t('Edit public profile')}
                  </Button>
                </div>
                <div className='text-muted-foreground flex items-center gap-2 text-sm'>
                  <Building2 className='size-4' aria-hidden='true' />
                  {t('Provider status')}: {t('Active')}
                </div>
              </div>
            </CardContent>
          </Card>

          <ProviderEarningsSummary />

          {provider.website &&
            provider.website_verification_status !== 'verified' && (
              <ProviderWebsiteVerification
                provider={provider}
                onSaved={(response) => {
                  queryClient.setQueryData(providerQueryKey, response)
                }}
              />
            )}

          {provider.origin_verification_enabled && <ProviderOriginClaims />}

          <ProviderProfileDialog
            open={profileEditorOpen}
            onOpenChange={setProfileEditorOpen}
            provider={provider}
            onSaved={(response) => {
              queryClient.setQueryData(providerQueryKey, response)
            }}
          />

          <section className='space-y-4'>
            <div className='flex flex-row items-start justify-between gap-4'>
              <div>
                <h2 className='text-lg font-semibold'>
                  {t('Supply Channels')}
                </h2>
                <p className='text-muted-foreground mt-1 text-sm'>
                  {t(
                    'Each channel keeps its complete upstream configuration, supply multiplier, and listing state.'
                  )}
                </p>
              </div>
              <Button type='button' onClick={openCreateChannel}>
                <Plus className='size-4' aria-hidden='true' />
                {t('Create Supply Channel')}
              </Button>
            </div>
            <div className='min-h-0'>
              <ProviderChannelsTable
                enabled
                onCreate={openCreateChannel}
                onManageModels={setProbeChannel}
                onEdit={(item) => {
                  setEditorChannel(item)
                  setEditorOpen(true)
                }}
                onDelete={setChannelToDelete}
              />
            </div>
          </section>
        </div>
      </div>
      <ChannelMutateDrawer
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditorChannel(null)
        }}
        currentRow={editorChannel?.channel ?? null}
        mode='provider'
        transport={providerChannelTransport}
        supplySettings={
          editorChannel
            ? {
                price_multiplier: editorChannel.supply.price_multiplier,
                text_probe_minutes: editorChannel.supply.text_probe_minutes,
                image_probe_minutes: editorChannel.supply.image_probe_minutes,
              }
            : DEFAULT_HUB_SUPPLY_SETTINGS
        }
        onSuccess={() =>
          void queryClient.invalidateQueries({
            queryKey: providerChannelsQueryKey,
          })
        }
      />
      <ProviderChannelModelsDialog
        providerChannel={probeChannel}
        open={Boolean(probeChannel)}
        onOpenChange={(open) => {
          if (!open) setProbeChannel(null)
        }}
      />
      <ConfirmDialog
        open={Boolean(channelToDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setChannelToDelete(null)
        }}
        title={t('Delete Supply Channel?')}
        desc={
          <div className='space-y-2'>
            <p>
              {t('The channel {{name}} will be permanently deleted.', {
                name: channelToDelete?.channel.name ?? '',
              })}
            </p>
            <p>
              {t(
                'Its listing state, probe results, and historical probe samples will also be deleted.'
              )}
            </p>
          </div>
        }
        confirmText={t('Delete')}
        destructive
        isLoading={deleteMutation.isPending}
        handleConfirm={() => {
          if (channelToDelete) {
            deleteMutation.mutate(channelToDelete.channel.id)
          }
        }}
      />
    </Main>
  )
}
