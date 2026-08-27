/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation } from '@tanstack/react-query'
import {
  CheckCircle2,
  FileCode2,
  ImageUp,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getProviderPublicURL } from '@/lib/provider-domain'

import {
  submitProviderWebsiteVerification,
  uploadProviderWebsiteEvidence,
  verifyProviderWebsite,
} from './api'
import { ProviderWebsiteEvidenceImage } from './provider-website-evidence-image'
import type {
  HubProvider,
  HubProviderResponse,
  HubProviderWebsiteVerificationMethod,
} from './types'

type ProviderWebsiteVerificationProps = {
  provider: HubProvider
  onSaved: (response: HubProviderResponse) => void
}

function verificationStatus(provider: HubProvider) {
  switch (provider.website_verification_status) {
    case 'pending':
      return { label: 'Under review', variant: 'warning' as const }
    case 'verified':
      return { label: 'Verified', variant: 'success' as const }
    case 'rejected':
      return { label: 'Verification rejected', variant: 'danger' as const }
    default:
      return { label: 'Not verified', variant: 'neutral' as const }
  }
}

export function ProviderWebsiteVerification(
  props: ProviderWebsiteVerificationProps
) {
  const { t } = useTranslation()
  const [method, setMethod] = useState<HubProviderWebsiteVerificationMethod>(
    props.provider.website_verification_method || 'manual'
  )
  const [file, setFile] = useState<File | null>(null)
  const [replaceManualEvidence, setReplaceManualEvidence] = useState(false)
  const status = verificationStatus(props.provider)
  const manualReviewPending =
    props.provider.website_verification_status === 'pending' &&
    props.provider.website_verification_method === 'manual' &&
    props.provider.website_evidence_asset_id > 0

  useEffect(() => {
    if (props.provider.website_verification_method) {
      setMethod(props.provider.website_verification_method)
    }
  }, [props.provider.website_verification_method])

  useEffect(() => {
    setReplaceManualEvidence(false)
    setFile(null)
  }, [
    props.provider.website_evidence_asset_id,
    props.provider.website_verification_status,
  ])

  const submitMutation = useMutation({
    mutationFn: async () => {
      let assetId = 0
      if (method === 'manual') {
        if (!file) throw new Error(t('Select a verification screenshot'))
        const upload = await uploadProviderWebsiteEvidence(file)
        if (!upload.success || !upload.data) {
          throw new Error(upload.message || t('Failed to upload screenshot'))
        }
        assetId = upload.data.id
      }
      const response = await submitProviderWebsiteVerification(method, assetId)
      if (!response.success || !response.data) {
        throw new Error(response.message || t('Failed to submit verification'))
      }
      return response
    },
    onSuccess: (response) => {
      props.onSaved(response)
      setFile(null)
      toast.success(
        t(
          method === 'manual'
            ? 'Screenshot submitted for review'
            : 'Verification instructions generated'
        )
      )
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('Failed to submit verification')
      ),
  })

  const verifyMutation = useMutation({
    mutationFn: verifyProviderWebsite,
    onSuccess: (response) => {
      if (!response.success || !response.data) {
        toast.error(response.message || t('Website verification failed'))
        return
      }
      props.onSaved(response)
      toast.success(t('Website ownership verified'))
    },
    onError: () => toast.error(t('Website verification failed')),
  })

  return (
    <Card>
      <CardHeader className='flex-row items-start justify-between gap-4'>
        <div>
          <CardTitle>{t('Website ownership')}</CardTitle>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(
              props.provider.status === 'active'
                ? 'After verification, your official website is shown publicly with verified ownership. The active subdomain stays unchanged so existing links and API Base URLs keep working.'
                : 'After verification, your official website is shown publicly with verified ownership. If approved together with onboarding, the administrator can also promote your suffixed subdomain to the clean subdomain.'
            )}
          </p>
        </div>
        <StatusBadge
          label={t(status.label)}
          variant={status.variant}
          copyable={false}
        />
      </CardHeader>
      <CardContent className='space-y-5'>
        <div className='bg-muted/40 grid gap-2 rounded-md border px-4 py-3 text-sm'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className='text-muted-foreground'>
              {t('Public homepage')}
            </span>
            <a
              href={getProviderPublicURL(
                props.provider.slug,
                props.provider.public_url
              )}
              target='_blank'
              rel='noreferrer'
              className='font-medium break-all hover:underline'
            >
              {getProviderPublicURL(
                props.provider.slug,
                props.provider.public_url
              )}
            </a>
          </div>
          {props.provider.website && (
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <span className='text-muted-foreground'>
                {t('Claimed website')}
              </span>
              <span className='break-all'>{props.provider.website}</span>
            </div>
          )}
        </div>

        {manualReviewPending ? (
          <div className='space-y-4'>
            <div className='border-warning/30 bg-warning/5 flex items-start gap-3 rounded-md border px-4 py-3'>
              <ShieldCheck className='text-warning mt-0.5 size-5 shrink-0' />
              <div>
                <p className='text-sm font-medium'>
                  {t('Screenshot submitted for review')}
                </p>
                <p className='text-muted-foreground mt-1 text-sm'>
                  {t(
                    'The administrator can promote your subdomain when approving the provider.'
                  )}
                </p>
              </div>
            </div>
            <ProviderWebsiteEvidenceImage
              assetId={props.provider.website_evidence_asset_id}
              alt={t('Submitted verification screenshot')}
              className='max-h-64 max-w-full rounded-md border object-contain'
            />
            {!replaceManualEvidence ? (
              <Button
                type='button'
                variant='outline'
                onClick={() => setReplaceManualEvidence(true)}
              >
                <ImageUp />
                {t('Replace image')}
              </Button>
            ) : (
              <div className='grid gap-3 border-t pt-4'>
                <div className='grid gap-2'>
                  <Label htmlFor='provider-website-evidence'>
                    {t('Verification screenshot')}
                  </Label>
                  <Input
                    id='provider-website-evidence'
                    type='file'
                    accept='image/png,image/jpeg,image/webp'
                    onChange={(event) =>
                      setFile(event.target.files?.item(0) ?? null)
                    }
                  />
                  <p className='text-muted-foreground text-xs'>
                    {t('PNG, JPEG, or WebP, up to 5 MB.')}
                  </p>
                </div>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    type='button'
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending || !file}
                  >
                    {submitMutation.isPending ? (
                      <Loader2 className='animate-spin' />
                    ) : (
                      <ImageUp />
                    )}
                    {t('Submit screenshot')}
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    disabled={submitMutation.isPending}
                    onClick={() => {
                      setReplaceManualEvidence(false)
                      setFile(null)
                    }}
                  >
                    {t('Cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {!props.provider.website && (
              <p className='text-muted-foreground text-sm'>
                {t(
                  'No website is required. You can add one later from the application details.'
                )}
              </p>
            )}
            {props.provider.website &&
              props.provider.website_verification_status === 'verified' && (
                <div className='border-success/30 bg-success/5 flex items-start gap-3 rounded-md border px-4 py-3'>
                  <CheckCircle2 className='text-success mt-0.5 size-5 shrink-0' />
                  <div>
                    <p className='text-sm font-medium'>
                      {t('Website ownership verified')}
                    </p>
                    <p className='text-muted-foreground mt-1 text-sm'>
                      {t(
                        'The administrator can promote your subdomain when approving the provider.'
                      )}
                    </p>
                  </div>
                </div>
              )}
            {props.provider.website &&
              props.provider.website_verification_status !== 'verified' && (
                <Tabs
                  value={method}
                  onValueChange={(value) =>
                    setMethod(value as HubProviderWebsiteVerificationMethod)
                  }
                  className='gap-4'
                >
                  <TabsList className='h-auto max-w-full flex-wrap justify-start'>
                    <TabsTrigger value='manual'>
                      <ImageUp />
                      {t('Admin screenshot')}
                    </TabsTrigger>
                    <TabsTrigger value='dns'>
                      <ShieldCheck />
                      {t('DNS TXT')}
                    </TabsTrigger>
                    <TabsTrigger value='http'>
                      <FileCode2 />
                      {t('HTTP file')}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value='manual' className='space-y-3'>
                    <div>
                      <p className='text-sm font-medium'>
                        {t('Recommended for early access')}
                      </p>
                      <p className='text-muted-foreground mt-1 text-sm'>
                        {t(
                          'Upload a screenshot showing the browser address bar and the logged-in management page. Mask API keys, balances, and order details.'
                        )}
                      </p>
                    </div>
                    <div className='grid gap-2'>
                      <Label htmlFor='provider-website-evidence'>
                        {t('Verification screenshot')}
                      </Label>
                      <Input
                        id='provider-website-evidence'
                        type='file'
                        accept='image/png,image/jpeg,image/webp'
                        onChange={(event) =>
                          setFile(event.target.files?.item(0) ?? null)
                        }
                      />
                      <p className='text-muted-foreground text-xs'>
                        {t('PNG, JPEG, or WebP, up to 5 MB.')}
                      </p>
                    </div>
                    {props.provider.website_evidence_asset_id > 0 &&
                      props.provider.website_verification_method ===
                        'manual' && (
                        <ProviderWebsiteEvidenceImage
                          assetId={props.provider.website_evidence_asset_id}
                          alt={t('Submitted verification screenshot')}
                          className='max-h-48 max-w-full rounded-md border object-contain'
                        />
                      )}
                    <Button
                      type='button'
                      onClick={() => submitMutation.mutate()}
                      disabled={submitMutation.isPending || !file}
                    >
                      {submitMutation.isPending ? (
                        <Loader2 className='animate-spin' />
                      ) : (
                        <ImageUp />
                      )}
                      {t('Submit screenshot')}
                    </Button>
                  </TabsContent>

                  {(['dns', 'http'] as const).map((verificationMethod) => {
                    const isCurrent =
                      props.provider.website_verification_method ===
                        verificationMethod &&
                      props.provider.website_verification_status === 'pending'
                    const record =
                      verificationMethod === 'dns'
                        ? props.provider.website_verification_dns_record
                        : props.provider.website_verification_http_url
                    const value =
                      verificationMethod === 'dns'
                        ? props.provider.website_verification_dns_value
                        : props.provider.website_verification_http_body
                    return (
                      <TabsContent
                        key={verificationMethod}
                        value={verificationMethod}
                        className='space-y-3'
                      >
                        {!isCurrent ? (
                          <Button
                            type='button'
                            variant='outline'
                            onClick={() => submitMutation.mutate()}
                            disabled={submitMutation.isPending}
                          >
                            {submitMutation.isPending && (
                              <Loader2 className='animate-spin' />
                            )}
                            {t('Generate verification instructions')}
                          </Button>
                        ) : (
                          <>
                            <div className='grid gap-3 rounded-md border p-4 text-sm'>
                              <div>
                                <p className='text-muted-foreground text-xs'>
                                  {t(
                                    verificationMethod === 'dns'
                                      ? 'TXT record name'
                                      : 'Verification URL'
                                  )}
                                </p>
                                <p className='mt-1 font-mono break-all'>
                                  {record}
                                </p>
                              </div>
                              <div>
                                <p className='text-muted-foreground text-xs'>
                                  {t(
                                    verificationMethod === 'dns'
                                      ? 'TXT record value'
                                      : 'File content'
                                  )}
                                </p>
                                <p className='mt-1 font-mono break-all'>
                                  {value}
                                </p>
                              </div>
                            </div>
                            {props.provider.website_verification_last_error && (
                              <p className='text-destructive text-sm'>
                                {props.provider.website_verification_last_error}
                              </p>
                            )}
                            <Button
                              type='button'
                              onClick={() => verifyMutation.mutate()}
                              disabled={verifyMutation.isPending}
                            >
                              {verifyMutation.isPending ? (
                                <Loader2 className='animate-spin' />
                              ) : (
                                <RefreshCw />
                              )}
                              {t('Verify now')}
                            </Button>
                          </>
                        )}
                      </TabsContent>
                    )
                  })}
                </Tabs>
              )}

            {props.provider.website_verification_remark &&
              props.provider.website_verification_status === 'rejected' && (
                <p className='text-destructive text-sm'>
                  {props.provider.website_verification_remark}
                </p>
              )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
