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

import {
  getHubRoutingBillingDetails,
  getLogFirstTokenMs,
  getServiceTierBillingRatio,
} from '../format'

describe('service tier usage log formatting', () => {
  test('uses the final billing ratio instead of the legacy group ratio', () => {
    const ratio = getServiceTierBillingRatio('medium', {
      group_ratio: 1,
      billing_ratio: 0.4,
    })

    assert.equal(ratio, 0.4)
  })

  test('uses the new-api first response time for the first-token display', () => {
    const firstTokenMs = getLogFirstTokenMs({
      frt: 3000,
      ttft: 65000,
    })

    assert.equal(firstTokenMs, 3000)
  })

  test('falls back to text token time for legacy logs without frt', () => {
    const firstTokenMs = getLogFirstTokenMs({
      ttft: 65000,
    })

    assert.equal(firstTokenMs, 65000)
  })

  test('exposes safe final routing and billing details for multiplier keys', () => {
    const details = getHubRoutingBillingDetails({
      routing_policy_mode: 'provider',
      routing_phase: 'platform_fallback',
      supply_multiplier: 5.5,
      billing_ratio: 5.5,
    })

    assert.deepEqual(details, {
      supplyMultiplier: 5.5,
      billingRatio: 5.5,
      routingPhase: 'platform_fallback',
    })
  })
})
