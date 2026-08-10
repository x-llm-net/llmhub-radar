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

export type HubRoutingMetric = {
  model_name: string
  endpoint_type: string
  provider_id: number
  channel_id: number
  request_count: number
  success_count: number
  success_rate: number
  avg_latency_ms: number
  avg_first_token_ms?: number
}

export type HubRoutingMetricsParams = {
  hours?: number
  limit?: number
}

export type HubRoutingMetricsResponse = {
  success: boolean
  message?: string
  data?: {
    hours: number
    start_ts: number
    end_ts: number
    items: HubRoutingMetric[]
  }
}

export const hubRoutingMetricsQueryKey = [
  'hub-admin',
  'routing-metrics',
] as const

export async function getHubRoutingMetrics(
  params: HubRoutingMetricsParams = {}
): Promise<HubRoutingMetricsResponse> {
  const response = await api.get('/api/hub/admin/routing-metrics', { params })
  return response.data
}
