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

export type ProviderNotificationWebhook = {
  id: string
  name: string
  url: string
  enabled: boolean
}

export type ProviderNotificationSettings = {
  enabled: boolean
  notify_on_application: boolean
  notify_on_review: boolean
  email_recipients: string[]
  webhooks: ProviderNotificationWebhook[]
}

type ProviderNotificationSettingsResponse = {
  success: boolean
  message: string
  data: ProviderNotificationSettings
}

export async function getProviderNotificationSettings() {
  const response = await api.get<ProviderNotificationSettingsResponse>(
    '/api/hub/admin/notifications/settings'
  )
  if (!response.data.success) {
    throw new Error(
      response.data.message || 'Failed to load provider notification settings'
    )
  }
  return response.data.data
}

export async function updateProviderNotificationSettings(
  settings: ProviderNotificationSettings
) {
  const response = await api.put<ProviderNotificationSettingsResponse>(
    '/api/hub/admin/notifications/settings',
    settings
  )
  if (!response.data.success) {
    throw new Error(
      response.data.message || 'Failed to update provider notification settings'
    )
  }
  return response.data.data
}

export async function testProviderNotification() {
  const response = await api.post<ProviderNotificationSettingsResponse>(
    '/api/hub/admin/notifications/settings/test'
  )
  if (!response.data.success) {
    throw new Error(response.data.message || 'Failed to send test notification')
  }
  return response.data
}
