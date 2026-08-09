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
import type { ProviderPublicFamily, ProviderPublicModel } from './types'

const familyOrder = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'alibaba',
  'bytedance',
  'zhipu',
  'other',
]

export function getProviderFamilyId(familyKey: string) {
  return `provider-family-${familyKey}`
}

export function groupProviderModels(
  models: ProviderPublicModel[]
): ProviderPublicFamily[] {
  const groups = new Map<string, ProviderPublicModel[]>()
  for (const model of models) {
    const key = familyOrder.includes(model.family_key)
      ? model.family_key
      : 'other'
    const familyModels = groups.get(key) || []
    familyModels.push(model)
    groups.set(key, familyModels)
  }

  return familyOrder
    .filter((key) => groups.has(key))
    .map((key) => ({ key, models: groups.get(key) || [] }))
}
