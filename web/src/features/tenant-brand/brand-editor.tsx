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

import { Save, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSystemConfig } from '@/hooks/use-system-config'

import type { TenantBrand } from './types'

type TenantBrandEditorProps = {
  brand: TenantBrand
  saving: boolean
  onSave: (brand: TenantBrand, logoFile?: File) => void
}

const tenantBrandAssetPrefix = '/api/hub/public/brand-assets/'

function isUploadedLogo(logoURL: string): boolean {
  return logoURL.startsWith(tenantBrandAssetPrefix)
}

export function TenantBrandEditor(props: TenantBrandEditorProps) {
  const { t } = useTranslation()
  const { platformSystemName, platformLogo } = useSystemConfig()
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(props.brand.name)
  const [logoURL, setLogoURL] = useState(
    isUploadedLogo(props.brand.logo_url) ? '' : props.brand.logo_url
  )
  const [keepUploadedLogo, setKeepUploadedLogo] = useState(
    isUploadedLogo(props.brand.logo_url)
  )
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState('')

  useEffect(() => {
    setName(props.brand.name)
    setLogoURL(isUploadedLogo(props.brand.logo_url) ? '' : props.brand.logo_url)
    setKeepUploadedLogo(isUploadedLogo(props.brand.logo_url))
    setLogoFile(null)
    if (logoInputRef.current) logoInputRef.current.value = ''
  }, [props.brand.logo_url, props.brand.name])

  useEffect(() => {
    if (!logoFile) {
      setFilePreview('')
      return
    }
    const previewURL = URL.createObjectURL(logoFile)
    setFilePreview(previewURL)
    return () => URL.revokeObjectURL(previewURL)
  }, [logoFile])

  const previewName = name.trim() || platformSystemName
  const previewLogo =
    filePreview ||
    (keepUploadedLogo ? props.brand.logo_url : logoURL.trim()) ||
    platformLogo
  const hasCustomLogo =
    logoFile !== null || keepUploadedLogo || logoURL.trim() !== ''

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Brand Settings')}</CardTitle>
        <CardDescription>
          {t(
            'The brand is shown on this tenant domain. Empty fields use the platform defaults.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='grid gap-5'
          onSubmit={(event) => {
            event.preventDefault()
            let submittedLogoURL = logoURL.trim()
            if (keepUploadedLogo) submittedLogoURL = props.brand.logo_url
            if (logoFile) submittedLogoURL = ''
            props.onSave(
              {
                name: name.trim(),
                logo_url: submittedLogoURL,
              },
              logoFile ?? undefined
            )
          }}
        >
          <div className='flex min-w-0 items-center gap-3 rounded-md border p-3'>
            <div className='bg-muted size-12 shrink-0 overflow-hidden rounded-md'>
              <img
                src={previewLogo}
                alt={t('Logo')}
                className='size-full object-contain p-1'
              />
            </div>
            <div className='min-w-0'>
              <div className='truncate font-medium'>{previewName}</div>
              <div className='text-muted-foreground text-xs'>
                {t('Brand preview')}
              </div>
            </div>
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='tenant-brand-name'>{t('Brand name')}</Label>
            <Input
              id='tenant-brand-name'
              value={name}
              maxLength={120}
              placeholder={platformSystemName}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className='grid gap-2'>
            <div className='flex items-center justify-between gap-3'>
              <Label htmlFor='tenant-brand-logo-file'>{t('Upload logo')}</Label>
              {hasCustomLogo && (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  title={t('Remove logo')}
                  aria-label={t('Remove logo')}
                  disabled={props.saving}
                  onClick={() => {
                    setLogoFile(null)
                    setKeepUploadedLogo(false)
                    setLogoURL('')
                    if (logoInputRef.current) logoInputRef.current.value = ''
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            <Input
              ref={logoInputRef}
              id='tenant-brand-logo-file'
              type='file'
              accept='image/png,image/jpeg,image/webp'
              disabled={props.saving}
              onChange={(event) => {
                setLogoFile(event.target.files?.item(0) ?? null)
                setKeepUploadedLogo(false)
              }}
            />
            <p className='text-muted-foreground text-xs'>
              {t('PNG, JPEG, or WebP, up to 512 KB. Optional.')}
            </p>
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='tenant-brand-logo'>
              {t('Logo URL (optional)')}
            </Label>
            <Input
              id='tenant-brand-logo'
              type='url'
              value={logoURL}
              maxLength={1024}
              placeholder={platformLogo}
              disabled={props.saving}
              onChange={(event) => {
                setLogoURL(event.target.value)
                setKeepUploadedLogo(false)
                setLogoFile(null)
                if (logoInputRef.current) logoInputRef.current.value = ''
              }}
            />
          </div>

          <div>
            <Button type='submit' disabled={props.saving}>
              <Save className={props.saving ? 'animate-pulse' : undefined} />
              {props.saving ? t('Saving...') : t('Save brand')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
