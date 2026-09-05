import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  ChevronDown,
  KeyRound,
  RefreshCw,
  Settings2,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm, type SubmitErrorHandler } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
  sideDrawerSwitchItemClassName,
} from '@/components/drawer-layout'
import { areServiceTierGroups } from '@/components/group-badge-utils'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useStatus } from '@/hooks/use-status'
import { getUserModels, getUserGroups } from '@/lib/api'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { cn } from '@/lib/utils'

import {
  createApiKey,
  updateApiKey,
  getApiKey,
  getTokenAutoGroups,
  getHubTokenRoutingOptions,
} from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  getApiKeyFormSchema,
  type ApiKeyFormValues,
  getApiKeyFormDefaultValues,
  transformFormDataToPayload,
  transformApiKeyToFormDefaults,
} from '../lib'
import type { ApiKey } from '../types'
import {
  ApiKeyGroupCombobox,
  type ApiKeyGroupOption,
} from './api-key-group-combobox'
import { useApiKeys } from './api-keys-provider'
import { AutoGroupOrderEditor } from './auto-group-order-editor'
import { HubRoutingPolicyEditor } from './hub-routing-policy-editor'

const SERVICE_TIER_ORDER = ['special', 'low', 'medium', 'high'] as const

const SERVICE_TIER_I18N = {
  special: {
    label: 'Special price',
    desc: 'Lowest-cost approved supply',
  },
  low: {
    label: 'Economy',
    desc: 'Budget routing within this price tier',
  },
  medium: {
    label: 'Standard',
    desc: 'Balanced routing within this price tier',
  },
  high: {
    label: 'High quality',
    desc: 'Admin-approved high-quality sources',
  },
} as const

type ApiKeyMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: ApiKey
}

export function ApiKeysMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: ApiKeyMutateDrawerProps) {
  const { t } = useTranslation()
  const isUpdate = !!currentRow
  const currentRowId = currentRow?.id
  const { triggerRefresh } = useApiKeys()
  const { status, loading: statusLoading } = useStatus()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [initializedTarget, setInitializedTarget] = useState<string | null>(
    null
  )
  const defaultUseAutoGroup = status?.default_use_auto_group === true

  // Fetch models
  const { data: modelsData } = useQuery({
    queryKey: ['user-models'],
    queryFn: getUserModels,
    enabled: open,
    staleTime: 0,
  })

  // Fetch groups
  const {
    data: groupsData,
    isFetched: groupsFetched,
    isFetching: groupsFetching,
  } = useQuery({
    queryKey: ['user-groups'],
    queryFn: getUserGroups,
    enabled: open,
    staleTime: 0,
  })

  const {
    data: apiKeyData,
    isFetched: apiKeyFetched,
    isFetching: apiKeyFetching,
  } = useQuery({
    queryKey: ['api-key', currentRowId],
    queryFn: () => getApiKey(currentRowId ?? 0),
    enabled: open && isUpdate && currentRowId !== undefined,
    staleTime: 0,
  })

  const editingLegacyKey = !!(
    isUpdate &&
    apiKeyFetched &&
    apiKeyData?.success === true &&
    apiKeyData.data &&
    !apiKeyData.data.hub_routing_policy
  )
  const editingProviderId =
    isUpdate &&
    apiKeyFetched &&
    apiKeyData?.data?.hub_routing_policy?.mode === 'provider'
      ? apiKeyData.data.hub_routing_policy.provider_id
      : undefined
  const requiresHubRouting = !isUpdate || (apiKeyFetched && !editingLegacyKey)
  const {
    data: routingOptionsData,
    isFetching: routingOptionsFetching,
    isError: routingOptionsError,
    refetch: refetchRoutingOptions,
  } = useQuery({
    queryKey: [
      'hub-token-routing-options',
      window.location.hostname,
      editingProviderId,
    ],
    queryFn: () => getHubTokenRoutingOptions(editingProviderId),
    enabled: open && requiresHubRouting,
    staleTime: 15_000,
    retry: false,
  })

  const {
    data: autoGroupsData,
    isFetched: autoGroupsFetched,
    isFetching: autoGroupsFetching,
  } = useQuery({
    queryKey: ['token-auto-groups'],
    queryFn: getTokenAutoGroups,
    enabled: open,
    staleTime: 0,
  })

  const models = modelsData?.data || []
  const groups = useMemo<ApiKeyGroupOption[]>(() => {
    const allGroups = Object.entries(groupsData?.data || {}).map(
      ([key, info]) => ({
        value: key,
        label: key,
        desc: info.desc || key,
        ratio: info.ratio,
      })
    )
    const groupsByValue = new Map(
      allGroups.map((group) => [group.value, group])
    )
    const serviceTiers = SERVICE_TIER_ORDER.flatMap((tier) => {
      const group = groupsByValue.get(tier)
      if (!group) return []
      const meta = SERVICE_TIER_I18N[tier]
      return [
        {
          value: group.value,
          label: t(meta.label),
          desc: t(meta.desc),
        },
      ]
    })
    return serviceTiers.length === SERVICE_TIER_ORDER.length
      ? serviceTiers
      : allGroups
  }, [groupsData, t])
  const usesServiceTiers = areServiceTierGroups(
    groups.map((group) => group.value)
  )
  const backendHasAuto = groups.some((g) => g.value === 'auto')
  const availableAutoGroupNames = useMemo(
    () => groups.filter((group) => group.value !== 'auto').map((g) => g.value),
    [groups]
  )
  const globalAutoGroups = useMemo(() => {
    const available = new Set(availableAutoGroupNames)
    return (autoGroupsData?.data?.groups || []).filter((group) =>
      available.has(group)
    )
  }, [autoGroupsData, availableAutoGroupNames])
  const globalAutoGroupOptions = useMemo(() => {
    const groupsByValue = new Map(groups.map((group) => [group.value, group]))
    return globalAutoGroups.flatMap((group) => {
      const option = groupsByValue.get(group)
      return option ? [option] : []
    })
  }, [globalAutoGroups, groups])
  const maxAutoGroups =
    Number.isInteger(autoGroupsData?.data?.max_count) &&
    Number(autoGroupsData?.data?.max_count) > 0
      ? Number(autoGroupsData?.data?.max_count)
      : 5
  const schema = useMemo(
    () => getApiKeyFormSchema(t, maxAutoGroups),
    [t, maxAutoGroups]
  )
  const routingOptions = routingOptionsData?.success
    ? routingOptionsData.data
    : undefined
  const hubRoutingEnabled = requiresHubRouting && !!routingOptions
  const routingOptionsUnavailable =
    requiresHubRouting &&
    !routingOptionsFetching &&
    (routingOptionsError || !routingOptions)

  const form = useForm<ApiKeyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: getApiKeyFormDefaultValues(defaultUseAutoGroup),
  })

  // Load existing data when updating
  useEffect(() => {
    if (!open) {
      setInitializedTarget(null)
      return
    }
    if (
      !groupsFetched ||
      groupsFetching ||
      !autoGroupsFetched ||
      autoGroupsFetching
    ) {
      return
    }
    if (isUpdate && (!apiKeyFetched || apiKeyFetching)) return
    if (!isUpdate && statusLoading) return

    const target = isUpdate && currentRow ? `update:${currentRow.id}` : 'create'
    if (initializedTarget === target) return
    if (isUpdate && currentRow) {
      if (apiKeyData?.success && apiKeyData.data) {
        form.reset(
          transformApiKeyToFormDefaults(
            apiKeyData.data,
            availableAutoGroupNames,
            maxAutoGroups
          )
        )
        setInitializedTarget(target)
      }
    } else {
      form.reset(
        getApiKeyFormDefaultValues(defaultUseAutoGroup && backendHasAuto)
      )
      setInitializedTarget(target)
    }
  }, [
    open,
    isUpdate,
    currentRow,
    form,
    defaultUseAutoGroup,
    statusLoading,
    backendHasAuto,
    groupsFetched,
    groupsFetching,
    autoGroupsFetched,
    autoGroupsFetching,
    apiKeyData,
    apiKeyFetched,
    apiKeyFetching,
    availableAutoGroupNames,
    maxAutoGroups,
    initializedTarget,
  ])

  const formTarget =
    isUpdate && currentRow ? `update:${currentRow.id}` : 'create'
  const isFormInitialized = initializedTarget === formTarget
  const selectedGroup = form.watch('group')

  // Correct group after groups load: if the form value is not in available groups, fall back
  useEffect(() => {
    if (groups.length === 0) return
    const currentGroup = selectedGroup
    if (
      !hubRoutingEnabled &&
      currentGroup &&
      !groups.some((g) => g.value === currentGroup)
    ) {
      const fallback = usesServiceTiers
        ? ''
        : (groups.find((g) => g.value === 'default')?.value ??
          groups[0]?.value ??
          '')
      form.setValue('group', fallback)
      if (currentGroup === 'auto') {
        form.setValue('auto_groups', [])
        form.setValue('auto_groups_mode', 'inherit')
        form.setValue('cross_group_retry', false)
      }
    }
  }, [groups, form, selectedGroup, usesServiceTiers, hubRoutingEnabled])

  useEffect(() => {
    if (hubRoutingEnabled && selectedGroup !== 'default') {
      form.setValue('group', 'default', { shouldValidate: false })
    }
  }, [form, hubRoutingEnabled, selectedGroup])

  const onSubmit = async (data: ApiKeyFormValues) => {
    setIsSubmitting(true)
    try {
      if (requiresHubRouting && !routingOptions) {
        toast.error(
          t(
            'Routing options are unavailable. Retry before saving this API key.'
          )
        )
        return
      }
      if (routingOptions && data.hub_selections.length === 0) {
        toast.error(t('Add at least one model family'))
        return
      }
      if (
        routingOptions?.mode === 'provider' &&
        data.hub_selections.some((selection) => {
          const modelOption = routingOptions.models?.find(
            (item) => item.model === selection.model
          )
          const option =
            modelOption ||
            routingOptions.families.find(
              (family) => family.key === selection.family
            )
          const selectedMultipliers =
            selection.multipliers || selection.exact_multipliers || []
          return (
            !option ||
            selectedMultipliers.length === 0 ||
            selectedMultipliers.some(
              (selectedMultiplier) =>
                !option.exact_multipliers?.some(
                  (multiplier) =>
                    Math.abs(multiplier - selectedMultiplier) < 0.0005
                )
            )
          )
        })
      ) {
        toast.error(t('Remove unavailable routes before saving'))
        return
      }
      const basePayload = transformFormDataToPayload(data, routingOptions)

      if (isUpdate && currentRow) {
        const result = await updateApiKey({
          ...basePayload,
          id: currentRow.id,
        })
        if (result.success) {
          toast.success(t(SUCCESS_MESSAGES.API_KEY_UPDATED))
          onOpenChange(false)
          triggerRefresh()
        } else {
          toast.error(result.message || t(ERROR_MESSAGES.UPDATE_FAILED))
        }
      } else {
        // Create mode - handle batch creation
        const count = data.tokenCount || 1
        let successCount = 0

        for (let i = 0; i < count; i++) {
          const result = await createApiKey({
            ...basePayload,
            name:
              i === 0 && data.name
                ? data.name
                : `${data.name || 'default'}-${Math.random().toString(36).slice(2, 8)}`,
          })
          if (result.success) {
            successCount++
          } else {
            toast.error(result.message || t(ERROR_MESSAGES.CREATE_FAILED))
            break
          }
        }

        if (successCount > 0) {
          toast.success(
            t('Successfully created {{count}} API Key(s)', {
              count: successCount,
            })
          )
          onOpenChange(false)
          triggerRefresh()
        }
      }
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setIsSubmitting(false)
    }
  }

  const onInvalid: SubmitErrorHandler<ApiKeyFormValues> = () => {
    toast.error(t('Please fix the highlighted fields before saving'))
  }

  const handleSetExpiry = (months: number, days: number, hours: number) => {
    if (months === 0 && days === 0 && hours === 0) {
      form.setValue('expired_time', undefined)
      return
    }

    const now = new Date()
    now.setMonth(now.getMonth() + months)
    now.setDate(now.getDate() + days)
    now.setHours(now.getHours() + hours)

    form.setValue('expired_time', now)
  }

  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const quotaLabel = t('Quota ({{currency}})', { currency: currencyLabel })
  const quotaPlaceholder = tokensOnly
    ? t('Enter quota in tokens')
    : t('Enter quota in {{currency}}', { currency: currencyLabel })
  const autoGroupsMode = form.watch('auto_groups_mode')
  const unlimitedQuota = form.watch('unlimited_quota')
  const hubSelections = form.watch('hub_selections')

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) {
          form.reset()
        }
      }}
    >
      <SheetContent
        className={sideDrawerContentClassName('max-w-none sm:!max-w-[620px]')}
      >
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate ? t('Update API Key') : t('Create API Key')}
          </SheetTitle>
          <SheetDescription>
            {isUpdate
              ? t('Update the API key by providing necessary info.')
              : t('Add a new API key by providing necessary info.')}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='api-key-form'
            onSubmit={form.handleSubmit(onSubmit, onInvalid)}
            aria-busy={!isFormInitialized}
            inert={!isFormInitialized || isSubmitting ? true : undefined}
            className={sideDrawerFormClassName('gap-5')}
          >
            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Basic Information')}
                description={t('Set API key basic information')}
                icon={<KeyRound className='size-4' />}
                iconTone='info'
              />
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Name')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('Enter a name')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {requiresHubRouting && routingOptionsFetching && (
                <div className='space-y-3 rounded-md border p-3'>
                  <Skeleton className='h-5 w-44' />
                  <Skeleton className='h-20 w-full' />
                </div>
              )}
              {!routingOptionsFetching && hubRoutingEnabled && (
                <FormField
                  control={form.control}
                  name='hub_selections'
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <HubRoutingPolicyEditor
                          options={routingOptions}
                          value={hubSelections}
                          onChange={(value) => field.onChange(value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {routingOptionsUnavailable && (
                <div
                  role='alert'
                  className='border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-md border p-3'
                >
                  <AlertCircle className='text-destructive mt-0.5 size-4 shrink-0' />
                  <div className='min-w-0 flex-1 space-y-1'>
                    <div className='text-sm font-medium'>
                      {t('Failed to load')}
                    </div>
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'Routing options are unavailable. Retry before saving this API key.'
                      )}
                    </p>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => void refetchRoutingOptions()}
                  >
                    <RefreshCw className='mr-1.5 size-3.5' />
                    {t('Retry')}
                  </Button>
                </div>
              )}
              {editingLegacyKey && (
                <FormField
                  control={form.control}
                  name='group'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {usesServiceTiers ? t('Service tier') : t('Group')}
                      </FormLabel>
                      <FormControl>
                        <ApiKeyGroupCombobox
                          options={groups}
                          value={field.value}
                          onValueChange={(group) => {
                            field.onChange(group)
                            if (group === 'auto') {
                              form.setValue('cross_group_retry', true, {
                                shouldDirty: true,
                              })
                              return
                            }
                            form.setValue('cross_group_retry', false, {
                              shouldDirty: true,
                            })
                          }}
                          placeholder={t(
                            usesServiceTiers
                              ? 'Please select a service tier'
                              : 'Select a group'
                          )}
                          emptyMessage={
                            usesServiceTiers
                              ? t('No service tier found.')
                              : undefined
                          }
                          showRatio={!usesServiceTiers}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {editingLegacyKey && selectedGroup === 'auto' && (
                <FormField
                  control={form.control}
                  name='auto_groups'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Auto group order')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Choose and order the groups this API key will try.'
                        )}
                      </FormDescription>
                      <FormControl>
                        <AutoGroupOrderEditor
                          value={field.value}
                          mode={autoGroupsMode}
                          options={groups}
                          globalOptions={globalAutoGroupOptions}
                          maxCount={maxAutoGroups}
                          onChange={(value) => {
                            form.setValue('auto_groups_mode', value.mode, {
                              shouldDirty: true,
                              shouldValidate: false,
                            })
                            form.setValue(
                              'auto_groups',
                              value.groups.slice(0, maxAutoGroups),
                              {
                                shouldDirty: true,
                                shouldValidate: true,
                              }
                            )
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {editingLegacyKey && selectedGroup === 'auto' && (
                <FormField
                  control={form.control}
                  name='cross_group_retry'
                  render={({ field }) => (
                    <FormItem className={sideDrawerSwitchItemClassName()}>
                      <div className='flex flex-col gap-0.5'>
                        <FormLabel className='text-sm'>
                          {t('Cross-group retry')}
                        </FormLabel>
                        <FormDescription className='line-clamp-2 text-xs sm:line-clamp-none'>
                          {t(
                            'When enabled, if channels in the current group fail, it will try channels in the next group in order.'
                          )}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name='expired_time'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Expiration Time')}</FormLabel>
                    <div className='grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                      <FormControl>
                        <DateTimePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t('Never expires')}
                          className='min-w-0 [&_input[type=time]]:w-24 sm:[&_input[type=time]]:w-32'
                        />
                      </FormControl>
                      <div className='grid grid-cols-4 gap-2 sm:flex'>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='px-2 text-xs sm:px-3 sm:text-sm'
                          onClick={() => handleSetExpiry(0, 0, 0)}
                        >
                          {t('Never')}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='px-2 text-xs sm:px-3 sm:text-sm'
                          onClick={() => handleSetExpiry(1, 0, 0)}
                        >
                          {t('1 Month')}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='px-2 text-xs sm:px-3 sm:text-sm'
                          onClick={() => handleSetExpiry(0, 1, 0)}
                        >
                          {t('1 Day')}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='px-2 text-xs sm:px-3 sm:text-sm'
                          onClick={() => handleSetExpiry(0, 0, 1)}
                        >
                          {t('1 Hour')}
                        </Button>
                      </div>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!isUpdate && (
                <FormField
                  control={form.control}
                  name='tokenCount'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Quantity')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min='1'
                          placeholder={t('Number of keys to create')}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseInt(e.target.value, 10) || 1
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Create multiple API keys at once (random suffix will be added to names)'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </SideDrawerSection>

            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Quota Settings')}
                description={t('Set quota amount and limits')}
                icon={<WalletCards className='size-4' />}
                iconTone='success'
              />
              {!unlimitedQuota && (
                <FormField
                  control={form.control}
                  name='remain_quota_dollars'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{quotaLabel}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          step={tokensOnly ? 1 : 0.01}
                          placeholder={quotaPlaceholder}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseFloat(e.target.value) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {tokensOnly
                          ? t('Enter the quota amount in tokens')
                          : t('Enter the quota amount in {{currency}}', {
                              currency: currencyLabel,
                            })}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name='unlimited_quota'
                render={({ field }) => (
                  <FormItem className={sideDrawerSwitchItemClassName()}>
                    <div className='flex flex-col gap-0.5'>
                      <FormLabel className='text-sm'>
                        {t('Unlimited Quota')}
                      </FormLabel>
                      <FormDescription className='text-xs'>
                        {t('Enable unlimited quota for this API key')}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </SideDrawerSection>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <SideDrawerSection>
                <CollapsibleTrigger
                  render={
                    <button
                      type='button'
                      className='hover:bg-muted/40 flex w-full items-center gap-3 rounded-md py-1.5 text-left transition-colors'
                    />
                  }
                >
                  <SideDrawerSectionHeader
                    className='flex-1'
                    title={t('Advanced Settings')}
                    description={t('Set API key access restrictions')}
                    icon={<Settings2 className='size-4' />}
                  />
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground size-4 shrink-0 transition-transform',
                      advancedOpen && 'rotate-180'
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className='flex flex-col gap-4 pt-2'>
                    <FormField
                      control={form.control}
                      name='model_limits'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Model Limits')}</FormLabel>
                          <FormControl>
                            <MultiSelect
                              options={models.map((m) => ({
                                label: m,
                                value: m,
                              }))}
                              selected={field.value}
                              onChange={field.onChange}
                              placeholder={t(
                                'Select models (empty for allow all)'
                              )}
                            />
                          </FormControl>
                          <FormDescription>
                            {t('Limit which models can be used with this key')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name='allow_ips'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t('IP Whitelist (supports CIDR)')}
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              className='min-h-20 resize-none'
                              placeholder={t(
                                'One IP per line (empty for no restriction)'
                              )}
                              rows={3}
                            />
                          </FormControl>
                          <FormDescription>
                            {t(
                              'Do not over-trust this feature. IP may be spoofed. Please use with nginx, CDN and other gateways.'
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CollapsibleContent>
              </SideDrawerSection>
            </Collapsible>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose
            render={<Button variant='outline' className='w-full sm:w-auto' />}
          >
            {t('Close')}
          </SheetClose>
          <Button
            type='button'
            onClick={form.handleSubmit(onSubmit, onInvalid)}
            disabled={
              !isFormInitialized || isSubmitting || routingOptionsFetching
            }
            className='w-full sm:w-auto'
          >
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
