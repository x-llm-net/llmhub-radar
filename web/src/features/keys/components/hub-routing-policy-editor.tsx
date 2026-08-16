import { Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'

import type {
  HubTokenRoutingFamilyOption,
  HubTokenRoutingOptions,
} from '../types'

export type HubRoutingSelectionFormValue = {
  family: string
  min_multiplier: number
  max_multiplier: number
  exact_multiplier?: number
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

function familyLabel(key: string): string {
  return FAMILY_LABELS[key] || key
}

function formatMultiplier(value: number): string {
  return value.toFixed(3)
}

function clampMultiplier(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)) * 1000) / 1000
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

function defaultSelection(option: HubTokenRoutingFamilyOption) {
  return {
    family: option.key,
    min_multiplier: option.min_multiplier,
    max_multiplier: Math.min(1, option.max_multiplier),
    exact_multiplier: option.exact_multipliers?.[0],
  }
}

export function HubRoutingPolicyEditor({
  options,
  value,
  onChange,
}: HubRoutingPolicyEditorProps) {
  const { t } = useTranslation()
  const optionByFamily = useMemo(
    () => new Map(options.families.map((option) => [option.key, option])),
    [options.families]
  )

  const addSelection = () => {
    const available = options.families.find(
      (option) => !value.some((selection) => selection.family === option.key)
    )
    if (!available || value.length >= 8) return
    onChange([...value, defaultSelection(available)])
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
            value.length >= 8 || value.length >= options.families.length
          }
        >
          <Plus className='mr-1.5 size-3.5' />
          {t('Add model family')}
        </Button>
      </div>

      {value.length === 0 && (
        <div className='border-muted-foreground/25 bg-muted/30 text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-xs'>
          {options.families.length === 0
            ? t('This provider has no published routes available for API keys.')
            : t(
                'Add at least one model family to control which channels this key can use.'
              )}
        </div>
      )}

      {value.map((selection, index) => {
        const option = optionByFamily.get(selection.family)
        if (!option) {
          return (
            <div
              key={selection.family}
              className='border-destructive/40 bg-destructive/5 flex items-center gap-2 rounded-md border p-3'
            >
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium'>
                  {familyLabel(selection.family)}
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
        const range = [selection.min_multiplier, selection.max_multiplier]
        const sliderMax = Math.max(
          option.slider_max_multiplier,
          selection.min_multiplier,
          selection.max_multiplier
        )
        const displayValue =
          options.mode === 'provider'
            ? (selection.exact_multiplier ?? option.exact_multipliers?.[0] ?? 0)
            : selection.max_multiplier
        const tier = getHighestTier(
          options.tier_ceilings[selection.family],
          displayValue
        )
        const matching = option.availability.filter((bucket) =>
          options.mode === 'provider'
            ? Math.abs(bucket.multiplier - displayValue) < 0.0005
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
                value={selection.family}
                onValueChange={(family) => {
                  if (!family) return
                  const next = optionByFamily.get(family)
                  if (!next) return
                  updateSelection(index, defaultSelection(next))
                }}
              >
                <SelectTrigger className='min-w-0 flex-1'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.families.map((familyOption) => (
                    <SelectItem
                      key={familyOption.key}
                      value={familyOption.key}
                      disabled={
                        familyOption.key !== selection.family &&
                        value.some((item) => item.family === familyOption.key)
                      }
                    >
                      {familyLabel(familyOption.key)}
                    </SelectItem>
                  ))}
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

            {options.mode === 'provider' ? (
              <Select
                value={selection.exact_multiplier?.toFixed(3)}
                onValueChange={(raw) => {
                  const multiplier = Number(raw)
                  updateSelection(index, {
                    exact_multiplier: multiplier,
                    min_multiplier: multiplier,
                    max_multiplier: multiplier,
                  })
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t('Select a published multiplier')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(option.exact_multipliers || []).map((multiplier) => (
                    <SelectItem key={multiplier} value={multiplier.toFixed(3)}>
                      {formatMultiplier(multiplier)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className='space-y-2'>
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
