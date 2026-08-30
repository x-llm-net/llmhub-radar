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
import z from 'zod'

import type { Channel } from '@/features/channels/types'
import { isProviderSlug } from '@/lib/provider-domain'

export type HubProviderStatus = 'pending' | 'active' | 'rejected' | 'disabled'
export type HubProviderWebsiteVerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'rejected'
export type HubProviderWebsiteVerificationMethod = 'manual' | 'dns' | 'http'
export type HubProviderContactType =
  | 'qq'
  | 'wechat'
  | 'telegram'
  | 'email'
  | 'phone'
  | 'other'
export type HubProviderSupportType =
  | 'community'
  | 'qq_group'
  | 'telegram_group'
  | 'customer_service'
  | 'announcement'
  | 'email'
  | 'other'

export type HubProvider = {
  id: number
  name: string
  slug: string
  public_url: string
  slug_base: string
  website: string
  website_verified_origin: string
  website_verification_status: HubProviderWebsiteVerificationStatus
  website_verification_method: HubProviderWebsiteVerificationMethod | ''
  website_evidence_asset_id: number
  website_verification_remark: string
  website_verification_last_error: string
  website_verified_at: number
  origin_verification_enabled: boolean
  website_verification_dns_record: string
  website_verification_dns_value: string
  website_verification_http_url: string
  website_verification_http_body: string
  description: string
  logo_url: string
  contact_type: HubProviderContactType
  contact_value: string
  support_type: HubProviderSupportType | ''
  support_value: string
  status: HubProviderStatus
  review_remark: string
  reviewed_by_user_id: number
  reviewed_at: number
  created_at: number
  updated_at: number
}

export type HubProviderResponse = {
  success: boolean
  message?: string
  data?: HubProvider | null
}

export type HubProviderOriginClaimStatus = 'pending' | 'verified' | 'conflict'
export type HubProviderOriginClaimMethod = 'dns' | 'http' | 'legacy'

export type HubProviderOriginClaim = {
  id: number
  origin: string
  hostname: string
  verification_method: HubProviderOriginClaimMethod
  status: HubProviderOriginClaimStatus
  verified_at: number
  created_at: number
  updated_at: number
  dns_record: string
  dns_value: string
  http_url: string
  http_body: string
}

export type HubProviderOriginClaimsResponse = {
  success: boolean
  message?: string
  data?: HubProviderOriginClaim[]
}

export type HubProviderOriginClaimResponse = {
  success: boolean
  message?: string
  data?: HubProviderOriginClaim
}

export type HubSupplyProfile = {
  id: number
  public_id: string
  price_multiplier: number
  tenant_published: boolean
  status: string
  published_models: string[]
  online_models: string[]
  published_model_count: number
  online_model_count: number
  config_version: number
  text_probe_minutes: number
  image_probe_minutes: number
  available_model_count: number
  error_model_count: number
  pending_model_count: number
  last_probe_at: number
  next_manual_probe_at: number
  created_at: number
  updated_at: number
}

export type HubProviderChannel = {
  channel: Channel
  supply: HubSupplyProfile
}

export type HubProviderChannelListResponse = {
  success: boolean
  message?: string
  data?: {
    items: HubProviderChannel[]
    total: number
    page: number
    page_size: number
    type_counts?: Record<string, number>
  }
}

export type HubProviderChannelSortBy =
  | 'id'
  | 'name'
  | 'price_multiplier'
  | 'status'
  | 'last_probe_at'
  | 'updated_at'

export type HubProviderChannelListParams = {
  keyword?: string
  model?: string
  status?: string
  type?: number
  sort_by?: HubProviderChannelSortBy
  sort_order?: 'asc' | 'desc'
  p?: number
  page_size?: number
}

export type HubProviderChannelResponse = {
  success: boolean
  message?: string
  data?: HubProviderChannel
}

export type HubProviderChannelCreateResponse = {
  success: boolean
  message?: string
  data?: HubProviderChannel[]
}

export type HubSupplyProbeEndpoint = {
  endpoint_type: string
  resolved_endpoint_type: string
  probe_kind: 'text' | 'image'
  status:
    | 'pending'
    | 'testing'
    | 'waiting'
    | 'available'
    | 'error'
    | 'suspended'
  last_probe_at: number
  last_latency_ms: number
  last_first_token_ms: number | null
  last_error: string
  last_error_code: string
  consecutive_failures: number
  suspended_at: number
  suspension_reason: string
}

export type HubSupplyProbeEndpointMode =
  | 'auto'
  | 'openai'
  | 'openai-response'
  | 'image-generation'

export type HubSupplyModelProbe = {
  model_name: string
  endpoint_mode: HubSupplyProbeEndpointMode
  status:
    | 'pending'
    | 'testing'
    | 'waiting'
    | 'available'
    | 'error'
    | 'suspended'
    | 'skipped'
  auto_probe_enabled: boolean
  published: boolean
  online: boolean
  last_probe_at: number
  endpoints: HubSupplyProbeEndpoint[]
}

export type HubProviderChannelProbeState = {
  channel_id: number
  name: string
  running: boolean
  next_manual_probe_at: number
  models: HubSupplyModelProbe[]
}

export type HubProviderChannelProbeResponse = {
  success: boolean
  message?: string
  data?: HubProviderChannelProbeState
}

export type HubSupplyProbeRequestResponse = {
  success: boolean
  message?: string
  data?: {
    next_manual_probe_at: number
    model_status?: 'waiting' | 'available' | 'error'
  }
}

export type HubSupplyModelPublicationResponse = {
  success: boolean
  message?: string
  data?: {
    model_name: string
    published: boolean
    online: boolean
    published_model_count: number
    online_model_count: number
  }
}

export type HubSupplyModelsPublicationResponse = {
  success: boolean
  message?: string
  data?: {
    model_names: string[]
    published: boolean
    published_model_count: number
    online_model_count: number
  }
}

export type HubSupplyFailedModelsDeleteResponse = {
  success: boolean
  message?: string
  data?: {
    deleted_count: number
    deleted_models: string[]
  }
}

export type HubSupplyModelAutoProbeResponse = {
  success: boolean
  message?: string
  data?: {
    model_name: string
    auto_probe_enabled: boolean
    online: boolean
  }
}

export const providerFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Provider name is required')
    .max(80, 'Provider name must be at most 80 characters'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      isProviderSlug,
      'Provider subdomain must use 1-63 lowercase letters, numbers, or hyphens'
    ),
  website: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || /^https?:\/\/[^\s]+$/i.test(value),
      'Website must be a valid HTTP or HTTPS URL'
    ),
  description: z
    .string()
    .trim()
    .max(1000, 'Provider description must be at most 1000 characters'),
  logo_url: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || /^https?:\/\/[^\s]+$/i.test(value),
      'Logo URL must be a valid HTTP or HTTPS URL'
    ),
  contact_type: z
    .string()
    .refine(
      (value) =>
        ['qq', 'wechat', 'telegram', 'email', 'phone', 'other'].includes(value),
      'Select a review contact method'
    ),
  contact_value: z
    .string()
    .trim()
    .min(1, 'Review contact is required')
    .max(256, 'Review contact must be at most 256 characters'),
  support_type: z
    .string()
    .refine(
      (value) =>
        [
          'community',
          'qq_group',
          'telegram_group',
          'customer_service',
          'announcement',
          'email',
          'other',
        ].includes(value),
      'Select a public support type'
    ),
  support_value: z
    .string()
    .trim()
    .max(512, 'Public support entry must be at most 512 characters'),
})

export type ProviderFormValues = z.infer<typeof providerFormSchema>

export const hubSupplySettingsSchema = z.object({
  price_multiplier: z
    .number()
    .min(0.01, 'Supply multiplier must be at least 0.01')
    .max(100, 'Supply multiplier must be at most 100'),
  text_probe_minutes: z
    .number()
    .int()
    .min(5, 'Probe interval must be at least 5 minutes')
    .max(1440, 'Probe interval must be at most 1440 minutes'),
  image_probe_minutes: z
    .number()
    .int()
    .min(5, 'Probe interval must be at least 5 minutes')
    .max(1440, 'Probe interval must be at most 1440 minutes'),
})

export type HubSupplySettings = z.infer<typeof hubSupplySettingsSchema>

export const DEFAULT_HUB_SUPPLY_SETTINGS: HubSupplySettings = {
  price_multiplier: Number.NaN,
  text_probe_minutes: 20,
  image_probe_minutes: 60,
}
