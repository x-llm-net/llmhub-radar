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
import { useEffect, useCallback } from 'react'

import { DEFAULT_SYSTEM_NAME, DEFAULT_LOGO } from '@/lib/constants'
import { applyFaviconToDom } from '@/lib/dom-utils'
import {
  useSystemConfigStore,
  type CurrencyConfig,
  type CurrencyDisplayType,
  type SystemConfig,
  type TenantBrandConfig,
  DEFAULT_CURRENCY_CONFIG,
} from '@/stores/system-config-store'

interface UseSystemConfigOptions {
  /** Automatically fetch config from backend (use only in root component) */
  autoLoad?: boolean
}

interface StatusApiResponse {
  success: boolean
  data: {
    system_name?: string
    logo?: string
    footer_html?: string
    demo_site_enabled?: boolean
    display_token_stat_enabled?: boolean
    display_in_currency?: boolean
    quota_display_type?: CurrencyDisplayType
    quota_per_unit?: number
    usd_exchange_rate?: number
    custom_currency_symbol?: string
    custom_currency_exchange_rate?: number
  }
}

interface TenantBrandApiResponse {
  success: boolean
  data?: {
    is_tenant_host?: boolean
    brand?: TenantBrandConfig
  }
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

/**
 * Map `/api/status` response data to our persisted system config structure
 */
export function mapStatusDataToConfig(
  data: StatusApiResponse['data'] | undefined
): Partial<SystemConfig> {
  if (!data) return {}

  const quotaDisplayType =
    (data.quota_display_type as CurrencyDisplayType | undefined) ??
    DEFAULT_CURRENCY_CONFIG.quotaDisplayType

  const currency: CurrencyConfig = {
    displayInCurrency:
      data.display_in_currency ?? DEFAULT_CURRENCY_CONFIG.displayInCurrency,
    quotaDisplayType,
    quotaPerUnit: toNumber(
      data.quota_per_unit,
      DEFAULT_CURRENCY_CONFIG.quotaPerUnit
    ),
    usdExchangeRate: toNumber(
      data.usd_exchange_rate,
      DEFAULT_CURRENCY_CONFIG.usdExchangeRate
    ),
    customCurrencySymbol:
      data.custom_currency_symbol?.trim() ||
      DEFAULT_CURRENCY_CONFIG.customCurrencySymbol,
    customCurrencyExchangeRate: toNumber(
      data.custom_currency_exchange_rate,
      DEFAULT_CURRENCY_CONFIG.customCurrencyExchangeRate
    ),
  }

  return {
    systemName: data.system_name || DEFAULT_SYSTEM_NAME,
    logo: data.logo || DEFAULT_LOGO,
    footerHtml: data.footer_html,
    demoSiteEnabled: data.demo_site_enabled,
    displayTokenStatEnabled: data.display_token_stat_enabled,
    currency,
  }
}

// Fetch system config from API
async function fetchSystemConfig(): Promise<Partial<SystemConfig>> {
  const response = await fetch('/api/status')
  if (!response.ok) throw new Error('Failed to fetch status')

  const data: StatusApiResponse = await response.json()
  if (!data.success) throw new Error('API returned error')

  return mapStatusDataToConfig(data.data)
}

async function fetchTenantBrand(): Promise<TenantBrandConfig | null> {
  const response = await fetch('/api/hub/public/brand')
  if (!response.ok) throw new Error('Failed to fetch tenant brand')

  const result: TenantBrandApiResponse = await response.json()
  if (!result.success || !result.data?.is_tenant_host) return null
  return result.data.brand ?? null
}

// Preload image and return cleanup function
function preloadImage(
  src: string,
  onLoad: () => void,
  onError: () => void
): () => void {
  const img = new Image()
  img.onload = onLoad
  img.onerror = onError
  img.src = src

  return () => {
    img.onload = null
    img.onerror = null
  }
}

/**
 * System configuration hook with auto-loading and logo preloading
 *
 * @example
 * // Root component - auto-load from backend
 * useSystemConfig({ autoLoad: true })
 *
 * @example
 * // Other components - use cached config
 * const { systemName, logo, loading } = useSystemConfig()
 */
export function useSystemConfig(options: UseSystemConfigOptions = {}) {
  const { autoLoad = false } = options
  const {
    config,
    tenantBrand,
    loading,
    loadedLogoUrl,
    setConfig,
    setTenantBrand,
    setLoadedLogoUrl,
    setLoading,
  } = useSystemConfigStore()

  // Load config from backend
  const loadConfig = useCallback(async () => {
    setLoading(true)
    const [systemResult, brandResult] = await Promise.allSettled([
      fetchSystemConfig(),
      fetchTenantBrand(),
    ])
    if (systemResult.status === 'fulfilled') {
      setConfig(systemResult.value)
    } else {
      // eslint-disable-next-line no-console
      console.error('Failed to load system config:', systemResult.reason)
    }
    if (brandResult.status === 'fulfilled') {
      setTenantBrand(brandResult.value)
    } else {
      setTenantBrand(null)
      // eslint-disable-next-line no-console
      console.error('Failed to load tenant brand:', brandResult.reason)
    }
    setLoading(false)
  }, [setConfig, setLoading, setTenantBrand])

  useEffect(() => {
    if (autoLoad) loadConfig()
  }, [autoLoad, loadConfig])

  const systemName = tenantBrand?.name?.trim() || config.systemName
  const logo = tenantBrand?.logo_url?.trim() || config.logo

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = systemName
    const metaTitle = document.querySelector(
      'meta[name="title"]'
    ) as HTMLMetaElement | null
    if (metaTitle) metaTitle.setAttribute('content', systemName)
  }, [systemName])

  // Preload logo image when URL changes
  useEffect(() => {
    // Skip if logo is already loaded
    if (!logo || logo === loadedLogoUrl) return

    // Preload new logo
    return preloadImage(
      logo,
      () => {
        setLoadedLogoUrl(logo)
        applyFaviconToDom(logo)
      },
      () => {
        if (logo !== DEFAULT_LOGO) {
          // eslint-disable-next-line no-console
          console.error('Failed to load logo:', logo)
        }
        // Mark as loaded even on error to prevent infinite retry
        setLoadedLogoUrl(logo)
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logo, loadedLogoUrl, setLoadedLogoUrl])

  return {
    ...config,
    systemName,
    logo,
    platformSystemName: config.systemName,
    platformLogo: config.logo,
    tenantBrand,
    loading,
    logoLoaded: logo === loadedLogoUrl && !!loadedLogoUrl,
  }
}
