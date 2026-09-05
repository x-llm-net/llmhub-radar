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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createInstance } from 'i18next'

import { apiKeySchema, type HubTokenRoutingOptions } from '../../types'
import {
  getApiKeyFormDefaultValues,
  getApiKeyFormSchema,
  transformApiKeyToFormDefaults,
  transformFormDataToPayload,
} from '../api-key-form'

const options: HubTokenRoutingOptions = {
  mode: 'channels',
  provider_id: 7,
  channels: [],
}
const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })

describe('API key channel routing policy mapping', () => {
  test('sends only ordered channel IDs and disables the old group route', () => {
    const values = {
      ...getApiKeyFormDefaultValues(true),
      group: 'auto',
      auto_groups: ['vip'],
      hub_channel_ids: [30, 10, 20],
    }
    const payload = transformFormDataToPayload(values, options)
    assert.equal(payload.group, 'default')
    assert.equal(payload.cross_group_retry, false)
    assert.deepEqual(payload.auto_groups, [])
    assert.deepEqual(payload.hub_routing_policy, {
      mode: 'channels',
      provider_id: 7,
      channel_ids: [30, 10, 20],
    })
  })

  test('rejects duplicate and over-limit channel selections', () => {
    const schema = getApiKeyFormSchema(i18n.t)
    const values = {
      ...getApiKeyFormDefaultValues(false),
      name: 'test',
      group: 'default',
    }
    assert.equal(
      schema.safeParse({ ...values, hub_channel_ids: [3, 3] }).success,
      false
    )
    assert.equal(
      schema.safeParse({
        ...values,
        hub_channel_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      }).success,
      false
    )
    assert.equal(
      schema.safeParse({ ...values, hub_channel_ids: [3, 1] }).success,
      true
    )
  })

  test('requires legacy policy reselection instead of converting model multipliers to channels', () => {
    const key = apiKeySchema.parse({
      id: 1,
      name: 'old',
      key: '',
      status: 1,
      remain_quota: 0,
      used_quota: 0,
      unlimited_quota: true,
      expired_time: -1,
      created_time: 1,
      accessed_time: 1,
      model_limits_enabled: false,
      hub_routing_policy: {
        mode: 'provider',
        provider_id: 7,
        selections: [{ model: 'gpt-5', multipliers: [0.3] }],
      },
    })
    assert.deepEqual(transformApiKeyToFormDefaults(key).hub_channel_ids, [])
    key.hub_routing_policy = {
      mode: 'channels',
      provider_id: 7,
      channel_ids: [20, 10],
    }
    assert.deepEqual(
      transformApiKeyToFormDefaults(key).hub_channel_ids,
      [20, 10]
    )
  })
})
