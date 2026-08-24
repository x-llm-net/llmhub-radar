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
import { Building2, ImageOff, Loader2, QrCode } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { getProviderPayoutAssetBlob } from '../api'
import type {
  HubProviderPayoutAccountDetails,
  HubProviderPayoutMethod,
} from '../types'
import {
  payoutAccountTypeLabel,
  payoutMethodLabel,
} from './payout-account-utils'

export function PayoutAccountDetails(props: {
  method: HubProviderPayoutMethod
  details: HubProviderPayoutAccountDetails
  maskedSummary?: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const { details } = props
  const account = props.maskedSummary || details.account || '-'
  const Icon = props.method === 'bank' ? Building2 : QrCode
  const secondary =
    props.method === 'bank'
      ? [details.bank_name, account].filter(Boolean).join(' · ')
      : account
  let iconClassName = 'bg-muted text-muted-foreground'
  if (props.method === 'wechat') {
    iconClassName = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  } else if (props.method === 'alipay') {
    iconClassName = 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
  }

  if (props.compact) {
    return (
      <div className='flex min-w-0 items-center gap-2.5'>
        <div
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md',
            iconClassName
          )}
        >
          <Icon className='size-4' />
        </div>
        <div className='min-w-0 space-y-0.5'>
          <div className='flex min-w-0 items-center gap-1.5 text-sm'>
            <span className='shrink-0 font-medium'>
              {payoutMethodLabel(props.method, t)}
            </span>
            <span className='text-muted-foreground'>·</span>
            <span className='truncate'>{details.recipient_name || '-'}</span>
          </div>
          <p className='text-muted-foreground truncate font-mono text-xs'>
            {secondary}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='min-w-0 space-y-3'>
      <div className='flex items-center gap-3'>
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md',
            iconClassName
          )}
        >
          <Icon className='size-4.5' />
        </div>
        <div className='min-w-0'>
          <p className='font-medium'>{payoutMethodLabel(props.method, t)}</p>
          <p className='text-muted-foreground text-sm break-words'>
            {details.recipient_name || '-'}
          </p>
        </div>
      </div>
      {props.method === 'bank' && (
        <p className='text-muted-foreground text-sm break-words'>
          {payoutAccountTypeLabel(details.account_type, t)} ·{' '}
          {details.bank_name || '-'}
          {details.bank_branch ? ` · ${details.bank_branch}` : ''}
        </p>
      )}
      <p className='bg-muted/50 text-muted-foreground w-fit max-w-full rounded-md px-2 py-1 font-mono text-xs break-all'>
        {account}
      </p>
    </div>
  )
}

export function PayoutQRCodeImage(props: {
  assetId: number
  alt: string
  className?: string
  previewable?: boolean
  getAssetBlob?: (assetId: number) => Promise<Blob>
}) {
  const [url, setURL] = useState('')
  const [loading, setLoading] = useState(false)
  const assetId = props.assetId
  const getAssetBlob = props.getAssetBlob

  useEffect(() => {
    if (assetId <= 0) {
      setURL('')
      return
    }
    let active = true
    let objectURL = ''
    setLoading(true)
    const loadImage = async () => {
      try {
        const blob = await (getAssetBlob ?? getProviderPayoutAssetBlob)(assetId)
        if (!active) return
        objectURL = URL.createObjectURL(blob)
        setURL(objectURL)
      } catch {
        if (active) setURL('')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadImage()
    return () => {
      active = false
      if (objectURL) URL.revokeObjectURL(objectURL)
    }
  }, [assetId, getAssetBlob])

  if (loading) {
    return (
      <div
        className={cn(
          'bg-muted/40 flex size-32 items-center justify-center rounded-md border',
          props.className
        )}
      >
        <Loader2 className='text-muted-foreground animate-spin' />
      </div>
    )
  }
  if (!url) {
    return (
      <div
        className={cn(
          'bg-muted/40 text-muted-foreground flex size-32 items-center justify-center rounded-md border',
          props.className
        )}
      >
        <ImageOff />
      </div>
    )
  }
  const image = (
    <img
      src={url}
      alt={props.alt}
      className={cn(
        'size-32 rounded-md border bg-white object-contain p-1',
        props.className
      )}
    />
  )
  if (!props.previewable) return image
  return (
    <a
      href={url}
      target='_blank'
      rel='noreferrer'
      aria-label={props.alt}
      title={props.alt}
      className='block w-fit max-w-full cursor-zoom-in'
    >
      {image}
    </a>
  )
}
