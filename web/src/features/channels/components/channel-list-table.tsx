import type { TFunction } from 'i18next'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, type DataTablePageProps } from '@/components/data-table'
import { Input } from '@/components/ui/input'
import { getLobeIcon } from '@/lib/lobe-icon'

import { getChannelTypeIcon, getChannelTypeLabel } from '../lib'
import type { ChannelListState } from './use-channel-list-state'

function buildTypeFilterOptions(
  typeCounts: Record<string, number> | undefined,
  selectedType: string | undefined,
  t: TFunction
) {
  const counts = typeCounts || {}
  const typeIds = Object.entries(counts)
    .map(([type, count]) => ({ type: Number(type), count: Number(count) || 0 }))
    .filter((item) => item.type > 0 && item.count > 0)
    .sort((a, b) =>
      t(getChannelTypeLabel(a.type)).localeCompare(
        t(getChannelTypeLabel(b.type))
      )
    )
  if (selectedType) {
    const selectedTypeId = Number(selectedType)
    if (
      selectedTypeId > 0 &&
      !typeIds.some((item) => item.type === selectedTypeId)
    ) {
      typeIds.push({
        type: selectedTypeId,
        count: Number(counts[selectedType]) || 0,
      })
    }
  }
  const totalTypes = Object.values(counts).reduce(
    (sum, count) => sum + (Number(count) || 0),
    0
  )
  return [
    { label: 'All Types', value: 'all', count: totalTypes },
    ...typeIds.map((item) => ({
      label: getChannelTypeLabel(item.type),
      value: String(item.type),
      count: item.count,
      iconNode: getLobeIcon(`${getChannelTypeIcon(item.type)}.Color`, 16),
    })),
  ]
}

type ChannelListTablePageProps<TData> = Omit<
  DataTablePageProps<TData>,
  'toolbarProps'
> & {
  state: ChannelListState
  typeCounts?: Record<string, number>
  statusOptions: ReadonlyArray<{ label: string; value: string }>
  groupOptions?: Array<{ label: string; value: string }>
  ownershipOptions?: Array<{
    label: string
    value: string
    count?: number
  }>
  searchPlaceholder: string
  modelSearchPlaceholder: string
  toolbarPreActions?: ReactNode
  onReset?: () => void
}

export function ChannelListTablePage<TData>(
  props: ChannelListTablePageProps<TData>
) {
  const { t } = useTranslation()
  const typeFilterOptions = useMemo(
    () => buildTypeFilterOptions(props.typeCounts, props.state.selectedType, t),
    [props.state.selectedType, props.typeCounts, t]
  )
  const filters = [
    {
      columnId: 'status',
      title: t('Status'),
      options: [...props.statusOptions],
      singleSelect: true,
    },
    {
      columnId: 'type',
      title: t('Type'),
      options: typeFilterOptions,
      singleSelect: true,
    },
  ]
  if (props.groupOptions) {
    filters.push({
      columnId: 'group',
      title: t('Group'),
      options: props.groupOptions,
      singleSelect: true,
    })
  }
  if (props.ownershipOptions) {
    filters.push({
      columnId: 'ownership',
      title: t('Ownership'),
      options: props.ownershipOptions,
      singleSelect: true,
    })
  }

  const {
    state,
    typeCounts: _typeCounts,
    statusOptions: _statusOptions,
    groupOptions: _groupOptions,
    ownershipOptions: _ownershipOptions,
    searchPlaceholder,
    modelSearchPlaceholder,
    toolbarPreActions,
    onReset,
    ...pageProps
  } = props

  return (
    <DataTablePage
      {...pageProps}
      toolbarProps={{
        searchPlaceholder,
        searchDebounceMs: 500,
        onReset: () => {
          state.resetModelFilterInput()
          onReset?.()
        },
        additionalSearch: (
          <Input
            placeholder={modelSearchPlaceholder}
            value={state.modelFilterInput}
            onChange={state.onModelFilterInputChange}
            onCompositionStart={state.onModelFilterCompositionStart}
            onCompositionEnd={state.onModelFilterCompositionEnd}
            className='w-full sm:w-[150px] lg:w-[180px]'
          />
        ),
        filters,
        preActions: toolbarPreActions,
      }}
    />
  )
}
