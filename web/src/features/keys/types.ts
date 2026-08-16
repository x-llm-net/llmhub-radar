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
import { z } from 'zod'

// ============================================================================
// API Key Schema & Types
// ============================================================================

export const apiKeySchema = z.object({
  id: z.number(),
  name: z.string(),
  key: z.string(),
  status: z.number(), // 1: enabled, 2: disabled, 3: expired, 4: exhausted
  remain_quota: z.number(),
  used_quota: z.number(),
  unlimited_quota: z.boolean(),
  expired_time: z.number(), // -1 for never expires
  created_time: z.number(),
  accessed_time: z.number(),
  group: z.string().nullish().default(''),
  auto_groups: z.array(z.string()).nullish().default(null),
  cross_group_retry: z
    .preprocess((v) => {
      if (v === 1) return true
      if (v === 0) return false
      return v
    }, z.boolean())
    .optional()
    .default(false),
  model_limits_enabled: z.boolean(),
  model_limits: z.string().nullish().default(''),
  allow_ips: z.string().nullish().default(''),
  hub_routing_policy: z
    .object({
      mode: z.enum(['public_pool', 'provider']),
      provider_id: z.number().optional(),
      selections: z.array(
        z.object({
          family: z.string(),
          min_multiplier: z.number().optional(),
          max_multiplier: z.number().optional(),
          exact_multipliers: z.array(z.number()).optional(),
        })
      ),
    })
    .nullish(),
})

export type ApiKey = z.infer<typeof apiKeySchema>

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface GetApiKeysParams {
  p?: number
  size?: number
}

export interface GetApiKeysResponse {
  success: boolean
  message?: string
  data?: {
    items: ApiKey[]
    total: number
    page: number
    page_size: number
  }
}

export interface SearchApiKeysParams {
  keyword?: string
  token?: string
  p?: number
  size?: number
}

export interface ApiKeyFormData {
  name: string
  remain_quota: number
  expired_time: number
  unlimited_quota: boolean
  model_limits_enabled: boolean
  model_limits: string
  allow_ips: string
  group: string
  auto_groups: string[]
  cross_group_retry: boolean
  hub_routing_policy?: HubTokenRoutingPolicy
}

export interface HubTokenRoutingSelection {
  family: string
  min_multiplier?: number
  max_multiplier?: number
  exact_multipliers?: number[]
}

export interface HubTokenRoutingPolicy {
  mode: 'public_pool' | 'provider'
  provider_id?: number
  selections: HubTokenRoutingSelection[]
}

export interface HubTokenRoutingAvailability {
  multiplier: number
  channel_count: number
  provider_count: number
  provider_ids?: number[]
}

export interface HubTokenRoutingFamilyOption {
  key: string
  min_multiplier: number
  max_multiplier: number
  slider_max_multiplier: number
  step: number
  available_channel_count: number
  provider_count: number
  exact_multipliers?: number[]
  availability: HubTokenRoutingAvailability[]
}

export interface HubTokenRoutingOptions {
  mode: 'public_pool' | 'provider'
  provider_id?: number
  provider_name?: string
  provider_slug?: string
  families: HubTokenRoutingFamilyOption[]
  tier_ceilings: Record<
    string,
    { special: number; low: number; medium: number; high: number }
  >
}

export interface TokenAutoGroupsConfig {
  groups: string[]
  max_count: number
}

// ============================================================================
// Dialog Types
// ============================================================================

export type ApiKeysDialogType =
  | 'create'
  | 'update'
  | 'delete'
  | 'batch-delete'
  | 'cc-switch'
