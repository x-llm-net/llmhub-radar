/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { ImageOff, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { getProviderWebsiteEvidence } from './api'

type ProviderWebsiteEvidenceImageProps = {
  assetId: number
  alt: string
  className?: string
}

export function ProviderWebsiteEvidenceImage(
  props: ProviderWebsiteEvidenceImageProps
) {
  const { t } = useTranslation()
  const [source, setSource] = useState('')
  const evidenceQuery = useQuery({
    queryKey: ['hub-provider-website-evidence', props.assetId],
    queryFn: () => getProviderWebsiteEvidence(props.assetId),
    enabled: props.assetId > 0,
    staleTime: 0,
    gcTime: 0,
  })

  useEffect(() => {
    if (!evidenceQuery.data) {
      setSource('')
      return
    }
    const objectURL = URL.createObjectURL(evidenceQuery.data)
    setSource(objectURL)
    return () => URL.revokeObjectURL(objectURL)
  }, [evidenceQuery.data])

  if (evidenceQuery.isPending || !source) {
    return (
      <div className='bg-muted/30 text-muted-foreground flex h-24 w-40 items-center justify-center rounded-md border'>
        {evidenceQuery.isError ? (
          <div className='flex items-center gap-2 px-3 text-xs'>
            <ImageOff className='size-4 shrink-0' />
            {t('Failed to load screenshot')}
          </div>
        ) : (
          <Loader2 className='size-5 animate-spin' />
        )}
      </div>
    )
  }

  return (
    <a href={source} target='_blank' rel='noreferrer' className='block w-fit'>
      <img src={source} alt={props.alt} className={cn(props.className)} />
    </a>
  )
}
