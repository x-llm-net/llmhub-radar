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
  HubProviderPayoutAccountDetails,
  HubProviderPayoutMethod,
} from '../types'

export function payoutMethodLabel(
  method: HubProviderPayoutMethod,
  t: (key: string) => string
): string {
  if (method === 'alipay') return t('Alipay')
  if (method === 'wechat') return t('WeChat')
  return t('Bank transfer')
}

export function payoutAccountTypeLabel(
  accountType: HubProviderPayoutAccountDetails['account_type'],
  t: (key: string) => string
): string {
  return accountType === 'business'
    ? t('Business account')
    : t('Personal account')
}

export function formatPaidAmount(
  currency: string,
  amountMinor: number
): string {
  if (!currency || amountMinor <= 0) return '-'
  return `${currency} ${(amountMinor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
