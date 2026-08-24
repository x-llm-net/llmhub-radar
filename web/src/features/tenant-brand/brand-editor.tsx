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

import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  onSave: (brand: TenantBrand) => void
}

export function TenantBrandEditor(props: TenantBrandEditorProps) {
  const { t } = useTranslation()
  const { platformSystemName, platformLogo } = useSystemConfig()
  const [name, setName] = useState(props.brand.name)
  const [logoURL, setLogoURL] = useState(props.brand.logo_url)

  useEffect(() => {
    setName(props.brand.name)
    setLogoURL(props.brand.logo_url)
  }, [props.brand.logo_url, props.brand.name])

  const previewName = name.trim() || platformSystemName
  const previewLogo = logoURL.trim() || platformLogo

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
            props.onSave({ name: name.trim(), logo_url: logoURL.trim() })
          }}
        >
          <div className='flex min-w-0 items-center gap-3 rounded-md border p-3'>
            <div className='bg-muted size-12 shrink-0 overflow-hidden rounded-md'>
              <img
                src={previewLogo}
                alt={t('Logo')}
                className='size-full object-cover'
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
            <Label htmlFor='tenant-brand-logo'>{t('Logo URL')}</Label>
            <Input
              id='tenant-brand-logo'
              type='url'
              value={logoURL}
              maxLength={1024}
              placeholder={platformLogo}
              onChange={(event) => setLogoURL(event.target.value)}
            />
          </div>

          <div>
            <Button type='submit' disabled={props.saving}>
              <Save />
              {props.saving ? t('Saving...') : t('Save brand')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
