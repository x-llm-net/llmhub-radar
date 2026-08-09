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

export type HubProvider = {
  id: number
  name: string
  slug: string
  website: string
  description: string
  logo_url: string
  status: string
  created_at: number
  updated_at: number
}

export type HubProviderResponse = {
  success: boolean
  message?: string
  data?: HubProvider | null
}

export type HubSupplyProfile = {
  id: number
  public_id: string
  price_multiplier: number
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
  status: 'pending' | 'testing' | 'waiting' | 'available' | 'error'
  last_probe_at: number
  last_latency_ms: number
  last_first_token_ms: number | null
  last_error: string
  last_error_code: string
}

export type HubSupplyProbeEndpointMode =
  | 'auto'
  | 'openai'
  | 'openai-response'
  | 'image-generation'

export type HubSupplyModelProbe = {
  model_name: string
  endpoint_mode: HubSupplyProbeEndpointMode
  status: 'pending' | 'testing' | 'waiting' | 'available' | 'error'
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
      'Provider subdomain must use 3-63 lowercase letters, numbers, or hyphens'
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
  price_multiplier: 1,
  text_probe_minutes: 10,
  image_probe_minutes: 30,
}
