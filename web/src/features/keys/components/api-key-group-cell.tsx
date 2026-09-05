import { useTranslation } from 'react-i18next'

import { BadgeCell, TruncatedCell } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { ApiKey } from '../types'
import { GroupRatioBadge, type GroupRatio } from './auto-group-visuals'

type ApiKeyGroupCellProps = {
  crossGroupRetry: boolean
  group: string
  ratio?: GroupRatio
  shouldReduceMotion: boolean
  policy?: ApiKey['hub_routing_policy']
}

export function ApiKeyGroupCell(props: ApiKeyGroupCellProps) {
  const { t } = useTranslation()
  if (props.policy?.mode === 'channels') {
    if (props.policy.channel_ids?.length) {
      const summary = props.policy.channel_ids
        .map((id) => t('Channel #{{id}}', { id }))
        .join(' / ')
      return (
        <TruncatedCell
          className='max-w-[210px] text-xs'
          tooltipContent={summary}
        >
          {t('{{count}} channels selected', {
            count: props.policy.channel_ids.length,
          })}
        </TruncatedCell>
      )
    }
    return (
      <span className='text-destructive text-xs'>
        {t('Channel selection required')}
      </span>
    )
  }

  if (props.policy) {
    return (
      <span className='text-destructive text-xs'>
        {t('Channel selection required')}
      </span>
    )
  }

  if (props.group !== 'auto') {
    const ratio = typeof props.ratio === 'number' ? props.ratio : undefined
    return (
      <TruncatedCell className='-ml-1.5' tooltipContent={props.group}>
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
        <GroupRatioBadge
          ratio={props.ratio}
          isAuto
          shouldReduceMotion={props.shouldReduceMotion}
        />
      </TooltipTrigger>
      <TooltipContent>
        {t(
          'Automatically selects the best available group with circuit breaker mechanism'
        )}
      </TooltipContent>
    </Tooltip>
  )
}
