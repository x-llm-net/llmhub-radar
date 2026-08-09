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
// ============================================================================
// Home Page Types
// ============================================================================

import type {
  ProviderPublicBucket,
  ProviderPublicIdentity,
} from '@/features/provider-public/types'

export type PublicHomeProvider = {
  provider: ProviderPublicIdentity
  online: boolean
  channel_count: number
  online_channel_count: number
  min_price_multiplier: number
  stability_7d: number
  sample_count: number
  average_latency_ms: number
  first_token_p50_ms: number | null
  first_token_p95_ms: number | null
  last_probe_at: number
  timeline: ProviderPublicBucket[]
}

export type PublicHomeModel = {
  model_name: string
  provider_count: number
  online_provider_count: number
  providers: PublicHomeProvider[]
}

export type PublicHomeFamily = {
  key: string
  models: PublicHomeModel[]
}

export type PublicHomeData = {
  provider_count: number
  published_model_count: number
  last_probe_at: number
  generated_at: number
  families: PublicHomeFamily[]
}

export type PublicHomeResponse = {
  success: boolean
  message?: string
  data?: PublicHomeData
}

/**
 * Response from home page content API
 */
export interface HomePageContentResponse {
  success: boolean
  message?: string
  data?: string
}

/**
 * Home page content result from hook
 */
export interface HomePageContentResult {
  content: string
  isLoaded: boolean
  isUrl: boolean
}
