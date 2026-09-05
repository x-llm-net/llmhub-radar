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
import { ChevronDown, ChevronUp, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { MAX_HUB_CHANNEL_SELECTIONS } from '../lib/api-key-form'
import { formatHubMultiplier } from '../lib/multiplier'
import type {
  HubTokenRoutingChannelOption,
  HubTokenRoutingOptions,
} from '../types'

type HubRoutingPolicyEditorProps = {
  options: HubTokenRoutingOptions
  value: number[]
  onChange: (value: number[]) => void
}

const familyLabels: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'GPT',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  alibaba: 'Qwen',
  bytedance: 'Doubao',
  zhipu: 'GLM',
  image: 'Image',
}

function ChannelDetails(props: { channel: HubTokenRoutingChannelOption }) {
  const { t } = useTranslation()
  const families = props.channel.model_families ?? []
  const visibleFamilies = families.slice(0, 3)
  return (
    <div className='min-w-0 flex-1 space-y-1'>
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
        <span className='min-w-0 text-sm font-medium break-all'>
          {props.channel.name}
        </span>
        <span className='shrink-0 font-mono text-xs tabular-nums'>
          {formatHubMultiplier(props.channel.multiplier)}
        </span>
        {!props.channel.available && (
          <Badge variant='outline'>{t('Unavailable')}</Badge>
        )}
      </div>
      <div className='flex min-w-0 flex-wrap items-center gap-1'>
        {visibleFamilies.map((family) => (
          <Badge key={family} variant='secondary' className='px-1.5 py-0'>
            {family === 'image'
              ? t('Image')
              : (familyLabels[family] ?? t('Other'))}
          </Badge>
        ))}
        {families.length > visibleFamilies.length && (
          <Badge variant='outline' className='px-1.5 py-0'>
            +{families.length - visibleFamilies.length}
          </Badge>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className='text-muted-foreground cursor-help text-xs'
                tabIndex={0}
                aria-label={t('Supported models')}
              />
            }
          >
            {props.channel.models.length > 0
              ? t('{{count}} models', { count: props.channel.models.length })
              : t('No supported models')}
          </TooltipTrigger>
          {props.channel.models.length > 0 && (
            <TooltipContent className='max-w-80 break-words'>
              {props.channel.models.join(', ')}
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </div>
  )
}

function OrderButton(props: {
  direction: 'up' | 'down'
  channelName: string
  disabled: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const label =
    props.direction === 'up'
      ? t('Move {{name}} up', { name: props.channelName })
      : t('Move {{name}} down', { name: props.channelName })
  const Icon = props.direction === 'up' ? ChevronUp : ChevronDown
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-8 shrink-0'
            disabled={props.disabled}
            aria-label={label}
            onClick={props.onClick}
          />
        }
      >
        <Icon className='size-4' aria-hidden='true' />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function HubRoutingPolicyEditor(props: HubRoutingPolicyEditorProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const channelsById = useMemo(
    () =>
      new Map(
        props.options.channels.map((channel) => [channel.channel_id, channel])
      ),
    [props.options.channels]
  )
  const visibleChannels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return [...props.options.channels]
      .sort(
        (left, right) =>
          left.multiplier - right.multiplier ||
          left.channel_id - right.channel_id
      )
      .filter((channel) =>
        [channel.name, ...channel.models].some((text) =>
          text.toLocaleLowerCase().includes(normalizedQuery)
        )
      )
  }, [props.options.channels, query])

  function moveChannel(index: number, offset: number) {
    const next = [...props.value]
    const destination = index + offset
    if (destination < 0 || destination >= next.length) return
    const channelId = next[index]
    next[index] = next[destination]
    next[destination] = channelId
    props.onChange(next)
  }

  return (
    <div
      className='min-w-0 space-y-3'
      role='group'
      aria-label={t('Channel routing')}
    >
      <div className='grid min-w-0 items-start gap-4 sm:grid-cols-2'>
        <section className='min-w-0 space-y-2'>
          <span className='block text-sm font-medium'>
            {t('Available channels')}
          </span>
          <div className='relative'>
            <Search
              className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
              aria-hidden='true'
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search channels or models')}
              aria-label={t('Search channels or models')}
              className='pl-9'
            />
          </div>
          <div
            className='h-64 overflow-y-auto overscroll-contain rounded-md border'
            role='group'
            aria-label={t('Available channels')}
          >
            {visibleChannels.map((channel) => {
              const selected = props.value.includes(channel.channel_id)
              const disabled =
                !selected &&
                (!channel.available ||
                  props.value.length >= MAX_HUB_CHANNEL_SELECTIONS)
              return (
                <div
                  key={channel.channel_id}
                  className='flex min-w-0 items-start gap-3 border-b px-3 py-2.5 last:border-b-0'
                >
                  <Checkbox
                    id={`hub-channel-choice-${channel.channel_id}`}
                    className='mt-0.5 shrink-0'
                    checked={selected}
                    disabled={disabled}
                    aria-label={t('Select {{name}}', { name: channel.name })}
                    onCheckedChange={(checked) =>
                      props.onChange(
                        checked
                          ? [...props.value, channel.channel_id]
                          : props.value.filter(
                              (id) => id !== channel.channel_id
                            )
                      )
                    }
                  />
                  <label
                    htmlFor={`hub-channel-choice-${channel.channel_id}`}
                    className='min-w-0 flex-1 cursor-pointer'
                  >
                    <ChannelDetails channel={channel} />
                  </label>
                </div>
              )
            })}
            {visibleChannels.length === 0 && (
              <p
                className='text-muted-foreground py-6 text-center text-sm'
                role='status'
              >
                {props.options.channels.length === 0
                  ? t('No channels available')
                  : t('No matching channels')}
              </p>
            )}
          </div>
        </section>

        <section className='min-w-0 space-y-2'>
          <div className='flex min-h-9 flex-wrap items-center justify-between gap-2'>
            <span className='text-sm font-medium'>{t('Channel order')}</span>
            <span className='text-muted-foreground text-xs'>
              {t('{{count}} / {{max}} channels selected', {
                count: props.value.length,
                max: MAX_HUB_CHANNEL_SELECTIONS,
              })}
            </span>
          </div>
          <div className='h-[300px] overflow-y-auto overscroll-contain rounded-md border'>
            {props.value.length === 0 ? (
              <p className='text-muted-foreground py-6 text-center text-sm'>
                {t('No channels selected')}
              </p>
            ) : (
              <ol className='divide-y' aria-label={t('Channel order')}>
                {props.value.map((channelId, index) => {
                  const channel = channelsById.get(channelId)
                  const name =
                    channel?.name || t('Channel #{{id}}', { id: channelId })
                  const removeLabel = t('Remove {{name}}', { name })
                  return (
                    <li
                      key={channelId}
                      className='flex min-w-0 items-start gap-1 px-2 py-2.5'
                    >
                      <span className='text-muted-foreground w-5 shrink-0 pt-1 text-center text-xs tabular-nums'>
                        {index + 1}
                      </span>
                      {channel ? (
                        <ChannelDetails channel={channel} />
                      ) : (
                        <div className='min-w-0 flex-1 text-sm'>
                          <div className='break-all'>{name}</div>
                          <div className='text-destructive text-xs'>
                            {t('Channel no longer exists')}
                          </div>
                        </div>
                      )}
                      <div className='flex shrink-0 items-center'>
                        <OrderButton
                          direction='up'
                          channelName={name}
                          disabled={index === 0}
                          onClick={() => moveChannel(index, -1)}
                        />
                        <OrderButton
                          direction='down'
                          channelName={name}
                          disabled={index === props.value.length - 1}
                          onClick={() => moveChannel(index, 1)}
                        />
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon'
                                className='text-muted-foreground hover:text-destructive size-8 shrink-0'
                                aria-label={removeLabel}
                                onClick={() =>
                                  props.onChange(
                                    props.value.filter((id) => id !== channelId)
                                  )
                                }
                              />
                            }
                          >
                            <Trash2 className='size-4' aria-hidden='true' />
                          </TooltipTrigger>
                          <TooltipContent>{removeLabel}</TooltipContent>
                        </Tooltip>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
