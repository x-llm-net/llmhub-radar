/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ProviderWebsiteEvidenceImage } from '@/features/provider/provider-website-evidence-image'

import type { HubProviderAdminItem } from './types'

type ProviderReviewDialogProps = {
  provider: HubProviderAdminItem
  targetStatus: HubProviderAdminItem['status'] | null
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reviewRemark: string, approveWebsite: boolean) => void
}

function getActionLabel(
  currentStatus: HubProviderAdminItem['status'],
  status: HubProviderAdminItem['status'] | null,
  t: (key: string) => string
) {
  if (status === 'active') {
    if (currentStatus === 'active') return t('Review website')
    return t(
      currentStatus === 'disabled' ? 'Enable provider' : 'Approve provider'
    )
  }
  if (status === 'rejected') return t('Reject provider')
  if (status === 'disabled') return t('Disable provider')
  return t('Update provider')
}

function getContactTypeLabel(type: string): string {
  switch (type) {
    case 'wechat':
      return 'WeChat'
    case 'qq':
      return 'QQ'
    case 'telegram':
      return 'Telegram'
    case 'email':
      return 'Email'
    case 'phone':
      return 'Phone'
    default:
      return 'Other'
  }
}

function getWebsiteVerificationLabel(
  status: HubProviderAdminItem['website_verification_status']
): string {
  switch (status) {
    case 'verified':
      return 'Verified'
    case 'pending':
      return 'Under review'
    case 'rejected':
      return 'Verification rejected'
    default:
      return 'Not verified'
  }
}

function getWebsiteApprovalDescription(
  provider: HubProviderAdminItem,
  websiteReady: boolean,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!websiteReady) {
    return t(
      'No valid verification is available. The provider can still be approved with the suffixed subdomain.'
    )
  }
  if (provider.status === 'active') {
    return t(
      'The website will become public. The active subdomain will not change.'
    )
  }
  return t('The provider subdomain will become {{slug}}.', {
    slug: provider.slug_base,
  })
}

export function ProviderReviewDialog(props: ProviderReviewDialogProps) {
  const { t } = useTranslation()
  const [reviewRemark, setReviewRemark] = useState('')
  const [approveWebsite, setApproveWebsite] = useState(false)
  const requiresRemark = props.targetStatus === 'rejected'
  const websiteReady =
    props.provider.website_verification_status === 'verified' ||
    (props.provider.website_verification_status === 'pending' &&
      props.provider.website_verification_method === 'manual' &&
      props.provider.website_evidence_asset_id > 0)
  const actionLabel = getActionLabel(
    props.provider.status,
    props.targetStatus,
    t
  )

  useEffect(() => {
    if (props.open) {
      setReviewRemark('')
      setApproveWebsite(props.targetStatus === 'active' && websiteReady)
    }
  }, [props.open, props.targetStatus, websiteReady])

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={actionLabel}
      description={t('Review the provider application for {{name}}.', {
        name: props.provider.name,
      })}
      contentClassName='sm:max-w-lg'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={props.pending}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            variant={
              props.targetStatus === 'rejected' ||
              props.targetStatus === 'disabled'
                ? 'destructive'
                : 'default'
            }
            disabled={props.pending || (requiresRemark && !reviewRemark.trim())}
            onClick={() => props.onConfirm(reviewRemark.trim(), approveWebsite)}
          >
            {props.pending && <Loader2 className='animate-spin' />}
            {actionLabel}
          </Button>
        </>
      }
    >
      <div className='space-y-5'>
        <dl className='bg-muted/40 grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2'>
          <div className='min-w-0'>
            <dt className='text-muted-foreground'>{t('Owner')}</dt>
            <dd className='mt-1 truncate font-medium'>
              {props.provider.owner_display_name ||
                props.provider.owner_username}
            </dd>
            <dd className='text-muted-foreground truncate text-xs'>
              {props.provider.owner_email ||
                `@${props.provider.owner_username}`}
            </dd>
          </div>
          <div className='min-w-0'>
            <dt className='text-muted-foreground'>{t('Provider subdomain')}</dt>
            <dd className='mt-1 truncate font-medium'>{props.provider.slug}</dd>
          </div>
          {props.provider.website && (
            <div className='min-w-0 sm:col-span-2'>
              <dt className='text-muted-foreground'>{t('Website')}</dt>
              <dd className='mt-1 break-all'>{props.provider.website}</dd>
              <dd className='text-muted-foreground mt-1 text-xs'>
                {t('Website verification')}:{' '}
                {t(
                  getWebsiteVerificationLabel(
                    props.provider.website_verification_status
                  )
                )}
              </dd>
            </div>
          )}
          {props.provider.website_evidence_asset_id > 0 &&
            props.provider.website_verification_method === 'manual' && (
              <div className='min-w-0 sm:col-span-2'>
                <dt className='text-muted-foreground'>
                  {t('Verification screenshot')}
                </dt>
                <dd className='mt-2'>
                  <ProviderWebsiteEvidenceImage
                    assetId={props.provider.website_evidence_asset_id}
                    alt={t('Submitted verification screenshot')}
                    className='max-h-56 max-w-full rounded-md border object-contain'
                  />
                </dd>
              </div>
            )}
          {props.provider.description && (
            <div className='min-w-0 sm:col-span-2'>
              <dt className='text-muted-foreground'>{t('Description')}</dt>
              <dd className='mt-1 max-h-40 overflow-y-auto'>
                <RichContent content={props.provider.description} breaks />
              </dd>
            </div>
          )}
          <div className='min-w-0 sm:col-span-2'>
            <dt className='text-muted-foreground'>{t('Review contact')}</dt>
            <dd className='mt-1 font-medium break-all'>
              {t(getContactTypeLabel(props.provider.contact_type))}
              {' · '}
              {props.provider.contact_value || t('Not provided')}
            </dd>
          </div>
          {props.provider.support_value && (
            <div className='min-w-0 sm:col-span-2'>
              <dt className='text-muted-foreground'>
                {t('Public support entry')}
              </dt>
              <dd className='mt-1 break-all'>{props.provider.support_value}</dd>
            </div>
          )}
        </dl>
        {props.targetStatus === 'active' && props.provider.website && (
          <div className='flex items-start gap-3 rounded-md border px-4 py-3'>
            <Checkbox
              id={`provider-approve-website-${props.provider.id}`}
              checked={approveWebsite}
              disabled={!websiteReady || props.pending}
              onCheckedChange={(checked) => setApproveWebsite(checked === true)}
            />
            <div className='grid gap-1'>
              <Label htmlFor={`provider-approve-website-${props.provider.id}`}>
                {t('Confirm website ownership and use the clean subdomain')}
              </Label>
              <p className='text-muted-foreground text-xs'>
                {getWebsiteApprovalDescription(props.provider, websiteReady, t)}
              </p>
            </div>
          </div>
        )}
        <div className='space-y-2'>
          <Label htmlFor={`provider-review-${props.provider.id}`}>
            {requiresRemark ? t('Rejection reason') : t('Administrator note')}
            {requiresRemark && (
              <span className='text-destructive ml-0.5' aria-hidden='true'>
                *
              </span>
            )}
          </Label>
          <Textarea
            id={`provider-review-${props.provider.id}`}
            value={reviewRemark}
            onChange={(event) => setReviewRemark(event.target.value)}
            maxLength={1000}
            className='min-h-24 resize-y'
            placeholder={
              requiresRemark
                ? t('Enter the rejection reason')
                : t('Optional review note')
            }
            aria-required={requiresRemark}
          />
        </div>
      </div>
    </Dialog>
  )
}
