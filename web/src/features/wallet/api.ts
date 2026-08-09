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

import type {
  RedemptionRequest,
  PaymentRequest,
  AmountRequest,
  AffiliateTransferRequest,
  ApiResponse,
  TopupInfoResponse,
  RedemptionResponse,
  AmountResponse,
  PaymentResponse,
  StripePaymentResponse,
  AffiliateCodeResponse,
  AffiliateTransferResponse,
  BillingHistoryResponse,
  CompleteOrderRequest,
  HubProviderSettlementSummary,
  HubProviderEarning,
  HubProviderWithdrawal,
  HubProviderPayoutAccount,
  HubProviderPayoutAccountDetails,
  HubProviderPayoutMethod,
  PagedApiData,
  CreemPaymentRequest,
  CreemPaymentResponse,
  WaffoPaymentRequest,
  WaffoPaymentResponse,
  WaffoPancakePaymentRequest,
  WaffoPancakePaymentResponse,
} from './types'

// ============================================================================
// Wallet API Functions
// ============================================================================

/**
 * Check if API response is successful
 */
export function isApiSuccess(response: ApiResponse): boolean {
  return response.success === true || response.message === 'success'
}

export const providerEarningSummaryQueryKey = [
  'hub-provider',
  'earnings',
  'summary',
] as const

/**
 * Get topup configuration info
 */
export async function getTopupInfo(): Promise<TopupInfoResponse> {
  const res = await api.get('/api/user/topup/info')
  return res.data
}

/**
 * Redeem a topup code
 */
export async function redeemTopupCode(
  request: RedemptionRequest
): Promise<RedemptionResponse> {
  const res = await api.post('/api/user/topup', request)
  return res.data
}

/**
 * Calculate payment amount for regular payment
 */
export async function calculateAmount(
  request: AmountRequest
): Promise<AmountResponse> {
  const res = await api.post('/api/user/amount', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Calculate payment amount for Stripe payment
 */
export async function calculateStripeAmount(
  request: AmountRequest
): Promise<AmountResponse> {
  const res = await api.post('/api/user/stripe/amount', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Calculate payment amount for Waffo payment
 */
export async function calculateWaffoAmount(
  request: AmountRequest
): Promise<AmountResponse> {
  const res = await api.post('/api/user/waffo/amount', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Request regular payment
 */
export async function requestPayment(
  request: PaymentRequest
): Promise<PaymentResponse> {
  const res = await api.post('/api/user/pay', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return {
    ...res.data,
    url: res.data.url || (res as unknown as { url?: string }).url,
  }
}

/**
 * Request Stripe payment
 */
export async function requestStripePayment(
  request: PaymentRequest
): Promise<StripePaymentResponse> {
  const res = await api.post('/api/user/stripe/pay', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Request Creem payment
 */
export async function requestCreemPayment(
  request: CreemPaymentRequest
): Promise<CreemPaymentResponse> {
  const res = await api.post('/api/user/creem/pay', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Request Waffo payment
 */
export async function requestWaffoPayment(
  request: WaffoPaymentRequest
): Promise<WaffoPaymentResponse> {
  const res = await api.post('/api/user/waffo/pay', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Calculate payment amount for Waffo Pancake payment
 */
export async function calculateWaffoPancakeAmount(
  request: AmountRequest
): Promise<AmountResponse> {
  const res = await api.post('/api/user/waffo-pancake/amount', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Request Waffo Pancake payment
 */
export async function requestWaffoPancakePayment(
  request: WaffoPancakePaymentRequest
): Promise<WaffoPancakePaymentResponse> {
  const res = await api.post('/api/user/waffo-pancake/pay', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Get affiliate code
 */
export async function getAffiliateCode(): Promise<AffiliateCodeResponse> {
  const res = await api.get('/api/user/aff')
  return res.data
}

/**
 * Transfer affiliate quota to balance
 */
export async function transferAffiliateQuota(
  request: AffiliateTransferRequest
): Promise<AffiliateTransferResponse> {
  const res = await api.post('/api/user/aff_transfer', request)
  return res.data
}

/**
 * Get billing history for current user
 */
export async function getUserBillingHistory(
  page: number,
  pageSize: number,
  keyword?: string
): Promise<ApiResponse<BillingHistoryResponse>> {
  const params = new URLSearchParams({
    p: page.toString(),
    page_size: pageSize.toString(),
  })
  if (keyword) {
    params.append('keyword', keyword)
  }
  const res = await api.get(`/api/user/topup/self?${params.toString()}`)
  return res.data
}

/**
 * Get billing history for all users (admin only)
 */
export async function getAllBillingHistory(
  page: number,
  pageSize: number,
  keyword?: string
): Promise<ApiResponse<BillingHistoryResponse>> {
  const params = new URLSearchParams({
    p: page.toString(),
    page_size: pageSize.toString(),
  })
  if (keyword) {
    params.append('keyword', keyword)
  }
  const res = await api.get(`/api/user/topup?${params.toString()}`)
  return res.data
}

/**
 * Complete a pending order (admin only)
 */
export async function completeOrder(
  request: CompleteOrderRequest
): Promise<ApiResponse> {
  const res = await api.post('/api/user/topup/complete', request)
  return res.data
}

export async function getProviderEarningSummary(): Promise<
  ApiResponse<HubProviderSettlementSummary>
> {
  const res = await api.get('/api/hub/provider/earnings/summary')
  return res.data
}

export async function getProviderEarnings(
  page: number,
  pageSize: number
): Promise<ApiResponse<PagedApiData<HubProviderEarning>>> {
  const res = await api.get('/api/hub/provider/earnings', {
    params: { p: page, page_size: pageSize },
  })
  return res.data
}

export async function getProviderWithdrawals(
  page: number,
  pageSize: number
): Promise<ApiResponse<PagedApiData<HubProviderWithdrawal>>> {
  const res = await api.get('/api/hub/provider/withdrawals', {
    params: { p: page, page_size: pageSize },
  })
  return res.data
}

export async function getProviderPayoutAccounts(): Promise<
  ApiResponse<HubProviderPayoutAccount[]>
> {
  const res = await api.get('/api/hub/provider/payout-accounts')
  return res.data
}

export async function createProviderPayoutAccount(payload: {
  method: HubProviderPayoutMethod
  details: HubProviderPayoutAccountDetails
  qr_code_asset_id: number
  is_default: boolean
}): Promise<ApiResponse<HubProviderPayoutAccount>> {
  const res = await api.post('/api/hub/provider/payout-accounts', payload, {
    skipBusinessError: true,
  })
  return res.data
}

export async function updateProviderPayoutAccount(
  id: number,
  payload: {
    method: HubProviderPayoutMethod
    details: HubProviderPayoutAccountDetails
    qr_code_asset_id: number
    is_default: boolean
  }
): Promise<ApiResponse<HubProviderPayoutAccount>> {
  const res = await api.put(
    `/api/hub/provider/payout-accounts/${id}`,
    payload,
    { skipBusinessError: true }
  )
  return res.data
}

export async function deleteProviderPayoutAccount(
  id: number
): Promise<ApiResponse> {
  const res = await api.delete(`/api/hub/provider/payout-accounts/${id}`, {
    skipBusinessError: true,
  })
  return res.data
}

export async function uploadProviderPayoutQRCode(
  file: File
): Promise<ApiResponse<{ id: number; content_type: string }>> {
  const payload = new FormData()
  payload.append('file', file)
  const res = await api.post('/api/hub/provider/payout-assets', payload, {
    headers: { 'Content-Type': 'multipart/form-data' },
    skipBusinessError: true,
  })
  return res.data
}

export async function getProviderPayoutAssetBlob(id: number): Promise<Blob> {
  const res = await api.get(`/api/hub/provider/payout-assets/${id}`, {
    responseType: 'blob',
  })
  return res.data
}

export async function createProviderWithdrawal(payload: {
  amount_quota: number
  payout_account_id: number
}): Promise<ApiResponse<HubProviderWithdrawal>> {
  const res = await api.post('/api/hub/provider/withdrawals', payload, {
    skipBusinessError: true,
  })
  return res.data
}
