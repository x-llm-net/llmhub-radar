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
import type {
  AddChannelRequest,
  Channel,
  FetchModelsResponse,
} from '@/features/channels/types'
import { api } from '@/lib/api'

import type {
  HubProviderResponse,
  HubProviderWebsiteVerificationMethod,
  HubProviderOriginClaimMethod,
  HubProviderOriginClaimResponse,
  HubProviderOriginClaimsResponse,
  HubProviderChannelCreateResponse,
  HubProviderChannelListParams,
  HubProviderChannelListResponse,
  HubProviderChannelResponse,
  HubProviderChannelProbeResponse,
  HubSupplyProbeRequestResponse,
  HubSupplyFailedModelsDeleteResponse,
  HubSupplyModelAutoProbeResponse,
  HubSupplyModelPublicationResponse,
  HubSupplyModelsPublicationResponse,
  HubSupplyProbeEndpointMode,
  HubSupplySettings,
  ProviderFormValues,
} from './types'

export async function getProviderOriginClaims(): Promise<HubProviderOriginClaimsResponse> {
  const response = await api.get('/api/hub/provider/origins')
  const result = response.data as HubProviderOriginClaimsResponse
  if (!result.success) {
    throw new Error(result.message || 'Failed to load upstream sites')
  }
  return result
}

export async function createProviderOriginClaim(
  baseURL: string,
  verificationMethod: HubProviderOriginClaimMethod
): Promise<HubProviderOriginClaimResponse> {
  const response = await api.post('/api/hub/provider/origins', {
    base_url: baseURL,
    verification_method: verificationMethod,
  })
  return response.data
}

export async function verifyProviderOriginClaim(
  claimID: number
): Promise<HubProviderOriginClaimResponse> {
  const response = await api.post(`/api/hub/provider/origins/${claimID}/verify`)
  return response.data
}

export async function deleteProviderOriginClaim(
  claimID: number
): Promise<{ success: boolean; message?: string }> {
  const response = await api.delete(`/api/hub/provider/origins/${claimID}`)
  return response.data
}

export async function getProviderSelf(): Promise<HubProviderResponse> {
  const response = await api.get('/api/hub/provider/self')
  const result = response.data as HubProviderResponse
  if (!result.success) {
    throw new Error(result.message || 'Failed to load provider')
  }
  return result
}

export async function createProvider(
  values: ProviderFormValues,
  websiteEvidence?: File,
  logoFile?: File
): Promise<HubProviderResponse> {
  if (websiteEvidence || logoFile) {
    const formData = new FormData()
    formData.append('profile', JSON.stringify(values))
    if (websiteEvidence) {
      formData.append('verify_website', 'true')
      formData.append('file', websiteEvidence)
    }
    if (logoFile) formData.append('logo', logoFile)
    const response = await api.post('/api/hub/provider', formData, {
      skipErrorHandler: true,
    })
    return response.data
  }
  const response = await api.post('/api/hub/provider', values, {
    skipErrorHandler: true,
  })
  return response.data
}

export async function updateProvider(
  values: ProviderFormValues,
  websiteEvidence?: File,
  logoFile?: File
): Promise<HubProviderResponse> {
  if (websiteEvidence || logoFile) {
    const formData = new FormData()
    formData.append('profile', JSON.stringify(values))
    if (websiteEvidence) {
      formData.append('verify_website', 'true')
      formData.append('file', websiteEvidence)
    }
    if (logoFile) formData.append('logo', logoFile)
    const response = await api.put('/api/hub/provider', formData, {
      skipErrorHandler: true,
    })
    return response.data
  }
  const response = await api.put('/api/hub/provider', values, {
    skipErrorHandler: true,
  })
  return response.data
}

export async function uploadProviderWebsiteEvidence(file: File): Promise<{
  success: boolean
  message?: string
  data?: { id: number; content_type: string }
}> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post(
    '/api/hub/provider/website-verification/assets',
    formData
  )
  return response.data
}

export function getProviderWebsiteEvidenceURL(assetId: number): string {
  return `/api/hub/provider/website-verification/assets/${assetId}`
}

export async function getProviderWebsiteEvidence(
  assetId: number
): Promise<Blob> {
  const response = await api.get(getProviderWebsiteEvidenceURL(assetId), {
    responseType: 'blob',
  })
  return response.data
}

export async function submitProviderWebsiteVerification(
  method: HubProviderWebsiteVerificationMethod,
  evidenceAssetId = 0
): Promise<HubProviderResponse> {
  const response = await api.post('/api/hub/provider/website-verification', {
    method,
    evidence_asset_id: evidenceAssetId,
  })
  return response.data
}

export async function verifyProviderWebsite(): Promise<HubProviderResponse> {
  const response = await api.post(
    '/api/hub/provider/website-verification/verify'
  )
  return response.data
}

export async function getProviderChannels(
  params: HubProviderChannelListParams = {}
): Promise<HubProviderChannelListResponse> {
  const response = await api.get('/api/hub/provider/channels', { params })
  const result = response.data as HubProviderChannelListResponse
  if (!result.success) {
    throw new Error(result.message || 'Failed to load supply channels')
  }
  return result
}

export async function getProviderChannel(
  channelId: number
): Promise<HubProviderChannelResponse> {
  const response = await api.get(`/api/hub/provider/channels/${channelId}`)
  const result = response.data as HubProviderChannelResponse
  if (!result.success || !result.data) {
    throw new Error(result.message || 'Failed to load supply channel')
  }
  return result
}

export async function createProviderChannel(
  payload: AddChannelRequest,
  supply: HubSupplySettings
): Promise<HubProviderChannelCreateResponse> {
  const response = await api.post('/api/hub/provider/channels', {
    ...payload,
    supply,
  })
  return response.data
}

export async function updateProviderChannel(
  channelId: number,
  channel: Partial<Channel>,
  supply: HubSupplySettings
): Promise<HubProviderChannelResponse> {
  const response = await api.put(`/api/hub/provider/channels/${channelId}`, {
    ...channel,
    supply,
  })
  return response.data
}

export async function deleteProviderChannel(
  channelId: number
): Promise<{ success: boolean; message?: string }> {
  const response = await api.delete(`/api/hub/provider/channels/${channelId}`)
  return response.data
}

export async function fetchProviderChannelModels(
  channelId: number
): Promise<FetchModelsResponse> {
  const response = await api.get(
    `/api/hub/provider/channels/${channelId}/fetch-models`
  )
  return response.data
}

export async function previewProviderChannelModels(data: {
  base_url: string
  type: number
  key?: string
  channel_id?: number
  advanced_custom?: string
  header_override?: string
  proxy?: string
}): Promise<FetchModelsResponse> {
  const response = await api.post(
    '/api/hub/provider/channels/fetch-models',
    data
  )
  return response.data
}

export async function getProviderChannelGroups() {
  const response = await api.get('/api/hub/provider/channels/options/groups')
  return response.data as {
    success: boolean
    message?: string
    data?: string[]
  }
}

export async function getProviderChannelModels() {
  const response = await api.get('/api/hub/provider/channels/options/models')
  return response.data as {
    success: boolean
    message?: string
    data?: Array<{ id: string; [key: string]: unknown }>
  }
}

export async function getProviderChannelPrefillGroups() {
  const response = await api.get('/api/hub/provider/channels/options/prefill', {
    params: { type: 'model' },
  })
  return response.data as {
    success: boolean
    message?: string
    data?: Array<{ id: number; name: string; items: string | string[] }>
  }
}

export async function requestProviderChannelProbe(
  channelId: number
): Promise<HubSupplyProbeRequestResponse> {
  const response = await api.post(
    `/api/hub/provider/channels/${channelId}/probe`
  )
  return response.data
}

export async function getProviderChannelProbes(
  channelId: number
): Promise<HubProviderChannelProbeResponse> {
  const response = await api.get(
    `/api/hub/provider/channels/${channelId}/probes`
  )
  const result = response.data as HubProviderChannelProbeResponse
  if (!result.success || !result.data) {
    throw new Error(result.message || 'Failed to load detection results')
  }
  return result
}

export async function requestProviderChannelModelProbe(
  channelId: number,
  modelName: string
): Promise<HubSupplyProbeRequestResponse> {
  const response = await api.post(
    `/api/hub/provider/channels/${channelId}/probe-model`,
    { model_name: modelName }
  )
  return response.data
}

export async function updateProviderChannelModelProbeEndpoint(
  channelId: number,
  modelName: string,
  endpointType: HubSupplyProbeEndpointMode
): Promise<HubSupplyProbeRequestResponse> {
  const response = await api.put(
    `/api/hub/provider/channels/${channelId}/probe-model-endpoint`,
    { model_name: modelName, endpoint_type: endpointType }
  )
  return response.data
}

export async function updateProviderChannelModelAutoProbe(
  channelId: number,
  modelName: string,
  enabled: boolean
): Promise<HubSupplyModelAutoProbeResponse> {
  const response = await api.put(
    `/api/hub/provider/channels/${channelId}/model-auto-probe`,
    { model_name: modelName, enabled },
    { skipBusinessError: true, skipErrorHandler: true }
  )
  return response.data
}

export async function updateProviderChannelModelPublication(
  channelId: number,
  modelName: string,
  published: boolean
): Promise<HubSupplyModelPublicationResponse> {
  const response = await api.put(
    `/api/hub/provider/channels/${channelId}/model-publication`,
    { model_name: modelName, published },
    { skipBusinessError: true, skipErrorHandler: true }
  )
  return response.data
}

export async function updateProviderChannelModelsPublication(
  channelId: number,
  modelNames: string[],
  published: boolean
): Promise<HubSupplyModelsPublicationResponse> {
  const response = await api.put(
    `/api/hub/provider/channels/${channelId}/model-publication/batch`,
    { model_names: modelNames, published },
    { skipBusinessError: true, skipErrorHandler: true }
  )
  return response.data
}

export async function deleteProviderChannelFailedModels(
  channelId: number
): Promise<HubSupplyFailedModelsDeleteResponse> {
  const response = await api.delete(
    `/api/hub/provider/channels/${channelId}/failed-models`,
    { skipBusinessError: true, skipErrorHandler: true }
  )
  return response.data
}
