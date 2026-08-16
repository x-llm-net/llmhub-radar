/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Ban, Clock3, Pencil, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Main } from '@/components/layout'
import { RichContent } from '@/components/rich-content'
import { StatusBadge } from '@/components/status-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useProviderLogoURL } from '@/lib/provider-logo'

import { getProviderApplicationState } from './application-state'
import { ProviderEarningsSummary } from './provider-earnings-summary'
import { ProviderProfileDialog } from './provider-profile-dialog'
import { ProviderWebsiteVerification } from './provider-website-verification'
import type {
  HubProvider,
  HubProviderResponse,
  HubProviderStatus,
} from './types'

type ProviderApplicationStateProps = {
  provider: HubProvider
  onSaved: (response: HubProviderResponse) => void
}

const statusIcons = {
  pending: Clock3,
  rejected: TriangleAlert,
  disabled: Ban,
} as const

function getStatusIcon(status: HubProviderStatus) {
  switch (status) {
    case 'pending':
      return statusIcons.pending
    case 'rejected':
      return statusIcons.rejected
    case 'disabled':
      return statusIcons.disabled
    case 'active':
      throw new Error('Active providers must use the provider workspace')
  }
}

export function ProviderApplicationState(props: ProviderApplicationStateProps) {
  const { t } = useTranslation()
  const [editorOpen, setEditorOpen] = useState(false)
  const logoURL = useProviderLogoURL(props.provider.logo_url)
  const config = getProviderApplicationState(props.provider.status)
  const StatusIcon = getStatusIcon(props.provider.status)

  return (
    <Main>
      <div className='flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-6'>
        <div className='mx-auto flex w-full max-w-4xl flex-col gap-6'>
          <div>
            <div className='mb-3 flex items-center gap-2'>
              <StatusIcon className='text-muted-foreground size-5' />
              <StatusBadge
                label={t(config.label)}
                variant={config.variant}
                copyable={false}
              />
            </div>
            <h1 className='text-2xl font-semibold'>{t(config.title)}</h1>
            <p className='text-muted-foreground mt-2 max-w-2xl text-sm'>
              {t(config.description)}
            </p>
          </div>

          {config.showRemark && props.provider.review_remark && (
            <div className='border-destructive/30 bg-destructive/5 rounded-lg border px-4 py-3'>
              <p className='text-sm font-medium'>{t(config.remarkLabel)}</p>
              <p className='text-muted-foreground mt-1 text-sm whitespace-pre-wrap'>
                {props.provider.review_remark}
              </p>
            </div>
          )}

          <Card>
            <CardHeader className='flex-row items-center justify-between gap-4'>
              <CardTitle>{t('Application details')}</CardTitle>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setEditorOpen(true)}
              >
                <Pencil className='size-4' />
                {t(config.editLabel)}
              </Button>
            </CardHeader>
            <CardContent className='flex items-start gap-4'>
              <Avatar className='size-12 rounded-md'>
                <AvatarImage
                  src={logoURL || undefined}
                  alt=''
                />
                <AvatarFallback className='rounded-md'>
                  {props.provider.name.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className='min-w-0 space-y-1'>
                <p className='font-medium'>{props.provider.name}</p>
                <p className='text-muted-foreground text-sm'>
                  {props.provider.slug}
                </p>
                {props.provider.website && (
                  <p className='text-muted-foreground text-sm break-all'>
                    {props.provider.website}
                  </p>
                )}
                {props.provider.description && (
                  <RichContent
                    content={props.provider.description}
                    breaks
                    className='pt-2 text-sm'
                  />
                )}
                <p className='text-muted-foreground pt-2 text-sm break-all'>
                  {t('Review contact')}: {props.provider.contact_value}
                </p>
                {props.provider.support_value && (
                  <p className='text-muted-foreground text-sm break-all'>
                    {t('Public support entry')}: {props.provider.support_value}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {(props.provider.status === 'pending' ||
            props.provider.status === 'rejected') && (
            <ProviderWebsiteVerification
              provider={props.provider}
              onSaved={props.onSaved}
            />
          )}

          {config.showEarnings && <ProviderEarningsSummary />}
        </div>
      </div>
      <ProviderProfileDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        provider={props.provider}
        onSaved={props.onSaved}
      />
    </Main>
  )
}
