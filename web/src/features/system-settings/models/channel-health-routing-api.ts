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
import { api } from '@/lib/api'

export type HubRoutingHealthRow = {
  global_rank: number
  channel_id: number
  channel_name: string
  channel_type: number
  channel_status: number
  channel_status_reason: string
  provider_id: number
  provider_name: string
  provider_status: string
  supply_group_id: number
  supply_status: string
  price_multiplier: number | null
  model_name: string
  model_family: string
  endpoint_type: string
  endpoint_mode: string
  resolved_endpoint_type: string
  probe_kind: string
  published: boolean
  eligible_service_tiers: string[]
  routable_service_tiers: string[]
  probe_status: string
  last_probe_at: number
  last_success_at: number
  last_latency_ms: number
  last_first_token_ms: number | null
  last_error: string
  last_error_code: string
  consecutive_failures: number
  probe_routable: boolean
  probe_health_state: string
  suspended_at: number
  suspension_reason: string
  real_health_state: string
  real_window_started_at: number
  real_sample_count: number
  real_success_rate_bps: number
  consecutive_unhealthy_windows: number
  real_first_token_sample_count: number
  real_first_token_p50_ms: number | null
  real_first_token_p95_ms: number | null
  probe_availability_factor_bps: number
  real_availability_factor_bps: number
  availability_factor_bps: number
  probe_latency_score_bps: number
  real_latency_score_bps: number
  latency_factor_bps: number
  static_weight: number
  effective_weight: number
  routing_hard_unavailable: boolean
  sample_count_7d: number
  success_rate_7d: number | null
  latency_p50_ms: number | null
  latency_p95_ms: number | null
  first_token_p50_ms: number | null
  first_token_p95_ms: number | null
  confidence_bps: number | null
  ranking_score_bps: number | null
  skip_reason_codes: string[]
  routing_routable: boolean
  service_tier_routable: boolean
}

export type HubRoutingHealthParams = {
  keyword?: string
  provider_id?: string
  model?: string
  endpoint?: string
  channel_status?: number
  probe_status?: string
  service_tier?: string
  p: number
  page_size: number
}

export type HubRoutingHealthResponse = {
  success: boolean
  message?: string
  data?: {
    items: HubRoutingHealthRow[]
    total: number
    page: number
    page_size: number
  }
}

export const hubRoutingHealthQueryKey = ['hub-admin', 'routing-health'] as const

export async function getHubRoutingHealth(
  params: HubRoutingHealthParams
): Promise<HubRoutingHealthResponse> {
  const response = await api.get('/api/hub/admin/routing-health', { params })
  return response.data
}
