import { useTranslation } from 'react-i18next'

import { BadgeCell, TruncatedCell } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { HubTokenRoutingPolicy } from '../types'
import {
  // AutoGroupBadge,
  GroupRatioBadge,
  type GroupRatio,
} from './auto-group-visuals'

type ApiKeyGroupCellProps = {
  crossGroupRetry: boolean
  group: string
  ratio?: GroupRatio
  shouldReduceMotion: boolean
  policy?: HubTokenRoutingPolicy | null
}

const HUB_FAMILY_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  alibaba: 'Qwen',
  bytedance: 'ByteDance',
  zhipu: 'GLM',
  other: 'Other models',
}

export function ApiKeyGroupCell(props: ApiKeyGroupCellProps) {
  const { t } = useTranslation()

  if (props.policy?.selections.length) {
    const summary = props.policy.selections
      .map((selection) => {
        const family = t(
          HUB_FAMILY_LABELS[selection.family] || selection.family
        )
        const exact = selection.exact_multipliers?.[0]
        if (exact !== undefined) return `${family} ${exact.toFixed(3)}x`
        return `${family} ${(selection.min_multiplier ?? 0).toFixed(3)}x-${(
          selection.max_multiplier ?? 0
        ).toFixed(3)}x`
      })
      .join(' / ')
    return (
      <TruncatedCell
        className='max-w-[210px] font-mono text-xs'
        tooltipContent={summary}
      >
        {summary}
      </TruncatedCell>
    )
  }

  if (props.group !== 'auto') {
    const ratio = typeof props.ratio === 'number' ? props.ratio : undefined
    return (
      <TruncatedCell
        className='-ml-1.5'
        tooltipContent={props.group || '-'}
        tooltipClassName='break-all'
      >
        <GroupBadge group={props.group} ratio={ratio} />
      </TruncatedCell>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <BadgeCell
            data-api-key-group-cell='auto'
            className='gap-1.5 overflow-visible text-xs'
          />
        }
      >
        <StatusBadge label={t('Cross-group')} variant='info' copyable={false} />
        {/*<AutoGroupBadge shouldReduceMotion={props.shouldReduceMotion} />*/}
        <GroupRatioBadge
          ratio={props.ratio}
          isAuto
          shouldReduceMotion={props.shouldReduceMotion}
        />
      </TooltipTrigger>
      <TooltipContent>
        <span className='text-xs'>
          {t(
            'Automatically selects the best available group with circuit breaker mechanism'
          )}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
