import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { getAdminProviders } from '@/features/providers/api'

import {
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateServiceTierRouting } from '../hooks/use-update-service-tier-routing'

const FAMILY_ORDER = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'alibaba',
  'bytedance',
  'zhipu',
  'other',
] as const

const FAMILY_LABELS: Record<(typeof FAMILY_ORDER)[number], string> = {
  anthropic: 'Anthropic / Claude',
  openai: 'OpenAI',
  google: 'Google / Gemini',
  xai: 'xAI / Grok',
  deepseek: 'DeepSeek',
  alibaba: 'Alibaba / Qwen',
  bytedance: 'ByteDance / Doubao',
  zhipu: 'Zhipu / GLM',
  other: 'Other',
}

type FamilyKey = (typeof FAMILY_ORDER)[number]

type TierCeilings = {
  special: number
  low: number
  medium: number
  high: number
}

type FamilyTierCeilings = Record<FamilyKey, TierCeilings>

const DEFAULT_CEILINGS: FamilyTierCeilings = {
  anthropic: { special: 0.2, low: 0.4, medium: 0.8, high: 1 },
  openai: { special: 0.1, low: 0.3, medium: 0.8, high: 1 },
  google: { special: 0.1, low: 0.3, medium: 0.8, high: 1 },
  xai: { special: 0.1, low: 0.3, medium: 0.8, high: 1 },
  deepseek: { special: 0.1, low: 0.3, medium: 0.8, high: 1 },
  alibaba: { special: 0.1, low: 0.3, medium: 0.8, high: 1 },
  bytedance: { special: 0.1, low: 0.3, medium: 0.8, high: 1 },
  zhipu: { special: 0.1, low: 0.3, medium: 0.8, high: 1 },
  other: { special: 0.1, low: 0.3, medium: 0.8, high: 1 },
}

type ServiceTierRoutingSectionProps = {
  defaultValues: {
    enabled: boolean
    allowOtherFamily: boolean
    familyTierCeilings: string
    highQualityProviderIDs: string
  }
}

function parseCeilings(value: string): FamilyTierCeilings {
  try {
    const parsed = JSON.parse(value || '{}') as Partial<FamilyTierCeilings>
    return Object.fromEntries(
      FAMILY_ORDER.map((family) => {
        const row = { ...DEFAULT_CEILINGS[family], ...parsed[family] }
        if (row.high === 100) row.high = 1
        return [family, row]
      })
    ) as FamilyTierCeilings
  } catch {
    return structuredClone(DEFAULT_CEILINGS)
  }
}

function parseProviderIDs(value: string): number[] {
  try {
    const parsed = JSON.parse(value || '[]')
    if (!Array.isArray(parsed)) return []
    return [
      ...new Set(
        parsed.filter(
          (providerID): providerID is number =>
            Number.isInteger(providerID) && providerID > 0
        )
      ),
    ].sort((left, right) => left - right)
  } catch {
    return []
  }
}

function normalizeCeilings(value: FamilyTierCeilings) {
  return JSON.stringify(value)
}

function validateCeilings(value: FamilyTierCeilings): FamilyKey | null {
  for (const family of FAMILY_ORDER) {
    const row = value[family]
    const values = [row.special, row.low, row.medium, row.high]
    if (
      values.some((boundary) => !Number.isFinite(boundary) || boundary <= 0) ||
      row.special >= row.low ||
      row.low >= row.medium
    ) {
      return family
    }
  }
  return null
}

export function ServiceTierRoutingSection({
  defaultValues,
}: ServiceTierRoutingSectionProps) {
  const { t } = useTranslation()
  const updateRouting = useUpdateServiceTierRouting()
  const initialCeilings = useMemo(
    () => parseCeilings(defaultValues.familyTierCeilings),
    [defaultValues.familyTierCeilings]
  )
  const initialProviderIDs = useMemo(
    () => parseProviderIDs(defaultValues.highQualityProviderIDs),
    [defaultValues.highQualityProviderIDs]
  )
  const [enabled, setEnabled] = useState(defaultValues.enabled)
  const [allowOtherFamily, setAllowOtherFamily] = useState(
    defaultValues.allowOtherFamily
  )
  const [ceilings, setCeilings] = useState<FamilyTierCeilings>(initialCeilings)
  const [approvedProviderIDs, setApprovedProviderIDs] =
    useState<number[]>(initialProviderIDs)
  const baselineRef = useRef({
    enabled: defaultValues.enabled,
    allowOtherFamily: defaultValues.allowOtherFamily,
    ceilings: normalizeCeilings(initialCeilings),
    providerIDs: JSON.stringify(initialProviderIDs),
  })

  useEffect(() => {
    setEnabled(defaultValues.enabled)
    setAllowOtherFamily(defaultValues.allowOtherFamily)
    setCeilings(initialCeilings)
    setApprovedProviderIDs(initialProviderIDs)
    baselineRef.current = {
      enabled: defaultValues.enabled,
      allowOtherFamily: defaultValues.allowOtherFamily,
      ceilings: normalizeCeilings(initialCeilings),
      providerIDs: JSON.stringify(initialProviderIDs),
    }
  }, [defaultValues, initialCeilings, initialProviderIDs])

  const providersQuery = useQuery({
    queryKey: ['hub-admin', 'providers', 'service-tier-routing'],
    queryFn: () => getAdminProviders({ p: 1, page_size: 1000 }),
  })
  const providers = providersQuery.data?.data?.items ?? []

  const updateCeiling = (
    family: FamilyKey,
    tier: keyof TierCeilings,
    rawValue: string
  ) => {
    const value = Number(rawValue)
    setCeilings((current) => ({
      ...current,
      [family]: { ...current[family], [tier]: value },
    }))
  }

  const toggleProvider = (providerID: number, checked: boolean) => {
    setApprovedProviderIDs((current) => {
      const next = checked
        ? [...current, providerID]
        : current.filter((id) => id !== providerID)
      return [...new Set(next)].sort((left, right) => left - right)
    })
  }

  const onSave = async () => {
    const invalidFamily = validateCeilings(ceilings)
    if (invalidFamily) {
      toast.error(
        t('Invalid tier boundaries for {{family}}', {
          family: FAMILY_LABELS[invalidFamily],
        })
      )
      return
    }
    const normalized = {
      enabled,
      allowOtherFamily,
      ceilings: normalizeCeilings(ceilings),
      providerIDs: JSON.stringify(approvedProviderIDs),
    }
    const hasChanges =
      normalized.enabled !== baselineRef.current.enabled ||
      normalized.allowOtherFamily !== baselineRef.current.allowOtherFamily ||
      normalized.ceilings !== baselineRef.current.ceilings ||
      normalized.providerIDs !== baselineRef.current.providerIDs
    if (!hasChanges) {
      toast.info(t('No changes to save'))
      return
    }

    try {
      await updateRouting.mutateAsync({
        enabled: normalized.enabled,
        allow_other_family: normalized.allowOtherFamily,
        family_tier_ceilings: ceilings,
        high_quality_provider_ids: approvedProviderIDs,
      })
    } catch {
      return
    }
    baselineRef.current = normalized
  }

  let providerOptions: ReactNode
  if (providersQuery.isLoading) {
    providerOptions = (
      <div className='text-muted-foreground flex h-24 items-center justify-center gap-2 text-sm'>
        <Loader2 className='size-4 animate-spin' />
        {t('Loading...')}
      </div>
    )
  } else if (providers.length === 0) {
    providerOptions = (
      <div className='text-muted-foreground flex h-24 items-center justify-center text-sm'>
        {t('No providers found')}
      </div>
    )
  } else {
    providerOptions = providers.map((provider) => (
      <label
        key={provider.id}
        className='hover:bg-muted/35 flex min-h-11 cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0'
      >
        <Checkbox
          checked={approvedProviderIDs.includes(provider.id)}
          onCheckedChange={(checked) =>
            toggleProvider(provider.id, checked === true)
          }
        />
        <span className='min-w-0 flex-1'>
          <span className='block truncate text-sm font-medium'>
            {provider.name}
          </span>
          <span className='text-muted-foreground block truncate text-xs'>
            {provider.owner_username} · {provider.channel_count} {t('channels')}
          </span>
        </span>
        <span className='text-muted-foreground text-xs tabular-nums'>
          #{provider.id}
        </span>
      </label>
    ))
  }

  return (
    <SettingsSection title={t('Service Tiers & Routing')}>
      <SettingsPageFormActions
        onSave={onSave}
        isSaving={updateRouting.isPending}
      />

      <div className='grid gap-4 lg:grid-cols-2'>
        <SettingsSwitchItem>
          <SettingsSwitchContent>
            <div className='text-sm font-medium'>{t('Tier routing')}</div>
            <div className='text-muted-foreground text-sm'>
              {t('Build supply eligibility from model family and multiplier')}
            </div>
          </SettingsSwitchContent>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </SettingsSwitchItem>

        <SettingsSwitchItem>
          <SettingsSwitchContent>
            <div className='text-sm font-medium'>
              {t('Allow unclassified model families')}
            </div>
            <div className='text-muted-foreground text-sm'>
              {t('Keep disabled until new model families are reviewed')}
            </div>
          </SettingsSwitchContent>
          <Switch
            checked={allowOtherFamily}
            onCheckedChange={setAllowOtherFamily}
          />
        </SettingsSwitchItem>
      </div>

      <Separator />

      <div className='min-w-0 space-y-3'>
        <div>
          <h4 className='text-sm font-medium'>{t('Multiplier boundaries')}</h4>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Price tiers are exclusive; approved supply may also enter high quality'
            )}
          </p>
        </div>
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full min-w-[760px] text-sm'>
            <thead className='bg-muted/45 text-muted-foreground'>
              <tr className='border-b'>
                <th className='h-10 px-3 text-left font-medium'>
                  {t('Model family')}
                </th>
                <th className='h-10 px-3 text-left font-medium'>
                  {t('Special price')}
                </th>
                <th className='h-10 px-3 text-left font-medium'>
                  {t('Economy')}
                </th>
                <th className='h-10 px-3 text-left font-medium'>
                  {t('Standard')}
                </th>
                <th className='h-10 px-3 text-left font-medium'>
                  <span className='block'>{t('High quality')}</span>
                  <span className='block text-xs font-normal'>
                    {t('Maximum approved multiplier')}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {FAMILY_ORDER.map((family) => (
                <tr key={family} className='border-b last:border-b-0'>
                  <td className='h-12 px-3 font-medium'>
                    {FAMILY_LABELS[family]}
                  </td>
                  {(['special', 'low', 'medium', 'high'] as const).map(
                    (tier) => (
                      <td key={tier} className='px-3 py-2'>
                        <div className='relative w-28'>
                          <Input
                            className='h-8 w-full pr-7 tabular-nums'
                            type='number'
                            min='0.0001'
                            step='0.01'
                            value={ceilings[family][tier]}
                            onChange={(event) =>
                              updateCeiling(family, tier, event.target.value)
                            }
                          />
                          <span className='text-muted-foreground pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs'>
                            x
                          </span>
                        </div>
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Separator />

      <div className='space-y-3'>
        <div>
          <h4 className='text-sm font-medium'>
            {t('High-quality provider approval')}
          </h4>
          <p className='text-muted-foreground text-sm'>
            {t('Only approved providers can enter the high-quality tier')}
          </p>
        </div>
        <div className='max-h-64 overflow-y-auto rounded-md border'>
          {providerOptions}
        </div>
      </div>
    </SettingsSection>
  )
}
