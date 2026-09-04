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
const DEFAULT_PROVIDER_ROOT_DOMAIN = 'llm-hub.store'

const RESERVED_PROVIDER_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'billing',
  'cdn',
  'console',
  'dashboard',
  'docs',
  'edge',
  'guide',
  'mail',
  'oauth',
  'provider',
  'providers',
  'static',
  'status',
  'support',
  'www',
])

export function getProviderRootDomain(): string {
  const rawConfigured = import.meta.env?.VITE_PROVIDER_ROOT_DOMAIN
  const configured =
    typeof rawConfigured === 'string' ? rawConfigured.trim() : ''
  const normalized = normalizeHostname(
    configured || DEFAULT_PROVIDER_ROOT_DOMAIN
  )
  return getTenantRootDomainFromHostname(normalized) === normalized
    ? normalized
    : DEFAULT_PROVIDER_ROOT_DOMAIN
}

function isDomainLabel(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  )
}

function normalizeHostname(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized.endsWith('..')) return ''
  return normalized.replace(/\.$/, '')
}

/**
 * Returns the supported two-label tenant root for either a tenant root or one
 * provider host. Multi-label public suffixes are intentionally unsupported.
 */
export function getTenantRootDomainFromHostname(
  hostname: string
): string | null {
  const normalized = normalizeHostname(hostname)
  const labels = normalized.split('.')
  if (labels.some((label) => !label)) return null
  if (
    labels.length === 2 &&
    labels.every(isDomainLabel) &&
    /[a-z]/.test(labels[1] ?? '')
  ) {
    return normalized
  }
  if (
    labels.length === 3 &&
    isProviderSlug(labels[0] ?? '') &&
    labels.slice(1).every(isDomainLabel) &&
    /[a-z]/.test(labels[2] ?? '')
  ) {
    return labels.slice(1).join('.')
  }
  return null
}

export function getCurrentProviderRootDomain(): string {
  if (typeof window === 'undefined') return getProviderRootDomain()
  return (
    getTenantRootDomainFromHostname(window.location.hostname) ??
    getProviderRootDomain()
  )
}

export function isProviderSlug(value: string): boolean {
  const slug = value.trim().toLowerCase()
  return (
    slug.length >= 1 &&
    slug.length <= 63 &&
    !slug.startsWith('xn--') &&
    !RESERVED_PROVIDER_SLUGS.has(slug) &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)
  )
}

export function providerSlugFromName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 63)
    .replaceAll(/-+$/g, '')
}

export function providerSlugFromWebsite(value: string): string {
  try {
    const parsed = new URL(value.trim())
    const labels = parsed.hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .split('.')
      .filter(Boolean)
    if (labels.length < 2) return ''

    const twoLevelSuffixes = new Set([
      'com.au',
      'com.cn',
      'com.hk',
      'com.sg',
      'co.jp',
      'co.uk',
      'net.cn',
      'org.cn',
    ])
    const suffix = labels.slice(-2).join('.')
    const candidate = twoLevelSuffixes.has(suffix)
      ? (labels.at(-3) ?? '')
      : (labels.at(-2) ?? '')
    return providerSlugFromName(candidate)
  } catch {
    return ''
  }
}

export function getProviderSlugFromHostname(hostname?: string): string | null {
  const currentHostname = normalizeHostname(
    hostname ?? window.location.hostname
  )
  const localSuffix = '.localhost'
  let slug = ''

  if (currentHostname.endsWith(localSuffix)) {
    slug = currentHostname.slice(0, -localSuffix.length)
  } else {
    const labels = currentHostname.split('.').filter(Boolean)
    if (
      labels.length === 3 &&
      getTenantRootDomainFromHostname(currentHostname)
    ) {
      slug = labels[0] ?? ''
    }
  }

  if (slug.includes('.') || !isProviderSlug(slug)) return null
  return slug
}

export function isHubFirstPartyOrigin(
  value: string,
  referenceOrigin = window.location.origin
): boolean {
  try {
    const target = new URL(value)
    const reference = new URL(referenceOrigin)
    if (!['http:', 'https:'].includes(target.protocol)) return false
    if (
      target.protocol !== reference.protocol ||
      target.port !== reference.port
    ) {
      return false
    }
    const hostname = target.hostname.toLowerCase()
    const providerRootDomain =
      getTenantRootDomainFromHostname(reference.hostname) ??
      getProviderRootDomain()
    const targetRootDomain = getTenantRootDomainFromHostname(hostname)
    return (
      hostname === providerRootDomain ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      (targetRootDomain === providerRootDomain &&
        getProviderSlugFromHostname(hostname) !== null) ||
      hostname.endsWith('.localhost')
    )
  } catch {
    return false
  }
}

export function getProviderPublicURL(slug: string, publicURL?: string): string {
  const normalizedSlug = slug.trim().toLowerCase()
  if (typeof window === 'undefined') {
    if (publicURL) {
      try {
        const parsed = new URL(publicURL)
        if (['http:', 'https:'].includes(parsed.protocol)) return parsed.href
      } catch {
        /* Fall back to the configured platform domain. */
      }
    }
    return `https://${normalizedSlug}.${getProviderRootDomain()}/`
  }

  const hostname = window.location.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    const port = window.location.port ? `:${window.location.port}` : ''
    return `${window.location.protocol}//${normalizedSlug}.localhost${port}/`
  }
  if (hostname === '127.0.0.1' || hostname === '[::1]') {
    return `/providers/${encodeURIComponent(normalizedSlug)}`
  }
  if (publicURL) {
    try {
      const parsed = new URL(publicURL)
      if (['http:', 'https:'].includes(parsed.protocol)) return parsed.href
    } catch {
      /* Fall back to the configured platform domain. */
    }
  }
  const tenantRootDomain = getTenantRootDomainFromHostname(hostname)
  if (tenantRootDomain) {
    return `${window.location.protocol}//${normalizedSlug}.${tenantRootDomain}/`
  }
  return `https://${normalizedSlug}.${getProviderRootDomain()}/`
}

export function getProviderRootURL(pathname = '/'): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  if (typeof window === 'undefined') {
    return `https://${getProviderRootDomain()}${normalizedPath}`
  }

  const hostname = window.location.hostname.toLowerCase()
  if (hostname.endsWith('.localhost')) {
    const port = window.location.port ? `:${window.location.port}` : ''
    return `${window.location.protocol}//localhost${port}${normalizedPath}`
  }
  const tenantRootDomain = getTenantRootDomainFromHostname(hostname)
  if (tenantRootDomain) {
    return `${window.location.protocol}//${tenantRootDomain}${normalizedPath}`
  }
  return `https://${getProviderRootDomain()}${normalizedPath}`
}
