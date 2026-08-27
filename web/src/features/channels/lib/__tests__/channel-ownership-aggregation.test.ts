/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { Channel } from '../../types'
import { aggregateChannelsByTag, type TagRow } from '../channel-utils'

function channel(overrides: Partial<Channel>): Channel {
  return {
    id: 1,
    type: 1,
    key: '',
    status: 1,
    name: 'channel',
    created_time: 0,
    test_time: 0,
    response_time: 0,
    other: '',
    balance: 0,
    balance_updated_time: 0,
    models: '',
    group: 'default',
    used_quota: 0,
    other_info: '',
    remark: '',
    max_input_tokens: 0,
    channel_info: {
      is_multi_key: false,
      multi_key_size: 0,
      multi_key_polling_index: 0,
      multi_key_mode: 'random',
    },
    settings: '{}',
    ownership: 'provider',
    hub_service_tiers: [],
    tag: 'shared-tag',
    ...overrides,
  }
}

describe('aggregateChannelsByTag ownership', () => {
  test('preserves a shared reseller while marking providers as mixed', () => {
    const rows = aggregateChannelsByTag([
      channel({
        id: 1,
        hub_provider_id: 11,
        hub_provider_name: 'Provider A',
        hub_tenant_id: 101,
        hub_tenant_name: 'Tenant A',
      }),
      channel({
        id: 2,
        hub_provider_id: 12,
        hub_provider_name: 'Provider B',
        hub_tenant_id: 101,
        hub_tenant_name: 'Tenant A',
      }),
    ])

    const row = rows[0] as TagRow
    assert.equal(row.ownership, 'mixed')
    assert.equal(row.hub_tenant_mixed, false)
    assert.equal(row.hub_tenant_id, 101)
    assert.equal(row.hub_tenant_name, 'Tenant A')
  })

  test('marks the reseller as mixed across tenants', () => {
    const rows = aggregateChannelsByTag([
      channel({ id: 1, hub_provider_id: 11, hub_tenant_id: 101 }),
      channel({ id: 2, hub_provider_id: 12, hub_tenant_id: 102 }),
    ])

    const row = rows[0] as TagRow
    assert.equal(row.hub_tenant_mixed, true)
    assert.equal(row.hub_tenant_id, undefined)
    assert.equal(row.hub_tenant_name, undefined)
  })
})
