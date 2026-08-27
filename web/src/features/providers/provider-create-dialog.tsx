/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
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
import { Switch } from '@/components/ui/switch'
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
  use_provisional_slug: boolean
}

const initialForm: ProviderFormState = {
  name: '',
  slug: '',
  website: '',
  description: '',
  contact_type: 'qq',
  contact_value: '',
  support_type: 'qq_group',
  support_value: '',
  use_provisional_slug: true,
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
  tenantId?: number
  requiresTenant: boolean
}) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const candidatesQuery = useQuery({
    queryKey: [...adminProviderOwnerCandidatesQueryKey, props.tenantId, search],
    queryFn: () => getAdminProviderOwnerCandidates(search, props.tenantId),
    enabled:
      props.open && pickerOpen && (!props.requiresTenant || !!props.tenantId),
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
            disabled={props.requiresTenant && !props.tenantId}
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
  const contactTypeOptions = [
    { value: 'qq', label: 'QQ' },
    { value: 'wechat', label: t('WeChat') },
    { value: 'telegram', label: 'Telegram' },
    { value: 'email', label: t('Email') },
    { value: 'phone', label: t('Phone') },
    { value: 'other', label: t('Other') },
  ]
  const supportTypeOptions = [
    { value: 'community', label: t('Community') },
    { value: 'qq_group', label: t('QQ group') },
    { value: 'telegram_group', label: t('Telegram group') },
    { value: 'customer_service', label: t('Customer service') },
    { value: 'announcement', label: t('Announcement channel') },
    { value: 'email', label: t('Email') },
    { value: 'other', label: t('Other') },
  ]

  /* oxlint-disable react/set-state-in-effect -- Reset all modal state for a new create flow. */
  useEffect(() => {
    if (!props.open) return
    setForm(initialForm)
    setSlugDirty(false)
    setOwner(null)
    setTenantId('')
  }, [props.open])
  /* oxlint-enable react/set-state-in-effect */

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

  const validateForm = () => {
    if (props.isPlatformAdmin && !tenantId) {
      toast.error(t('Tenant is required'))
      return false
    }
    if (!owner) {
      toast.error(t('Owner user is required'))
      return false
    }
    if (!form.name.trim()) {
      toast.error(t('Provider name is required'))
      return false
    }
    if (!form.slug.trim()) {
      toast.error(t('Provider subdomain is required'))
      return false
    }
    if (!form.contact_value.trim()) {
      toast.error(t('Review contact is required'))
      return false
    }
    return true
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validateForm() || mutation.isPending) return
    mutation.mutate()
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!mutation.isPending) props.onOpenChange(open)
      }}
      title={t('Create provider')}
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
            type='submit'
            form='admin-provider-create-form'
            disabled={mutation.isPending}
          >
            {mutation.isPending && <Loader2 className='animate-spin' />}
            {t('Create provider')}
          </Button>
        </>
      }
    >
      <form
        id='admin-provider-create-form'
        className='grid gap-5'
        onSubmit={handleSubmit}
      >
        {props.isPlatformAdmin && (
          <div className='grid gap-2'>
            <Label htmlFor='admin-provider-tenant'>{t('Tenant')}</Label>
            <Select
              value={tenantId}
              onValueChange={(value) => {
                if (!value) return
                setTenantId(value)
                setOwner(null)
              }}
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
          <OwnerPicker
            open={props.open}
            value={owner}
            onChange={setOwner}
            tenantId={tenantId ? Number(tenantId) : undefined}
            requiresTenant={props.isPlatformAdmin}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              'Only enabled users without an existing provider in this tenant can be selected.'
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
              {form.use_provisional_slug
                ? t(
                    'The platform appends a short code until website ownership is verified.'
                  )
                : t(
                    'The clean subdomain is used when the requested name is available.'
                  )}
            </p>
          </div>
        </div>

        <div className='flex items-start justify-between gap-4 rounded-lg border p-3'>
          <div className='grid gap-1'>
            <Label htmlFor='admin-provider-provisional-slug'>
              {t('Use a short-code subdomain')}
            </Label>
            <p className='text-muted-foreground text-xs'>
              {form.use_provisional_slug
                ? t(
                    'The platform adds a short code to make this subdomain safer to allocate.'
                  )
                : t(
                    'Use the clean subdomain when the requested name is available.'
                  )}
            </p>
          </div>
          <Switch
            id='admin-provider-provisional-slug'
            checked={form.use_provisional_slug}
            onCheckedChange={(checked) =>
              setForm((current) => ({
                ...current,
                use_provisional_slug: checked,
              }))
            }
            aria-label={t('Use a short-code subdomain')}
          />
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
                <SelectValue>
                  {
                    contactTypeOptions.find(
                      (option) => option.value === form.contact_type
                    )?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {contactTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
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
                <SelectValue>
                  {
                    supportTypeOptions.find(
                      (option) => option.value === form.support_type
                    )?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {supportTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
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
      </form>
    </Dialog>
  )
}
