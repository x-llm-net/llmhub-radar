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
import { useTranslation } from 'react-i18next'

import type { ProviderPublicBucket } from '@/features/provider-public/types'

import { formatPublicHomeDate } from './public-home-format'

function bucketLabel(
  bucket: ProviderPublicBucket,
  locale: string,
  translate: (key: string, options?: Record<string, unknown>) => string
) {
  const time = formatPublicHomeDate(bucket.started_at, locale)
  if (bucket.sample_count === 0) {
    return `${time} · ${translate('No probe data')}`
  }
  return `${time} · ${translate('{{rate}}% success', { rate: bucket.success_rate.toFixed(1) })} · ${translate('{{count}} probes', { count: bucket.sample_count })}`
}

export function PublicHomeStabilityStrip(props: {
  timeline: ProviderPublicBucket[]
  modelName: string
}) {
  const { i18n, t } = useTranslation()

  return (
    <div
      className='hub-stability-strip'
      role='img'
      aria-label={t('7-day availability timeline for {{model}}', {
        model: props.modelName,
      })}
    >
      {props.timeline.map((bucket) => (
        <span
          key={bucket.started_at}
          className={`is-${bucket.status}`}
          title={bucketLabel(bucket, i18n.language, t)}
        />
      ))}
    </div>
  )
}
