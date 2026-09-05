import type { TFunction } from 'i18next'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'

import { formatHubMultiplier } from '../lib/multiplier'
import type {
  HubTokenRoutingFamilyOption,
  HubTokenRoutingModelOption,
  HubTokenRoutingOptions,
} from '../types'

export type HubRoutingSelectionFormValue = {
  model?: string
  family?: string
  min_multiplier: number
  max_multiplier: number
  exact_multipliers?: number[]
  multipliers?: number[]
}

type HubRoutingPolicyEditorProps = {
  options: HubTokenRoutingOptions
  value: HubRoutingSelectionFormValue[]
  onChange: (value: HubRoutingSelectionFormValue[]) => void
}

const FAMILY_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  alibaba: 'Qwen / Alibaba',
  bytedance: 'ByteDance',
  zhipu: 'GLM / Zhipu',
  other: 'Other models',
}

function clampMultiplier(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)) * 1000) / 1000
}

type MultiplierPresetKey = 'all' | 'economy' | 'standard' | 'high'

type MultiplierPreset = {
  key: MultiplierPresetKey
  label: string
  min: number
  max: number
}

function getMultiplierPresets(
  option: HubTokenRoutingFamilyOption,
  ceilings: HubTokenRoutingOptions['tier_ceilings'][string] | undefined,
  t: TFunction
): MultiplierPreset[] {
  const presets: Array<{
    key: MultiplierPresetKey
    label: string
    min: number
    max: number
  }> = [
    {
      key: 'all',
      label: t('All'),
      min: option.min_multiplier,
      max: option.max_multiplier,
    },
  ]

  if (!ceilings) return presets

  presets.push(
    {
      key: 'economy',
      label: t('Economy'),
      min: option.min_multiplier,
      max: Math.min(option.max_multiplier, ceilings.low),
    },
    {
      key: 'standard',
      label: t('Standard'),
      min: Math.max(option.min_multiplier, ceilings.low),
      max: Math.min(option.max_multiplier, ceilings.medium),
    },
    {
      key: 'high',
      label: t('High quality'),
      min: Math.max(option.min_multiplier, ceilings.medium),
      max: Math.min(option.max_multiplier, ceilings.high),
    }
  )

  return presets
    .filter((preset) => preset.min <= preset.max)
    .map((preset) => ({
      ...preset,
      min: clampMultiplier(
        preset.min,
        option.min_multiplier,
        option.max_multiplier
      ),
      max: clampMultiplier(
        preset.max,
        option.min_multiplier,
        option.max_multiplier
      ),
    }))
}

function getHighestTier(
  ceilings: HubTokenRoutingOptions['tier_ceilings'][string] | undefined,
  value: number
): string {
  if (!ceilings) return ''
  if (value <= ceilings.special) return 'Special price'
  if (value <= ceilings.low) return 'Economy'
  if (value <= ceilings.medium) return 'Standard'
  return 'High quality'
}

function defaultSelection(
  option: HubTokenRoutingFamilyOption,
  ceilings: HubTokenRoutingOptions['tier_ceilings'][string] | undefined
) {
  const fallbackMax = Math.min(
    option.max_multiplier,
    Math.max(option.min_multiplier, 1)
  )
  if (!ceilings) {
    return {
      family: option.key,
      min_multiplier: option.min_multiplier,
      max_multiplier: fallbackMax,
      exact_multipliers: option.exact_multipliers?.[0]
        ? [option.exact_multipliers[0]]
        : undefined,
    }
  }

  const standardMin = clampMultiplier(
    Math.max(option.min_multiplier, ceilings.low),
    option.min_multiplier,
    option.max_multiplier
  )
  const standardMax = clampMultiplier(
    Math.min(option.max_multiplier, ceilings.medium),
    option.min_multiplier,
    option.max_multiplier
  )
  if (standardMin <= standardMax) {
    return {
      family: option.key,
      min_multiplier: standardMin,
      max_multiplier: standardMax,
      exact_multipliers: option.exact_multipliers?.[0]
        ? [option.exact_multipliers[0]]
        : undefined,
    }
  }

  return {
    family: option.key,
    min_multiplier: option.min_multiplier,
    max_multiplier: fallbackMax,
    exact_multipliers: option.exact_multipliers?.[0]
      ? [option.exact_multipliers[0]]
      : undefined,
  }
}

export function HubRoutingPolicyEditor({
  options,
  value,
  onChange,
}: HubRoutingPolicyEditorProps) {
  const { t } = useTranslation()
  const familyLabel = (key: string) => t(FAMILY_LABELS[key] || key)
  const optionByFamily = useMemo(
    () => new Map(options.families.map((option) => [option.key, option])),
    [options.families]
  )
  const modelOptions = (options.models || []) as HubTokenRoutingModelOption[]
  const optionByModel = useMemo(
    () => new Map(modelOptions.map((option) => [option.model, option])),
    [modelOptions]
  )
  const concreteMode = modelOptions.length > 0

  const addSelection = () => {
    const available = concreteMode
      ? modelOptions.find(
          (option) =>
            !value.some((selection) => selection.model === option.model)
        )
      : options.families.find(
          (option) =>
            !value.some((selection) => selection.family === option.key)
        )
    if (!available || value.length >= 8) return
    onChange([
      ...value,
      concreteMode
        ? {
            model: (available as HubTokenRoutingModelOption).model,
            min_multiplier: available.min_multiplier,
            max_multiplier: Math.min(available.max_multiplier, 1),
            multipliers: available.exact_multipliers?.slice(0, 1),
          }
        : defaultSelection(
            available,
            options.mode === 'public_pool'
              ? options.tier_ceilings[available.key]
              : undefined
          ),
    ])
  }

  const updateSelection = (
    index: number,
    patch: Partial<HubRoutingSelectionFormValue>
  ) => {
    onChange(
      value.map((selection, currentIndex) =>
        currentIndex === index ? { ...selection, ...patch } : selection
      )
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-start justify-between gap-3'>
        <div className='space-y-1'>
          <div className='text-sm font-medium'>
            {options.mode === 'provider'
              ? t('Available provider routes')
              : concreteMode
                ? t('Models and ordered multipliers')
                : t('Model families and multiplier ranges')}
          </div>
          <p className='text-muted-foreground text-xs'>
            {options.mode === 'provider'
              ? t(
                  'Choose the exact multiplier published by this provider. Fallback keeps the same choices.'
                )
              : t(
                  'Each model family uses its own inclusive multiplier range. Step: 0.001.'
                )}
          </p>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={addSelection}
          disabled={
            value.length >= 8 ||
            value.length >=
              (concreteMode ? modelOptions.length : options.families.length)
          }
        >
          <Plus className='mr-1.5 size-3.5' />
          {t('Add model family')}
        </Button>
      </div>

      {value.length === 0 && (
        <div className='border-muted-foreground/25 bg-muted/30 text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-xs'>
          {(concreteMode ? modelOptions.length : options.families.length) === 0
            ? t('This provider has no published routes available for API keys.')
            : t(
                concreteMode
                  ? 'Add at least one model to control which channels this key can use.'
                  : 'Add at least one model family to control which channels this key can use.'
              )}
        </div>
      )}

      {value.map((selection, index) => {
        const option = optionByFamily.get(selection.family)
        const concreteOption =
          concreteMode && selection.model
            ? optionByModel.get(selection.model)
            : undefined
        if (!option && !concreteOption) {
          return (
            <div
              key={selection.family}
              className='border-destructive/40 bg-destructive/5 flex items-center gap-2 rounded-md border p-3'
            >
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium'>
                  {selection.model || familyLabel(selection.family || '')}
                </div>
                <div className='text-destructive text-xs'>
                  {t('This previously selected route is no longer available.')}
                </div>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='text-muted-foreground hover:text-destructive shrink-0'
                onClick={() =>
                  onChange(
                    value.filter((_, currentIndex) => currentIndex !== index)
                  )
                }
                aria-label={t('Remove model family')}
                title={t('Remove model family')}
              >
                <Trash2 className='size-4' />
              </Button>
            </div>
          )
        }
        const activeOption = concreteOption || option
        if (!activeOption) return null
        const range = [selection.min_multiplier, selection.max_multiplier]
        const sliderMax = Math.max(
          activeOption.slider_max_multiplier,
          selection.min_multiplier,
          selection.max_multiplier
        )
        const displayValue =
          options.mode === 'provider' || concreteMode
            ? (selection.multipliers?.[0] ??
              selection.exact_multipliers?.[0] ??
              activeOption.exact_multipliers?.[0] ??
              0)
            : selection.max_multiplier
        const tier = getHighestTier(
          options.tier_ceilings[selection.family],
          displayValue
        )
        const multiplierPresets = getMultiplierPresets(
          activeOption,
          options.tier_ceilings[selection.family],
          t
        )
        const matching = activeOption.availability.filter((bucket) =>
          options.mode === 'provider' || concreteMode
            ? (selection.multipliers || selection.exact_multipliers || []).some(
                (multiplier) =>
                  Math.abs(bucket.multiplier - multiplier) < 0.0005
              )
            : bucket.multiplier >= selection.min_multiplier - 0.0005 &&
              bucket.multiplier <= selection.max_multiplier + 0.0005
        )
        const channelCount = matching.reduce(
          (total, bucket) => total + bucket.channel_count,
          0
        )
        const providerCount = new Set(
          matching.flatMap((bucket) => bucket.provider_ids || [])
        ).size

        return (
          <div
            key={selection.family}
            className='bg-muted/20 space-y-3 rounded-md border p-3'
          >
            <div className='flex items-center gap-2'>
              <Select
                value={concreteMode ? selection.model : selection.family}
                onValueChange={(family) => {
                  if (!family) return
                  const next = concreteMode
                    ? optionByModel.get(family)
                    : optionByFamily.get(family)
                  if (!next) return
                  updateSelection(
                    index,
                    concreteMode
                      ? {
                          model: (next as HubTokenRoutingModelOption).model,
                          family: undefined,
                          min_multiplier: next.min_multiplier,
                          max_multiplier: Math.min(next.max_multiplier, 1),
                          multipliers: next.exact_multipliers?.slice(0, 1),
                        }
                      : defaultSelection(
                          next,
                          options.mode === 'public_pool'
                            ? options.tier_ceilings[next.key]
                            : undefined
                        )
                  )
                }}
              >
                <SelectTrigger className='min-w-0 flex-1'>
                  <SelectValue>
                    {selection.model || familyLabel(selection.family || '')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(concreteMode ? modelOptions : options.families).map(
                    (familyOption) => (
                      <SelectItem
                        key={
                          concreteMode
                            ? (familyOption as HubTokenRoutingModelOption).model
                            : familyOption.key
                        }
                        value={
                          concreteMode
                            ? (familyOption as HubTokenRoutingModelOption).model
                            : familyOption.key
                        }
                        disabled={
                          (concreteMode
                            ? (familyOption as HubTokenRoutingModelOption)
                                .model !== selection.model
                            : familyOption.key !== selection.family) &&
                          value.some((item) =>
                            concreteMode
                              ? item.model ===
                                (familyOption as HubTokenRoutingModelOption)
                                  .model
                              : item.family === familyOption.key
                          )
                        }
                      >
                        {concreteMode
                          ? (familyOption as HubTokenRoutingModelOption).model
                          : familyLabel(familyOption.key)}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='text-muted-foreground hover:text-destructive shrink-0'
                onClick={() =>
                  onChange(
                    value.filter((_, currentIndex) => currentIndex !== index)
                  )
                }
                aria-label={t('Remove model family')}
                title={t('Remove model family')}
              >
                <Trash2 className='size-4' />
              </Button>
            </div>

            {options.mode === 'provider' || concreteMode ? (
              <div
                className='border-muted-foreground/25 flex flex-wrap gap-x-4 gap-y-2 rounded-md border px-3 py-2'
                role='group'
                aria-label={t('Select published multipliers')}
              >
                {(activeOption.exact_multipliers || []).map((multiplier) => {
                  const selected = (selection.exact_multipliers || []).some(
                    (value) => Math.abs(value - multiplier) < 0.0005
                  )
                  return (
                    <label
                      key={multiplier}
                      className='flex items-center gap-2 text-sm'
                    >
                      <Checkbox
                        checked={selected}
                        disabled={
                          selected &&
                          (selection.exact_multipliers || []).length === 1
                        }
                        onCheckedChange={(checked) => {
                          const current =
                            selection.multipliers ||
                            selection.exact_multipliers ||
                            []
                          const next = checked
                            ? [...current, multiplier]
                            : current.filter(
                                (value) =>
                                  Math.abs(value - multiplier) >= 0.0005
                              )
                          updateSelection(index, {
                            multipliers: next.length > 0 ? next : undefined,
                            exact_multipliers:
                              next.length > 0 ? next : undefined,
                            min_multiplier: next[0] ?? 0,
                            max_multiplier: next[0] ?? 0,
                          })
                        }}
                      />
                      <span>{formatHubMultiplier(multiplier)}</span>
                    </label>
                  )
                })}
                {(selection.multipliers || selection.exact_multipliers || [])
                  .length > 1 && (
                  <div className='basis-full border-t pt-2 text-xs'>
                    <span className='text-muted-foreground mr-2'>
                      {t('Route order (first is preferred)')}
                    </span>
                    {(
                      selection.multipliers ||
                      selection.exact_multipliers ||
                      []
                    ).map((multiplier, multiplierIndex, ordered) => (
                      <span
                        key={`${multiplier}-${multiplierIndex}`}
                        className='mr-1 inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5'
                      >
                        {formatHubMultiplier(multiplier)}
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='size-4'
                          disabled={multiplierIndex === 0}
                          aria-label={t('Move multiplier up')}
                          title={t('Move multiplier up')}
                          onClick={() => {
                            const next = [...ordered]
                            ;[
                              next[multiplierIndex - 1],
                              next[multiplierIndex],
                            ] = [
                              next[multiplierIndex],
                              next[multiplierIndex - 1],
                            ]
                            updateSelection(index, {
                              multipliers: next,
                              exact_multipliers: next,
                            })
                          }}
                        >
                          <ChevronUp className='size-3' />
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='size-4'
                          disabled={multiplierIndex === ordered.length - 1}
                          aria-label={t('Move multiplier down')}
                          title={t('Move multiplier down')}
                          onClick={() => {
                            const next = [...ordered]
                            ;[
                              next[multiplierIndex],
                              next[multiplierIndex + 1],
                            ] = [
                              next[multiplierIndex + 1],
                              next[multiplierIndex],
                            ]
                            updateSelection(index, {
                              multipliers: next,
                              exact_multipliers: next,
                            })
                          }}
                        >
                          <ChevronDown className='size-3' />
                        </Button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className='space-y-2'>
                <div
                  className='flex flex-wrap items-center gap-1.5'
                  role='group'
                  aria-label={t('Multiplier range')}
                >
                  {multiplierPresets.map((preset) => {
                    const isActive =
                      selection.min_multiplier === preset.min &&
                      selection.max_multiplier === preset.max

                    return (
                      <Button
                        key={preset.key}
                        type='button'
                        size='xs'
                        variant={isActive ? 'secondary' : 'outline'}
                        aria-pressed={isActive}
                        data-multiplier-preset={preset.key}
                        onClick={() =>
                          updateSelection(index, {
                            min_multiplier: preset.min,
                            max_multiplier: preset.max,
                          })
                        }
                      >
                        {preset.label}
                      </Button>
                    )
                  })}
                </div>
                <Slider
                  min={option.min_multiplier}
                  max={sliderMax}
                  step={option.step}
                  value={range}
                  onValueChange={(next) => {
                    if (!Array.isArray(next) || next.length !== 2) return
                    updateSelection(index, {
                      min_multiplier: clampMultiplier(
                        next[0],
                        option.min_multiplier,
                        next[1]
                      ),
                      max_multiplier: clampMultiplier(
                        next[1],
                        next[0],
                        option.max_multiplier
                      ),
                    })
                  }}
                  aria-label={t('Multiplier range')}
                />
                <div className='grid grid-cols-2 gap-2'>
                  <label className='space-y-1 text-xs'>
                    <span className='text-muted-foreground'>
                      {t('Minimum multiplier')}
                    </span>
                    <Input
                      type='number'
                      inputMode='decimal'
                      min={option.min_multiplier}
                      max={selection.max_multiplier}
                      step={option.step}
                      value={selection.min_multiplier}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        if (!Number.isFinite(next)) return
                        updateSelection(index, {
                          min_multiplier: clampMultiplier(
                            next,
                            option.min_multiplier,
                            selection.max_multiplier
                          ),
                        })
                      }}
                      className='font-mono'
                    />
                  </label>
                  <label className='space-y-1 text-xs'>
                    <span className='text-muted-foreground'>
                      {t('Maximum multiplier')}
                    </span>
                    <Input
                      type='number'
                      inputMode='decimal'
                      min={selection.min_multiplier}
                      max={option.max_multiplier}
                      step={option.step}
                      value={selection.max_multiplier}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        if (!Number.isFinite(next)) return
                        updateSelection(index, {
                          max_multiplier: clampMultiplier(
                            next,
                            selection.min_multiplier,
                            option.max_multiplier
                          ),
                        })
                      }}
                      className='font-mono'
                    />
                  </label>
                </div>
              </div>
            )}

            <div className='flex flex-wrap items-center gap-2 text-xs'>
              {tier && <Badge variant='secondary'>{t(tier)}</Badge>}
              <span className='text-muted-foreground'>
                {t('{{channels}} channels / {{providers}} providers', {
                  channels: channelCount,
                  providers: providerCount,
                })}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
