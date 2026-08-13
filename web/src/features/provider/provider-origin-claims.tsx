/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Copy,
  Globe2,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import {
  createProviderOriginClaim,
  deleteProviderOriginClaim,
  verifyProviderOriginClaim,
} from './api'
import {
  providerOriginClaimsQueryKey,
  useProviderOriginClaims,
} from './hooks/use-provider'
import type {
  HubProviderOriginClaim,
  HubProviderOriginClaimMethod,
} from './types'

const statusVariant: Record<HubProviderOriginClaim['status'], StatusVariant> = {
  pending: 'warning',
  verified: 'success',
  conflict: 'danger',
}

const statusLabel = {
  pending: 'Pending ownership verification',
  verified: 'Ownership verified',
  conflict: 'Site ownership conflict',
} as const

const methodLabel = {
  dns: 'DNS TXT verification',
  http: 'HTTP file verification',
  legacy: 'Existing channel migration',
} as const

function CopyValue(props: { label: string; value: string }) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  return (
    <div className='grid gap-1.5'>
      <span className='text-muted-foreground text-xs'>{props.label}</span>
      <div className='bg-muted/40 flex min-w-0 items-center gap-2 rounded-md border px-3 py-2'>
        <code className='min-w-0 flex-1 overflow-hidden text-xs text-ellipsis whitespace-nowrap'>
          {props.value}
        </code>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          aria-label={t('Copy {{label}}', { label: props.label })}
          title={t('Copy {{label}}', { label: props.label })}
          onClick={() => void copyToClipboard(props.value)}
        >
          <Copy aria-hidden='true' />
        </Button>
      </div>
    </div>
  )
}

function VerificationInstructions(props: { claim: HubProviderOriginClaim }) {
  const { t } = useTranslation()
  if (props.claim.verification_method === 'dns') {
    return (
      <div className='grid gap-3 border-t pt-4 sm:grid-cols-2'>
        <CopyValue
          label={t('TXT record name')}
          value={props.claim.dns_record}
        />
        <CopyValue
          label={t('TXT record value')}
          value={props.claim.dns_value}
        />
      </div>
    )
  }
  return (
    <div className='grid gap-3 border-t pt-4 sm:grid-cols-2'>
      <CopyValue
        label={t('Verification file URL')}
        value={props.claim.http_url}
      />
      <CopyValue
        label={t('Verification file content')}
        value={props.claim.http_body}
      />
    </div>
  )
}

export function ProviderOriginClaims() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const claimsQuery = useProviderOriginClaims()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [baseURL, setBaseURL] = useState('')
  const [method, setMethod] = useState<HubProviderOriginClaimMethod>('dns')
  const [busyClaimID, setBusyClaimID] = useState<number | null>(null)

  const createMutation = useMutation({
    mutationFn: () => createProviderOriginClaim(baseURL.trim(), method),
    onSuccess: async (response) => {
      if (!response.success || !response.data) {
        toast.error(response.message || t('Failed to add upstream site'))
        return
      }
      await queryClient.invalidateQueries({
        queryKey: providerOriginClaimsQueryKey,
      })
      setDialogOpen(false)
      setBaseURL('')
      toast.success(t('Upstream site added'))
    },
    onError: () => toast.error(t('Failed to add upstream site')),
  })

  const verifyMutation = useMutation({
    mutationFn: verifyProviderOriginClaim,
    onMutate: setBusyClaimID,
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({
        queryKey: providerOriginClaimsQueryKey,
      })
      if (!response.success) {
        toast.error(response.message || t('Ownership verification failed'))
        return
      }
      toast.success(t('Upstream site verified'))
    },
    onError: () => toast.error(t('Ownership verification failed')),
    onSettled: () => setBusyClaimID(null),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteProviderOriginClaim,
    onMutate: setBusyClaimID,
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to remove upstream site'))
        return
      }
      await queryClient.invalidateQueries({
        queryKey: providerOriginClaimsQueryKey,
      })
      toast.success(t('Upstream site removed'))
    },
    onError: () => toast.error(t('Failed to remove upstream site')),
    onSettled: () => setBusyClaimID(null),
  })

  let claimsContent
  if (claimsQuery.isLoading) {
    claimsContent = (
      <div className='space-y-2'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
      </div>
    )
  } else if (claimsQuery.isError) {
    claimsContent = (
      <ErrorState
        title={t('Failed to load upstream sites')}
        onRetry={() => void claimsQuery.refetch()}
      />
    )
  } else if (claimsQuery.claims.length === 0) {
    claimsContent = (
      <div className='border-border/70 flex min-h-28 items-center gap-3 rounded-md border border-dashed px-4 py-5'>
        <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-md'>
          <Globe2 className='text-muted-foreground size-4' aria-hidden='true' />
        </div>
        <div>
          <p className='text-sm font-medium'>{t('No custom upstream sites')}</p>
          <p className='text-muted-foreground mt-0.5 text-sm'>
            {t('Add a site when you use a custom Base URL.')}
          </p>
        </div>
      </div>
    )
  } else {
    claimsContent = (
      <div className='divide-border overflow-hidden rounded-md border'>
        {claimsQuery.claims.map((claim) => (
          <div key={claim.id} className='space-y-4 p-4'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-2'>
                  <p className='truncate text-sm font-medium'>{claim.origin}</p>
                  <StatusBadge
                    label={t(statusLabel[claim.status])}
                    variant={statusVariant[claim.status]}
                    copyable={false}
                  />
                </div>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t(methodLabel[claim.verification_method])}
                </p>
              </div>
              {claim.status === 'pending' && (
                <div className='flex shrink-0 items-center gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    onClick={() => verifyMutation.mutate(claim.id)}
                    disabled={busyClaimID === claim.id}
                  >
                    <ShieldCheck aria-hidden='true' />
                    {t('Verify now')}
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Remove upstream site')}
                    title={t('Remove upstream site')}
                    onClick={() => deleteMutation.mutate(claim.id)}
                    disabled={busyClaimID === claim.id}
                  >
                    <Trash2 aria-hidden='true' />
                  </Button>
                </div>
              )}
              {claim.status === 'verified' && (
                <CheckCircle2
                  className='text-success size-5 shrink-0'
                  aria-hidden='true'
                />
              )}
            </div>
            {claim.status === 'pending' && (
              <VerificationInstructions claim={claim} />
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <section id='provider-origin-claims' className='space-y-4'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h2 className='text-lg font-semibold'>{t('Upstream Sites')}</h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(
              'Verify custom upstream ownership before creating supply channels. Official upstreams do not need verification.'
            )}
          </p>
        </div>
        <Button
          type='button'
          variant='outline'
          onClick={() => setDialogOpen(true)}
        >
          <Plus aria-hidden='true' />
          {t('Add Upstream Site')}
        </Button>
      </div>

      {claimsContent}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!createMutation.isPending) setDialogOpen(open)
        }}
        title={t('Add Upstream Site')}
        description={t(
          'Ownership is based on the domain and port. API paths and keys do not create separate sites.'
        )}
        contentClassName='sm:max-w-lg'
        footer={
          <>
            <Button
              type='button'
              variant='outline'
              onClick={() => setDialogOpen(false)}
              disabled={createMutation.isPending}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='submit'
              form='provider-origin-claim-form'
              disabled={createMutation.isPending || !baseURL.trim()}
            >
              <Plus aria-hidden='true' />
              {createMutation.isPending ? t('Adding...') : t('Add site')}
            </Button>
          </>
        }
      >
        <form
          id='provider-origin-claim-form'
          className='grid gap-5'
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate()
          }}
        >
          <div className='grid gap-2'>
            <Label htmlFor='provider-origin-base-url'>
              {t('Upstream Base URL')}
            </Label>
            <Input
              id='provider-origin-base-url'
              value={baseURL}
              onChange={(event) => setBaseURL(event.target.value)}
              placeholder='https://relay.example.com/v1'
              autoCapitalize='none'
              autoCorrect='off'
              spellCheck={false}
              autoFocus
            />
          </div>
          <fieldset className='grid gap-2'>
            <legend className='text-sm font-medium'>
              {t('Verification method')}
            </legend>
            <RadioGroup
              value={method}
              onValueChange={(value) =>
                setMethod(value as HubProviderOriginClaimMethod)
              }
              className='grid gap-2 sm:grid-cols-2'
            >
              <label className='has-data-checked:border-primary flex cursor-pointer items-start gap-3 rounded-md border p-3'>
                <RadioGroupItem value='dns' aria-label={t('DNS TXT')} />
                <span>
                  <span className='block text-sm font-medium'>
                    {t('DNS TXT')}
                  </span>
                  <span className='text-muted-foreground mt-1 block text-xs'>
                    {t('Add one TXT record to your domain.')}
                  </span>
                </span>
              </label>
              <label className='has-data-checked:border-primary flex cursor-pointer items-start gap-3 rounded-md border p-3'>
                <RadioGroupItem value='http' aria-label={t('HTTP file')} />
                <span>
                  <span className='block text-sm font-medium'>
                    {t('HTTP file')}
                  </span>
                  <span className='text-muted-foreground mt-1 block text-xs'>
                    {t('Publish one text file on the upstream site.')}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </fieldset>
        </form>
      </Dialog>
    </section>
  )
}
