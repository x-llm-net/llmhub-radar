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

import type { HubTokenRoutingOptions } from '../../types'
import {
  getApiKeyFormDefaultValues,
  transformFormDataToPayload,
} from '../api-key-form'

const baseOptions: HubTokenRoutingOptions = {
  mode: 'public_pool',
  families: [],
  tier_ceilings: {},
}

describe('API key multiplier routing policy mapping', () => {
  test('maps root-domain family ranges without keeping legacy group routing', () => {
    const values = {
      ...getApiKeyFormDefaultValues(true),
      group: 'auto',
      auto_groups: ['vip'],
      cross_group_retry: true,
      hub_selections: [
        {
          family: 'openai',
          min_multiplier: 0.01,
          max_multiplier: 0.05,
        },
        {
          family: 'anthropic',
          min_multiplier: 0.2,
          max_multiplier: 0.4,
        },
      ],
    }

    const payload = transformFormDataToPayload(values, baseOptions)

    assert.equal(payload.group, 'default')
    assert.equal(payload.cross_group_retry, false)
    assert.deepEqual(payload.hub_routing_policy, {
      mode: 'public_pool',
      selections: [
        {
          family: 'openai',
          min_multiplier: 0.01,
          max_multiplier: 0.05,
        },
        {
          family: 'anthropic',
          min_multiplier: 0.2,
          max_multiplier: 0.4,
        },
      ],
    })
  })

  test('maps provider-domain choices to the provider and exact multiplier', () => {
    const values = {
      ...getApiKeyFormDefaultValues(false),
      hub_selections: [
        {
          family: 'google',
          min_multiplier: 0.3,
          max_multiplier: 0.3,
          exact_multiplier: 0.3,
        },
      ],
    }
    const options: HubTokenRoutingOptions = {
      ...baseOptions,
      mode: 'provider',
      provider_id: 7,
    }

    const payload = transformFormDataToPayload(values, options)

    assert.deepEqual(payload.hub_routing_policy, {
      mode: 'provider',
      provider_id: 7,
      selections: [
        {
          family: 'google',
          exact_multipliers: [0.3],
        },
      ],
    })
  })
})
