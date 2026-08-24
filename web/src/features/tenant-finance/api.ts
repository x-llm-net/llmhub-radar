import type {
  ApiResponse,
  HubProviderEarning,
  HubProviderPayoutAccount,
  HubProviderPayoutAccountDetails,
  HubProviderPayoutMethod,
  HubProviderSettlementSummary,
  HubProviderWithdrawal,
  PagedApiData,
} from '@/features/wallet/types'
/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { api } from '@/lib/api'

export type HubTenantSettlementSummary = Omit<
  HubProviderSettlementSummary,
  'provider_id'
> & {
  tenant_id: number
}

export type HubTenantEarning = HubProviderEarning
export type HubTenantWithdrawal = Omit<HubProviderWithdrawal, 'provider_id'> & {
  tenant_id: number
}

export const tenantFinanceSummaryQueryKey = [
  'hub-tenant',
  'earnings',
  'summary',
] as const
export const tenantFinanceEarningsQueryKey = ['hub-tenant', 'earnings'] as const
export const tenantFinanceWithdrawalsQueryKey = [
  'hub-tenant',
  'withdrawals',
] as const
export const tenantFinanceAccountsQueryKey = [
  'hub-tenant',
  'payout-accounts',
] as const

export async function getTenantEarningSummary(): Promise<
  ApiResponse<HubTenantSettlementSummary>
> {
  const response = await api.get('/api/hub/tenant/earnings/summary')
  return response.data
}

export async function getTenantEarnings(
  page: number,
  pageSize: number
): Promise<ApiResponse<PagedApiData<HubTenantEarning>>> {
  const response = await api.get('/api/hub/tenant/earnings', {
    params: { p: page, page_size: pageSize },
  })
  return response.data
}

export async function transferTenantEarningsToBalance(payload: {
  amount_quota: number
  idempotency_key: string
}): Promise<ApiResponse<HubTenantEarning>> {
  const response = await api.post(
    '/api/hub/tenant/earnings/balance-transfer',
    payload,
    { skipBusinessError: true }
  )
  return response.data
}

export async function getTenantWithdrawals(
  page: number,
  pageSize: number
): Promise<ApiResponse<PagedApiData<HubTenantWithdrawal>>> {
  const response = await api.get('/api/hub/tenant/withdrawals', {
    params: { p: page, page_size: pageSize },
  })
  return response.data
}

export async function getTenantPayoutAccounts(): Promise<
  ApiResponse<HubProviderPayoutAccount[]>
> {
  const response = await api.get('/api/hub/tenant/payout-accounts')
  return response.data
}

export async function createTenantPayoutAccount(payload: {
  method: HubProviderPayoutMethod
  details: HubProviderPayoutAccountDetails
  qr_code_asset_id: number
  is_default: boolean
}): Promise<ApiResponse<HubProviderPayoutAccount>> {
  const response = await api.post('/api/hub/tenant/payout-accounts', payload, {
    skipBusinessError: true,
  })
  return response.data
}

export async function updateTenantPayoutAccount(
  accountId: number,
  payload: {
    method: HubProviderPayoutMethod
    details: HubProviderPayoutAccountDetails
    qr_code_asset_id: number
    is_default: boolean
  }
): Promise<ApiResponse<HubProviderPayoutAccount>> {
  const response = await api.put(
    `/api/hub/tenant/payout-accounts/${accountId}`,
    payload,
    { skipBusinessError: true }
  )
  return response.data
}

export async function deleteTenantPayoutAccount(
  accountId: number
): Promise<ApiResponse> {
  const response = await api.delete(
    `/api/hub/tenant/payout-accounts/${accountId}`,
    { skipBusinessError: true }
  )
  return response.data
}

export async function uploadTenantPayoutQRCode(
  file: File
): Promise<ApiResponse<{ id: number; content_type: string }>> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post('/api/hub/tenant/payout-assets', formData, {
    skipBusinessError: true,
  })
  return response.data
}

export async function getTenantPayoutAssetBlob(id: number): Promise<Blob> {
  const response = await api.get(`/api/hub/tenant/payout-assets/${id}`, {
    responseType: 'blob',
  })
  return response.data
}

export async function createTenantWithdrawal(payload: {
  amount_quota: number
  payout_account_id: number
}): Promise<ApiResponse<HubTenantWithdrawal>> {
  const response = await api.post('/api/hub/tenant/withdrawals', payload, {
    skipBusinessError: true,
  })
  return response.data
}
