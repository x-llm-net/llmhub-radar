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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import {
  CircleCheck,
  CircleX,
  ChevronDown,
  Clock3,
  BellPlus,
  Loader2,
  ListMinus,
  ListPlus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTimestampToDate } from '@/lib/format'

import {
  deleteProviderChannelFailedModels,
  notifyProviderChannelMissingModelPrices,
  requestProviderChannelModelProbe,
  requestProviderChannelProbe,
  updateProviderChannelModelAutoProbe,
  updateProviderChannelModelPublication,
  updateProviderChannelModelsPublication,
  updateProviderChannelModelProbeEndpoint,
} from './api'
import {
  providerChannelsQueryKey,
  providerChannelProbesQueryKey,
  useProviderChannelProbes,
} from './hooks/use-provider'
import type {
  HubProviderChannel,
  HubSupplyModelProbe,
  HubSupplyProbeEndpoint,
  HubSupplyProbeEndpointMode,
  HubSupplyProbeRequestResponse,
} from './types'

type ProbeFilter = 'all' | 'published' | 'online' | 'error'

const MODEL_PRICE_ERROR_CODE = 'model_price_error'

type ProviderChannelModelsDialogProps = {
  providerChannel: HubProviderChannel | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatLatency(milliseconds: number) {
  if (milliseconds <= 0) return '-'
  if (milliseconds < 1000) return `${milliseconds} ms`
  return `${(milliseconds / 1000).toFixed(2)} s`
}

function formatCooldown(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function summarizeProbeError(error: string) {
  const normalized = error.replaceAll(/\s+/g, ' ').trim()
  const statusCode = normalized.match(/status code\s+(\d{3})/i)?.[1]
  const message = normalized
    .match(/message:\s*(.*?)(?:\s*\(request id:|,\s*body:|$)/i)?.[1]
    ?.trim()
  if (statusCode && message) return `HTTP ${statusCode} · ${message}`
  if (statusCode) return `HTTP ${statusCode}`
  if (normalized.length <= 96) return normalized
  return `${normalized.slice(0, 96)}...`
}

function endpointLabel(endpoint: HubSupplyProbeEndpoint) {
  const endpointType = endpoint.resolved_endpoint_type || endpoint.endpoint_type
  switch (endpointType) {
    case 'openai-response':
      return 'Responses endpoint'
    case 'image-generation':
      return 'Image endpoint'
    default:
      return 'Chat endpoint'
  }
}

const endpointModeOptions: Array<{
  value: HubSupplyProbeEndpointMode
  label: string
}> = [
  { value: 'auto', label: 'Auto detect endpoint' },
  { value: 'openai', label: 'Chat endpoint' },
  { value: 'openai-response', label: 'Responses endpoint' },
  { value: 'image-generation', label: 'Image endpoint' },
]

function ProbeStatus(props: { model: HubSupplyModelProbe; running?: boolean }) {
  const { t } = useTranslation()
  if (props.running) {
    return (
      <span className='text-primary inline-flex items-center gap-1.5 font-medium'>
        <Loader2 className='size-4 animate-spin' aria-hidden='true' />
        {t('Testing...')}
      </span>
    )
  }
  switch (props.model.status) {
    case 'available':
      return (
        <span className='inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400'>
          <CircleCheck className='size-4' aria-hidden='true' />
          {t('Test succeeded')}
        </span>
      )
    case 'error':
      return (
        <span className='text-destructive inline-flex items-center gap-1.5 font-medium'>
          <CircleX className='size-4' aria-hidden='true' />
          {t('Test failed')}
        </span>
      )
    case 'waiting':
      return (
        <span className='text-muted-foreground inline-flex items-center gap-1.5 font-medium'>
          <Clock3 className='size-4' aria-hidden='true' />
          {t('Waiting for test')}
        </span>
      )
    case 'skipped':
      return (
        <span className='text-muted-foreground inline-flex items-center gap-1.5 font-medium'>
          <CircleCheck className='size-4' aria-hidden='true' />
          {t('Automatic testing skipped')}
        </span>
      )
    case 'pending':
    case 'testing':
      return (
        <span className='text-primary inline-flex items-center gap-1.5 font-medium'>
          <Loader2 className='size-4 animate-spin' aria-hidden='true' />
          {t('Testing...')}
        </span>
      )
    default:
      return (
        <span className='text-muted-foreground inline-flex items-center gap-1.5 font-medium'>
          <Clock3 className='size-4' aria-hidden='true' />
          {t('Waiting for test')}
        </span>
      )
  }
}

function PublicationStatus(props: {
  model: HubSupplyModelProbe
  changing?: boolean
  onChange: (published: boolean) => void
}) {
  const { t } = useTranslation()
  let label = 'Not listed'
  let className = 'text-muted-foreground'
  if (props.model.published && props.model.online) {
    label = 'Listed'
    className = 'text-emerald-600 dark:text-emerald-400'
  } else if (props.model.published) {
    label = 'Temporarily offline'
    className = 'text-amber-600 dark:text-amber-400'
  } else if (props.model.status === 'available') {
    label = 'Ready to list'
    className = 'text-foreground'
  }
  return (
    <div className='flex items-center gap-2.5'>
      <Switch
        checked={props.model.published}
        disabled={props.changing}
        onCheckedChange={props.onChange}
        aria-label={t(props.model.published ? 'Unlist model' : 'List model')}
      />
      <span className={`text-xs font-medium ${className}`}>
        {props.changing ? t('Updating...') : t(label)}
      </span>
    </div>
  )
}

function AutoProbeStatus(props: {
  enabled: boolean
  changing?: boolean
  onChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <div className='flex items-center gap-2.5'>
      <Switch
        checked={props.enabled}
        disabled={props.changing}
        onCheckedChange={props.onChange}
        aria-label={t('Automatic testing')}
      />
      <span className='text-muted-foreground text-xs font-medium'>
        {props.changing
          ? t('Updating...')
          : t(props.enabled ? 'Enabled' : 'Skipped')}
      </span>
    </div>
  )
}

function EndpointResult(props: {
  endpoint: HubSupplyProbeEndpoint
  endpointMode: HubSupplyProbeEndpointMode
  running?: boolean
  changing?: boolean
  onEndpointModeChange: (endpointMode: HubSupplyProbeEndpointMode) => void
}) {
  const { t } = useTranslation()
  const { endpoint } = props
  const isRunning =
    props.running ||
    endpoint.status === 'pending' ||
    endpoint.status === 'testing'
  const normalizedError = endpoint.last_error.toLowerCase()
  const isModelPriceError =
    endpoint.last_error_code === MODEL_PRICE_ERROR_CODE ||
    normalizedError.includes('price not configured') ||
    normalizedError.includes('has not been priced') ||
    (endpoint.last_error.includes('价格') &&
      endpoint.last_error.includes('配置'))
  const displayError = isModelPriceError
    ? t(
        'Model price is not configured. Please complete model pricing in settings.'
      )
    : endpoint.last_error
  let statusContent
  if (isRunning) {
    statusContent = (
      <span className='text-primary inline-flex items-center gap-1'>
        <Loader2 className='size-3.5 animate-spin' aria-hidden='true' />
        {t('Testing')}
      </span>
    )
  } else if (endpoint.status === 'available') {
    statusContent = (
      <span className='inline-flex flex-wrap items-center gap-x-2 text-emerald-600 dark:text-emerald-400'>
        <span>
          {t('Total latency')} {formatLatency(endpoint.last_latency_ms)}
        </span>
        {endpoint.last_first_token_ms !== null && (
          <span>
            {t('First token')} {formatLatency(endpoint.last_first_token_ms)}
          </span>
        )}
      </span>
    )
  } else if (endpoint.status === 'waiting') {
    statusContent = (
      <span className='text-muted-foreground'>{t('Waiting for test')}</span>
    )
  } else if (endpoint.status === 'suspended') {
    statusContent = (
      <span className='text-destructive'>
        {t('Automatic probes suspended')}
      </span>
    )
  } else {
    statusContent = <span className='text-destructive'>{t('Failed')}</span>
  }
  return (
    <div className='min-w-0 space-y-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-6 gap-1 px-2 text-xs'
                disabled={props.running || props.changing}
                aria-label={t('Endpoint Type')}
              />
            }
          >
            {t(endpointLabel(endpoint))}
            <ChevronDown className='size-3' aria-hidden='true' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='w-48'>
            <DropdownMenuRadioGroup
              value={props.endpointMode}
              onValueChange={(value) =>
                props.onEndpointModeChange(value as HubSupplyProbeEndpointMode)
              }
            >
              <DropdownMenuLabel>{t('Endpoint Type')}</DropdownMenuLabel>
              {endpointModeOptions.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {t(option.label)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {statusContent}
      </div>
      {(endpoint.status === 'error' || endpoint.status === 'suspended') &&
        endpoint.last_error && (
          <div className='flex max-w-full min-w-0 items-center gap-2'>
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type='button'
                    className='border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 flex h-8 max-w-full min-w-0 items-center gap-2 rounded-md border px-2.5 text-left text-xs transition-colors'
                  />
                }
              >
                <CircleX className='size-3.5 shrink-0' aria-hidden='true' />
                <span className='truncate'>
                  {summarizeProbeError(displayError)}
                </span>
                <ChevronDown
                  className='size-3.5 shrink-0 opacity-60'
                  aria-hidden='true'
                />
              </PopoverTrigger>
              <PopoverContent
                align='start'
                className='w-[28rem] max-w-[calc(100vw-2rem)] gap-3 p-3'
              >
                <div className='text-destructive flex items-center gap-2 font-medium'>
                  <CircleX className='size-4' aria-hidden='true' />
                  {t('Error details')}
                </div>
                <div className='bg-muted max-h-64 overflow-auto rounded-md p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap'>
                  {displayError}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
    </div>
  )
}

export function ProviderChannelModelsDialog(
  props: ProviderChannelModelsDialogProps
) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<ProbeFilter>('all')
  const [search, setSearch] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [manualTestingModels, setManualTestingModels] = useState<Set<string>>(
    () => new Set()
  )
  const [endpointChangingModels, setEndpointChangingModels] = useState<
    Set<string>
  >(() => new Set())
  const [autoProbeChangingModels, setAutoProbeChangingModels] = useState<
    Set<string>
  >(() => new Set())
  const [publicationChangingModels, setPublicationChangingModels] = useState<
    Set<string>
  >(() => new Set())
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    () => new Set()
  )
  const [deleteFailedDialogOpen, setDeleteFailedDialogOpen] = useState(false)
  const [lastNotifiedMissingPriceKey, setLastNotifiedMissingPriceKey] =
    useState('')
  const wasRunningRef = useRef(false)
  const channelId = props.providerChannel?.channel.id ?? 0
  const probesQuery = useProviderChannelProbes(channelId, {
    enabled: props.open && channelId > 0,
  })
  const probeState = probesQuery.probeState

  const refreshProbeData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: providerChannelProbesQueryKey(channelId),
      }),
      queryClient.invalidateQueries({ queryKey: providerChannelsQueryKey }),
    ])
  }

  const handleProbeResponse = async (
    response: HubSupplyProbeRequestResponse
  ) => {
    if (!response.success) {
      toast.error(response.message || t('Failed to start test'))
      return
    }
    await refreshProbeData()
  }

  const probeAllMutation = useMutation({
    mutationFn: () => requestProviderChannelProbe(channelId),
    onSuccess: handleProbeResponse,
    onError: () => toast.error(t('Failed to start test')),
  })
  const probeModelMutation = useMutation({
    mutationFn: (modelName: string) =>
      requestProviderChannelModelProbe(channelId, modelName),
    onMutate: (modelName) => {
      setManualTestingModels((current) => {
        const next = new Set(current)
        next.add(modelName)
        return next
      })
    },
    onSuccess: async (response, modelName) => {
      await handleProbeResponse(response)
      if (response.success && response.data?.model_status === 'available') {
        toast.success(t('Test succeeded'), { description: modelName })
      }
    },
    onError: () => toast.error(t('Failed to start test')),
    onSettled: (_data, _error, modelName) => {
      setManualTestingModels((current) => {
        const next = new Set(current)
        next.delete(modelName)
        return next
      })
    },
  })
  const endpointMutation = useMutation({
    mutationFn: (variables: {
      modelName: string
      endpointMode: HubSupplyProbeEndpointMode
    }) =>
      updateProviderChannelModelProbeEndpoint(
        channelId,
        variables.modelName,
        variables.endpointMode
      ),
    onMutate: ({ modelName }) => {
      setEndpointChangingModels((current) => {
        const next = new Set(current)
        next.add(modelName)
        return next
      })
    },
    onSuccess: async (response) => {
      await handleProbeResponse(response)
    },
    onError: () => toast.error(t('Failed to update endpoint type')),
    onSettled: (_data, _error, { modelName }) => {
      setEndpointChangingModels((current) => {
        const next = new Set(current)
        next.delete(modelName)
        return next
      })
    },
  })
  const autoProbeMutation = useMutation({
    mutationFn: (variables: { modelName: string; enabled: boolean }) =>
      updateProviderChannelModelAutoProbe(
        channelId,
        variables.modelName,
        variables.enabled
      ),
    onMutate: ({ modelName }) => {
      setAutoProbeChangingModels((current) => {
        const next = new Set(current)
        next.add(modelName)
        return next
      })
    },
    onSuccess: async (response, variables) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to update automatic testing'))
        return
      }
      await refreshProbeData()
      toast.success(
        t(
          variables.enabled
            ? 'Automatic testing enabled'
            : 'Automatic testing skipped'
        ),
        { description: variables.modelName }
      )
    },
    onError: () => toast.error(t('Failed to update automatic testing')),
    onSettled: (_data, _error, { modelName }) => {
      setAutoProbeChangingModels((current) => {
        const next = new Set(current)
        next.delete(modelName)
        return next
      })
    },
  })
  const publicationMutation = useMutation({
    mutationFn: (variables: { modelName: string; published: boolean }) =>
      updateProviderChannelModelPublication(
        channelId,
        variables.modelName,
        variables.published
      ),
    onMutate: ({ modelName }) => {
      setPublicationChangingModels((current) => {
        const next = new Set(current)
        next.add(modelName)
        return next
      })
    },
    onSuccess: async (response, variables) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to update listing status'))
        return
      }
      await refreshProbeData()
      toast.success(
        t(variables.published ? 'Model listed' : 'Model unlisted'),
        {
          description: variables.modelName,
        }
      )
    },
    onError: (error) =>
      toast.error(
        axios.isAxiosError(error) && error.response?.status === 429
          ? t('Too many listing updates. Please retry shortly.')
          : t('Failed to update listing status')
      ),
    onSettled: (_data, _error, { modelName }) => {
      setPublicationChangingModels((current) => {
        const next = new Set(current)
        next.delete(modelName)
        return next
      })
    },
  })
  const batchPublicationMutation = useMutation({
    mutationFn: (variables: { modelNames: string[]; published: boolean }) =>
      updateProviderChannelModelsPublication(
        channelId,
        variables.modelNames,
        variables.published
      ),
    onMutate: ({ modelNames }) => {
      setPublicationChangingModels((current) => {
        const next = new Set(current)
        modelNames.forEach((modelName) => next.add(modelName))
        return next
      })
    },
    onSuccess: async (response, variables) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to update listing status'))
        return
      }
      await refreshProbeData()
      setSelectedModels(new Set())
      toast.success(
        t(
          variables.published
            ? '{{count}} models listed'
            : '{{count}} models unlisted',
          { count: variables.modelNames.length }
        )
      )
    },
    onError: (error) =>
      toast.error(
        axios.isAxiosError(error) && error.response?.status === 429
          ? t('Too many listing updates. Please retry shortly.')
          : t('Failed to update listing status')
      ),
    onSettled: (_data, _error, { modelNames }) => {
      setPublicationChangingModels((current) => {
        const next = new Set(current)
        modelNames.forEach((modelName) => next.delete(modelName))
        return next
      })
    },
  })
  const deleteFailedMutation = useMutation({
    mutationFn: () => deleteProviderChannelFailedModels(channelId),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to delete failed models'))
        return
      }
      const deletedCount = response.data?.deleted_count ?? 0
      await Promise.all([
        refreshProbeData(),
        queryClient.invalidateQueries({ queryKey: providerChannelsQueryKey }),
      ])
      setSelectedModels(new Set())
      setDeleteFailedDialogOpen(false)
      setLastNotifiedMissingPriceKey('')
      toast.success(
        t('Deleted {{count}} failed models', { count: deletedCount })
      )
    },
    onError: (error) =>
      toast.error(
        axios.isAxiosError(error)
          ? error.response?.data?.message || t('Failed to delete failed models')
          : t('Failed to delete failed models')
      ),
  })

  const cooldownSeconds = Math.max(
    0,
    Math.ceil((probeState?.next_manual_probe_at ?? 0) - now / 1000)
  )
  const running = Boolean(probeState?.running)

  useEffect(() => {
    if (!props.open) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [props.open])

  useEffect(() => {
    if (!props.open) {
      setFilter('all')
      setSearch('')
      setManualTestingModels(new Set())
      setEndpointChangingModels(new Set())
      setAutoProbeChangingModels(new Set())
      setPublicationChangingModels(new Set())
      setSelectedModels(new Set())
      setDeleteFailedDialogOpen(false)
    }
  }, [props.open])

  useEffect(() => {
    setLastNotifiedMissingPriceKey('')
  }, [channelId])

  useEffect(() => {
    if (probeState?.running) {
      wasRunningRef.current = true
      return
    }
    if (wasRunningRef.current) {
      wasRunningRef.current = false
      void queryClient.invalidateQueries({ queryKey: providerChannelsQueryKey })
    }
  }, [probeState?.running, queryClient])

  const counts = useMemo(() => {
    const models = probeState?.models ?? []
    return {
      all: models.length,
      published: models.filter((model) => model.published).length,
      online: models.filter((model) => model.online).length,
      error: models.filter((model) => model.status === 'error').length,
    }
  }, [probeState?.models])

  const missingPriceModelNames = useMemo(
    () =>
      (probeState?.models ?? [])
        .filter((model) =>
          model.endpoints.some(
            (endpoint) => endpoint.last_error_code === MODEL_PRICE_ERROR_CODE
          )
        )
        .map((model) => model.model_name),
    [probeState?.models]
  )
  const missingPriceKey = missingPriceModelNames.join('\u0000')
  const notifyMissingPricesMutation = useMutation({
    mutationFn: () =>
      notifyProviderChannelMissingModelPrices(
        channelId,
        missingPriceModelNames
      ),
    onSuccess: (response) => {
      const count = response.data?.notified_count ?? 0
      if (count === 0) {
        if (response.data?.suppressed) {
          setLastNotifiedMissingPriceKey(missingPriceKey)
          toast.info(t('Administrator was already notified'))
          return
        }
        toast.info(t('All detected model prices are configured'))
        return
      }
      setLastNotifiedMissingPriceKey(missingPriceKey)
      toast.success(
        t('Administrator notified about {{count}} missing model prices', {
          count,
        })
      )
    },
    onError: (error) =>
      toast.error(
        axios.isAxiosError(error)
          ? error.response?.data?.message || t('Failed to notify administrator')
          : t('Failed to notify administrator')
      ),
  })

  const visibleModels = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (probeState?.models ?? []).filter((model) => {
      if (filter === 'online' && !model.online) return false
      if (filter === 'published' && !model.published) return false
      if (filter === 'error' && model.status !== 'error') return false
      return !query || model.model_name.toLowerCase().includes(query)
    })
  }, [filter, probeState?.models, search])

  useEffect(() => {
    const configuredModels = new Set(
      (probeState?.models ?? []).map((model) => model.model_name)
    )
    setSelectedModels((current) => {
      const next = new Set(
        [...current].filter((modelName) => configuredModels.has(modelName))
      )
      return next.size === current.size ? current : next
    })
  }, [probeState?.models])

  const visibleModelNames = visibleModels.map((model) => model.model_name)
  const selectedVisibleCount = visibleModelNames.filter((modelName) =>
    selectedModels.has(modelName)
  ).length
  const allVisibleSelected =
    visibleModelNames.length > 0 &&
    selectedVisibleCount === visibleModelNames.length
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected
  const publicationBusy =
    batchPublicationMutation.isPending || publicationChangingModels.size > 0
  const batchListing =
    batchPublicationMutation.isPending &&
    batchPublicationMutation.variables?.published === true
  const batchUnlisting =
    batchPublicationMutation.isPending &&
    batchPublicationMutation.variables?.published === false

  const toggleVisibleModels = (selected: boolean) => {
    setSelectedModels((current) => {
      const next = new Set(current)
      visibleModelNames.forEach((modelName) => {
        if (selected) next.add(modelName)
        else next.delete(modelName)
      })
      return next
    })
  }

  const mutationPending =
    probeAllMutation.isPending ||
    manualTestingModels.size > 0 ||
    endpointChangingModels.size > 0 ||
    autoProbeChangingModels.size > 0
  const allDetectionDisabled = running || cooldownSeconds > 0 || mutationPending

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='flex max-h-[min(88vh,820px)] w-full max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl'>
        <DialogHeader className='border-b px-5 py-4 pr-14'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
            <div className='min-w-0'>
              <DialogTitle className='truncate text-lg'>
                {t('Model management: {{name}}', {
                  name:
                    probeState?.name ||
                    props.providerChannel?.channel.name ||
                    '',
                })}
              </DialogTitle>
              <DialogDescription className='mt-2'>
                {t(
                  'Models are listed automatically after their first successful test. Disable automatic testing only for models that do not support standard detection.'
                )}
              </DialogDescription>
            </div>
            <div className='flex shrink-0 flex-col items-start gap-1 sm:items-end'>
              <Button
                type='button'
                size='sm'
                disabled={allDetectionDisabled}
                onClick={() => probeAllMutation.mutate()}
              >
                {running || probeAllMutation.isPending ? (
                  <Loader2 className='size-4 animate-spin' aria-hidden='true' />
                ) : (
                  <RefreshCw className='size-4' aria-hidden='true' />
                )}
                {running
                  ? t('Testing...')
                  : t('Test all {{count}} models', {
                      count: probeState?.models.length ?? 0,
                    })}
              </Button>
              {cooldownSeconds > 0 && !running && (
                <span className='text-muted-foreground text-xs'>
                  {t('Available again in {{time}}', {
                    time: formatCooldown(cooldownSeconds),
                  })}
                </span>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 flex-col gap-3 px-5 py-4'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div
              className='flex flex-wrap gap-2'
              role='group'
              aria-label={t('Filter models')}
            >
              {(
                [
                  ['all', 'All Models', counts.all],
                  ['published', 'Listed models', counts.published],
                  ['online', 'Online', counts.online],
                  ['error', 'Abnormal', counts.error],
                ] as const
              ).map(([value, label, count]) => (
                <Button
                  key={value}
                  type='button'
                  size='sm'
                  variant={filter === value ? 'secondary' : 'ghost'}
                  onClick={() => setFilter(value)}
                >
                  {t(label)}
                  <span className='text-muted-foreground'>{count}</span>
                </Button>
              ))}
            </div>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
              {counts.error > 0 && (
                <Button
                  type='button'
                  size='sm'
                  variant='destructive'
                  disabled={deleteFailedMutation.isPending}
                  onClick={() => setDeleteFailedDialogOpen(true)}
                >
                  {deleteFailedMutation.isPending ? (
                    <Loader2
                      className='size-4 animate-spin'
                      aria-hidden='true'
                    />
                  ) : (
                    <Trash2 className='size-4' aria-hidden='true' />
                  )}
                  {t('Delete failed models')} ({counts.error})
                </Button>
              )}
              {missingPriceModelNames.length > 0 && (
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={
                    notifyMissingPricesMutation.isPending ||
                    lastNotifiedMissingPriceKey === missingPriceKey
                  }
                  onClick={() => notifyMissingPricesMutation.mutate()}
                >
                  {notifyMissingPricesMutation.isPending ? (
                    <Loader2
                      className='size-4 animate-spin'
                      aria-hidden='true'
                    />
                  ) : (
                    <BellPlus className='size-4' aria-hidden='true' />
                  )}
                  {lastNotifiedMissingPriceKey === missingPriceKey
                    ? t('Administrator notified')
                    : t('Notify administrator about prices')}{' '}
                  ({missingPriceModelNames.length})
                </Button>
              )}
              <div className='relative sm:w-64'>
                <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('Search models')}
                  className='pl-9'
                />
              </div>
            </div>
          </div>

          {selectedModels.size > 0 && (
            <div className='bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2'>
              <span className='text-sm font-medium'>
                {t('Selected {{count}}', { count: selectedModels.size })}
              </span>
              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  type='button'
                  size='sm'
                  disabled={publicationBusy}
                  onClick={() =>
                    batchPublicationMutation.mutate({
                      modelNames: [...selectedModels],
                      published: true,
                    })
                  }
                >
                  {batchListing ? (
                    <Loader2
                      className='size-4 animate-spin'
                      aria-hidden='true'
                    />
                  ) : (
                    <ListPlus className='size-4' aria-hidden='true' />
                  )}
                  {t('Batch list')}
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={publicationBusy}
                  onClick={() =>
                    batchPublicationMutation.mutate({
                      modelNames: [...selectedModels],
                      published: false,
                    })
                  }
                >
                  {batchUnlisting ? (
                    <Loader2
                      className='size-4 animate-spin'
                      aria-hidden='true'
                    />
                  ) : (
                    <ListMinus className='size-4' aria-hidden='true' />
                  )}
                  {t('Batch unlist')}
                </Button>
              </div>
            </div>
          )}

          <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
            {probesQuery.isLoading && (
              <div className='space-y-2 p-4'>
                {['probe-1', 'probe-2', 'probe-3', 'probe-4', 'probe-5'].map(
                  (key) => (
                    <Skeleton key={key} className='h-14 w-full' />
                  )
                )}
              </div>
            )}
            {probesQuery.isError && (
              <div className='flex min-h-48 flex-col items-center justify-center gap-3 px-4 text-center'>
                <p className='text-muted-foreground'>
                  {t('Failed to load test results')}
                </p>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => void probesQuery.refetch()}
                >
                  <RefreshCw className='size-4' aria-hidden='true' />
                  {t('Retry')}
                </Button>
              </div>
            )}
            {!probesQuery.isLoading &&
              !probesQuery.isError &&
              visibleModels.length === 0 && (
                <div className='text-muted-foreground flex min-h-48 items-center justify-center px-4 text-center'>
                  {t('No matching models')}
                </div>
              )}
            {!probesQuery.isLoading &&
              !probesQuery.isError &&
              visibleModels.length > 0 && (
                <Table className='min-w-[1264px] table-fixed'>
                  <TableHeader className='bg-muted/40 sticky top-0 z-10'>
                    <TableRow>
                      <TableHead className='w-10 pl-4'>
                        <Checkbox
                          checked={allVisibleSelected}
                          indeterminate={someVisibleSelected}
                          disabled={batchPublicationMutation.isPending}
                          onCheckedChange={(checked) =>
                            toggleVisibleModels(Boolean(checked))
                          }
                          aria-label={t('Select all')}
                        />
                      </TableHead>
                      <TableHead className='w-44 pl-0'>{t('Model')}</TableHead>
                      <TableHead className='w-36'>
                        {t('Listing status')}
                      </TableHead>
                      <TableHead className='w-36'>
                        {t('Automatic testing')}
                      </TableHead>
                      <TableHead className='w-36'>{t('Status')}</TableHead>
                      <TableHead className='w-96'>
                        {t('Endpoint results')}
                      </TableHead>
                      <TableHead className='w-44'>
                        {t('Last detected')}
                      </TableHead>
                      <TableHead className='bg-muted/95 sticky right-0 z-20 w-14 border-l text-right shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.35)] backdrop-blur' />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleModels.map((model) => {
                      const retrying = manualTestingModels.has(model.model_name)
                      const endpointChanging = endpointChangingModels.has(
                        model.model_name
                      )
                      const autoProbeChanging = autoProbeChangingModels.has(
                        model.model_name
                      )
                      const publicationChanging = publicationChangingModels.has(
                        model.model_name
                      )
                      const modelRunning =
                        retrying ||
                        model.status === 'pending' ||
                        model.status === 'testing'
                      return (
                        <TableRow key={model.model_name}>
                          <TableCell className='pl-4'>
                            <Checkbox
                              checked={selectedModels.has(model.model_name)}
                              disabled={batchPublicationMutation.isPending}
                              onCheckedChange={(checked) =>
                                setSelectedModels((current) => {
                                  const next = new Set(current)
                                  if (checked) next.add(model.model_name)
                                  else next.delete(model.model_name)
                                  return next
                                })
                              }
                              aria-label={t('Select {{model}}', {
                                model: model.model_name,
                              })}
                            />
                          </TableCell>
                          <TableCell className='pl-0 whitespace-normal'>
                            <span className='font-medium break-all'>
                              {model.model_name}
                            </span>
                          </TableCell>
                          <TableCell>
                            <PublicationStatus
                              model={model}
                              changing={
                                publicationChanging ||
                                batchPublicationMutation.isPending
                              }
                              onChange={(published) =>
                                publicationMutation.mutate({
                                  modelName: model.model_name,
                                  published,
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <AutoProbeStatus
                              enabled={model.auto_probe_enabled}
                              changing={autoProbeChanging || modelRunning}
                              onChange={(enabled) =>
                                autoProbeMutation.mutate({
                                  modelName: model.model_name,
                                  enabled,
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <ProbeStatus model={model} running={modelRunning} />
                          </TableCell>
                          <TableCell className='space-y-2 whitespace-normal'>
                            {model.endpoints.length ? (
                              model.endpoints.map((endpoint) => (
                                <EndpointResult
                                  key={`${endpoint.endpoint_type}-${endpoint.probe_kind}`}
                                  endpoint={endpoint}
                                  endpointMode={model.endpoint_mode}
                                  running={modelRunning}
                                  changing={endpointChanging}
                                  onEndpointModeChange={(endpointMode) => {
                                    if (endpointMode === model.endpoint_mode) {
                                      return
                                    }
                                    endpointMutation.mutate({
                                      modelName: model.model_name,
                                      endpointMode,
                                    })
                                  }}
                                />
                              ))
                            ) : (
                              <span className='text-muted-foreground'>
                                {model.auto_probe_enabled
                                  ? '-'
                                  : t('Detection disabled')}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className='text-muted-foreground'>
                            {model.last_probe_at > 0
                              ? formatTimestampToDate(model.last_probe_at)
                              : t('Never')}
                          </TableCell>
                          <TableCell className='bg-background group-hover:bg-muted/50 sticky right-0 z-[5] border-l text-right shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.35)] transition-colors'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon-sm'
                              title={t('Test model again')}
                              disabled={
                                !model.auto_probe_enabled ||
                                modelRunning ||
                                endpointChanging ||
                                autoProbeChanging
                              }
                              onClick={() =>
                                probeModelMutation.mutate(model.model_name)
                              }
                            >
                              {retrying ? (
                                <Loader2
                                  className='size-4 animate-spin'
                                  aria-hidden='true'
                                />
                              ) : (
                                <RefreshCw
                                  className='size-4'
                                  aria-hidden='true'
                                />
                              )}
                              <span className='sr-only'>
                                {t('Retry model')}
                              </span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
          </div>
        </div>

        <DialogFooter className='mx-0 mb-0 rounded-none px-5 py-3'>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={deleteFailedDialogOpen}
        onOpenChange={setDeleteFailedDialogOpen}
        title={t('Delete failed models')}
        desc={t(
          'This removes {{count}} failed models from this channel. This action cannot be undone.',
          { count: counts.error }
        )}
        destructive
        isLoading={deleteFailedMutation.isPending}
        confirmText={t('Delete')}
        handleConfirm={() => deleteFailedMutation.mutate()}
      />
    </Dialog>
  )
}
