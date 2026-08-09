import { getProviderSlugFromHostname } from '../../../lib/provider-domain.ts'

type StoredStatus = {
  server_address?: unknown
  data?: {
    server_address?: unknown
  }
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  )
}

export function resolveServerAddress(
  browserOrigin: string,
  configuredAddress?: unknown
): string {
  const fallback = trimTrailingSlashes(browserOrigin)
  try {
    if (getProviderSlugFromHostname(new URL(browserOrigin).hostname)) {
      return fallback
    }
  } catch {
    return fallback
  }

  if (typeof configuredAddress !== 'string' || !configuredAddress.trim()) {
    return fallback
  }

  try {
    const configuredUrl = new URL(configuredAddress.trim())
    if (!['http:', 'https:'].includes(configuredUrl.protocol)) return fallback

    if (
      isLoopbackHostname(configuredUrl.hostname) &&
      configuredUrl.origin !== browserOrigin
    ) {
      return fallback
    }

    return trimTrailingSlashes(configuredAddress.trim())
  } catch {
    return fallback
  }
}

export function getServerAddress(): string {
  const browserOrigin = window.location.origin

  try {
    const raw = localStorage.getItem('status')
    if (!raw) return resolveServerAddress(browserOrigin)

    const status = JSON.parse(raw) as StoredStatus
    return resolveServerAddress(
      browserOrigin,
      status.server_address ?? status.data?.server_address
    )
  } catch {
    return resolveServerAddress(browserOrigin)
  }
}
