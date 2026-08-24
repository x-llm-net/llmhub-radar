/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { TenantAdminTenant } from '@/features/tenant-admin/types'
import { cn } from '@/lib/utils'

import {
  adminProviderOwnerCandidatesQueryKey,
  adminProvidersQueryKey,
  createAdminProvider,
  getAdminProviderOwnerCandidates,
} from './api'
import type { HubProviderOwnerCandidate } from './types'

type ProviderCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  isPlatformAdmin: boolean
  tenants: TenantAdminTenant[]
}

type ProviderFormState = {
  name: string
  slug: string
  website: string
  description: string
  contact_type: string
  contact_value: string
  support_type: string
  support_value: string
}

const initialForm: ProviderFormState = {
  name: '',
  slug: '',
  website: '',
  description: '',
  contact_type: 'qq',
  contact_value: '',
  support_type: 'community',
  support_value: '',
}

function slugFromName(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 63)
}

function candidateLabel(candidate: HubProviderOwnerCandidate) {
  return candidate.display_name || candidate.username
}

function OwnerPicker(props: {
  value: HubProviderOwnerCandidate | null
  onChange: (candidate: HubProviderOwnerCandidate) => void
  open: boolean
}) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const candidatesQuery = useQuery({
    queryKey: [...adminProviderOwnerCandidatesQueryKey, search],
    queryFn: () => getAdminProviderOwnerCandidates(search),
    enabled: props.open && pickerOpen,
  })
  const candidates = candidatesQuery.data?.data?.items ?? []

  return (
    <Popover
      open={pickerOpen}
      onOpenChange={(nextOpen) => {
        setPickerOpen(nextOpen)
        if (!nextOpen) setSearch('')
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            role='combobox'
            aria-expanded={pickerOpen}
            className='w-full justify-between text-start font-normal'
          />
        }
      >
        <span className='min-w-0 truncate'>
          {props.value ? (
            <>
              <span className='font-medium'>{candidateLabel(props.value)}</span>
              <span className='text-muted-foreground ml-2 text-xs'>
                @{props.value.username}
              </span>
            </>
          ) : (
            <span className='text-muted-foreground'>
              {t('Select an owner')}
            </span>
          )}
        </span>
        <ChevronsUpDown className='size-4 shrink-0 opacity-50' />
      </PopoverTrigger>
      <PopoverContent
        className='w-[var(--anchor-width)] overflow-hidden p-0'
        align='start'
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('Search enabled users...')}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {candidatesQuery.isLoading ? (
              <p className='text-muted-foreground px-3 py-6 text-center text-sm'>
                {t('Loading users...')}
              </p>
            ) : (
              <CommandEmpty>{t('No eligible users found')}</CommandEmpty>
            )}
            <CommandGroup>
              {candidates.map((candidate) => (
                <CommandItem
                  key={candidate.id}
                  value={String(candidate.id)}
                  onSelect={() => {
                    props.onChange(candidate)
                    setPickerOpen(false)
                    setSearch('')
                  }}
                >
                  <Check
                    className={cn(
                      'size-4',
                      props.value?.id === candidate.id
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate font-medium'>
                      {candidateLabel(candidate)}
                    </span>
                    <span className='text-muted-foreground block truncate text-xs'>
                      @{candidate.username}
                      {candidate.email ? ` · ${candidate.email}` : ''}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function ProviderCreateDialog(props: ProviderCreateDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initialForm)
  const [slugDirty, setSlugDirty] = useState(false)
  const [owner, setOwner] = useState<HubProviderOwnerCandidate | null>(null)
  const [tenantId, setTenantId] = useState('')

  useEffect(() => {
    if (!props.open) return
    setForm(initialForm)
    setSlugDirty(false)
    setOwner(null)
    setTenantId('')
  }, [props.open])

  const mutation = useMutation({
    mutationFn: () => {
      if (!owner) throw new Error(t('Owner user is required'))
      if (props.isPlatformAdmin && !tenantId) {
        throw new Error(t('Tenant is required'))
      }
      return createAdminProvider({
        ...form,
        owner_user_id: owner.id,
        ...(props.isPlatformAdmin ? { tenant_id: Number(tenantId) } : {}),
      })
    },
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to create provider'))
        return
      }
      await queryClient.invalidateQueries({ queryKey: adminProvidersQueryKey })
      toast.success(t('Provider created'))
      props.onOpenChange(false)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('Failed to create provider')
      )
    },
  })

  const setField = (field: keyof ProviderFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }
  const canSubmit = Boolean(
    owner &&
    form.name.trim() &&
    form.slug.trim() &&
    form.contact_value.trim() &&
    (!props.isPlatformAdmin || tenantId)
  )

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!mutation.isPending) props.onOpenChange(open)
      }}
      title={t('Create provider as administrator')}
      description={t('Create and activate a provider for an existing user.')}
      contentClassName='sm:max-w-2xl'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            disabled={mutation.isPending}
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className='animate-spin' />}
            {t('Create provider')}
          </Button>
        </>
      }
    >
      <div className='grid gap-5'>
        {props.isPlatformAdmin && (
          <div className='grid gap-2'>
            <Label htmlFor='admin-provider-tenant'>{t('Tenant')}</Label>
            <Select
              value={tenantId}
              onValueChange={(value) => value && setTenantId(value)}
            >
              <SelectTrigger id='admin-provider-tenant' className='w-full'>
                <SelectValue placeholder={t('Select a tenant')}>
                  {props.tenants.find(
                    (tenant) => String(tenant.id) === tenantId
                  )?.name || t('Select a tenant')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {props.tenants
                    .filter((tenant) => tenant.status === 'active')
                    .map((tenant) => (
                      <SelectItem key={tenant.id} value={String(tenant.id)}>
                        {tenant.name} ({tenant.slug})
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className='grid gap-2'>
          <Label htmlFor='admin-provider-owner'>{t('Provider owner')}</Label>
          <OwnerPicker open={props.open} value={owner} onChange={setOwner} />
          <p className='text-muted-foreground text-xs'>
            {t(
              'Only enabled users without an existing provider can be selected.'
            )}
          </p>
        </div>

        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='grid gap-2'>
            <Label htmlFor='admin-provider-name'>{t('Provider name')}</Label>
            <Input
              id='admin-provider-name'
              value={form.name}
              onChange={(event) => {
                const value = event.target.value
                setField('name', value)
                if (!slugDirty) setField('slug', slugFromName(value))
              }}
              autoFocus
            />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='admin-provider-slug'>
              {t('Provider subdomain')}
            </Label>
            <Input
              id='admin-provider-slug'
              value={form.slug}
              onChange={(event) => {
                setSlugDirty(true)
                setField('slug', event.target.value)
              }}
              placeholder='your-name'
              autoCapitalize='none'
              autoCorrect='off'
              spellCheck={false}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'The platform appends a short code until website ownership is verified.'
              )}
            </p>
          </div>
        </div>

        <div className='grid gap-2'>
          <Label htmlFor='admin-provider-website'>
            {t('Website')}{' '}
            <span className='text-muted-foreground font-normal'>
              ({t('Optional')})
            </span>
          </Label>
          <Input
            id='admin-provider-website'
            type='url'
            value={form.website}
            onChange={(event) => setField('website', event.target.value)}
            placeholder='https://example.com'
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              'Website ownership is not verified in this form; the provider keeps the suffixed subdomain.'
            )}
          </p>
        </div>

        <div className='grid gap-2'>
          <Label htmlFor='admin-provider-description'>{t('Description')}</Label>
          <Textarea
            id='admin-provider-description'
            value={form.description}
            onChange={(event) => setField('description', event.target.value)}
            placeholder={t('Describe the services you provide')}
            className='min-h-24 resize-y'
            maxLength={1000}
          />
        </div>

        <div className='grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]'>
          <div className='grid gap-2'>
            <Label htmlFor='admin-provider-contact-type'>
              {t('Review contact type')}
            </Label>
            <Select
              value={form.contact_type}
              onValueChange={(value) =>
                value && setField('contact_type', value)
              }
            >
              <SelectTrigger
                id='admin-provider-contact-type'
                className='w-full'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value='qq'>QQ</SelectItem>
                  <SelectItem value='wechat'>{t('WeChat')}</SelectItem>
                  <SelectItem value='telegram'>Telegram</SelectItem>
                  <SelectItem value='email'>{t('Email')}</SelectItem>
                  <SelectItem value='phone'>{t('Phone')}</SelectItem>
                  <SelectItem value='other'>{t('Other')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='admin-provider-contact-value'>
              {t('Review contact')}
            </Label>
            <Input
              id='admin-provider-contact-value'
              value={form.contact_value}
              onChange={(event) =>
                setField('contact_value', event.target.value)
              }
              placeholder={t('Contact account or address')}
              required
            />
          </div>
        </div>

        <div className='grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]'>
          <div className='grid gap-2'>
            <Label htmlFor='admin-provider-support-type'>
              {t('Public support type')}
            </Label>
            <Select
              value={form.support_type}
              onValueChange={(value) =>
                value && setField('support_type', value)
              }
            >
              <SelectTrigger
                id='admin-provider-support-type'
                className='w-full'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value='community'>{t('Community')}</SelectItem>
                  <SelectItem value='qq_group'>{t('QQ group')}</SelectItem>
                  <SelectItem value='telegram_group'>
                    {t('Telegram group')}
                  </SelectItem>
                  <SelectItem value='customer_service'>
                    {t('Customer service')}
                  </SelectItem>
                  <SelectItem value='announcement'>
                    {t('Announcement channel')}
                  </SelectItem>
                  <SelectItem value='email'>{t('Email')}</SelectItem>
                  <SelectItem value='other'>{t('Other')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='admin-provider-support-value'>
              {t('Public support entry')}
            </Label>
            <Input
              id='admin-provider-support-value'
              value={form.support_value}
              onChange={(event) =>
                setField('support_value', event.target.value)
              }
              placeholder={t('Optional support link or account')}
            />
          </div>
        </div>
      </div>
    </Dialog>
  )
}
