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
export type ProviderPublicIdentity = {
  id: number
  name: string
  slug: string
  website: string
  description: string
  logo_url: string
}

export type ProviderPublicBucket = {
  started_at: number
  status: 'available' | 'degraded' | 'error' | 'unknown'
  sample_count: number
  success_rate: number
}

export type ProviderPublicModel = {
  model_name: string
  family_key: string
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

export type ProviderPublicFamily = {
  key: string
  models: ProviderPublicModel[]
}

export type ProviderPublicStats = {
  published_model_count: number
  online_model_count: number
  channel_count: number
  stability_7d: number
  sample_count: number
  last_probe_at: number
}

export type ProviderPublicProfile = {
  provider: ProviderPublicIdentity
  stats: ProviderPublicStats
  models: ProviderPublicModel[]
}

export type ProviderPublicResponse = {
  success: boolean
  message?: string
  data?: ProviderPublicProfile
}
