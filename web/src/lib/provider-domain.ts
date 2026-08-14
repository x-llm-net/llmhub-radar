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
  return (configured || DEFAULT_PROVIDER_ROOT_DOMAIN).toLowerCase()
}

export function isProviderSlug(value: string): boolean {
  const slug = value.trim().toLowerCase()
  return (
    slug.length >= 3 &&
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
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '')
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
  const currentHostname = (hostname ?? window.location.hostname)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  const localSuffix = '.localhost'
  const productionSuffix = `.${getProviderRootDomain()}`
  let slug = ''

  if (currentHostname.endsWith(localSuffix)) {
    slug = currentHostname.slice(0, -localSuffix.length)
  } else if (currentHostname.endsWith(productionSuffix)) {
    slug = currentHostname.slice(0, -productionSuffix.length)
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
    return (
      hostname === getProviderRootDomain() ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      getProviderSlugFromHostname(hostname) !== null
    )
  } catch {
    return false
  }
}

export function getProviderPublicURL(slug: string): string {
  const normalizedSlug = slug.trim().toLowerCase()
  if (typeof window === 'undefined') {
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
  return `https://${normalizedSlug}.${getProviderRootDomain()}/`
}
