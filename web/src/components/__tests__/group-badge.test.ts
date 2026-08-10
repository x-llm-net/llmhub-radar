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
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  areServiceTierGroups,
  getLocalizedGroupLabel,
  isServiceTierGroup,
} from '../group-badge-utils'

const translate = (key: string) =>
  ({
    'Special price': 'Special price (translated)',
    Economy: 'Economy (translated)',
    Standard: 'Standard (translated)',
    'High quality': 'High quality (translated)',
  })[key] ?? key

describe('service tier group labels', () => {
  test('localizes all service tier group values', () => {
    assert.deepEqual(
      ['special', 'low', 'medium', 'high'].map((group) =>
        getLocalizedGroupLabel(group, translate)
      ),
      [
        'Special price (translated)',
        'Economy (translated)',
        'Standard (translated)',
        'High quality (translated)',
      ]
    )
  })

  test('keeps ordinary New API groups unchanged', () => {
    assert.equal(getLocalizedGroupLabel('default', translate), 'default')
    assert.equal(isServiceTierGroup('default'), false)
    assert.equal(isServiceTierGroup('special'), true)
  })

  test('distinguishes the service tier namespace from mixed groups', () => {
    assert.equal(
      areServiceTierGroups(['special', 'low', 'medium', 'high']),
      true
    )
    assert.equal(
      areServiceTierGroups(['auto', 'special', 'low', 'medium', 'high']),
      true
    )
    assert.equal(
      areServiceTierGroups([
        'default',
        'vip',
        'special',
        'low',
        'medium',
        'high',
      ]),
      true
    )
    assert.equal(areServiceTierGroups(['special', 'default']), false)
    assert.equal(areServiceTierGroups([]), false)
  })
})
