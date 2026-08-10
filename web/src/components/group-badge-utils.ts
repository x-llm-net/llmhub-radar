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

const SERVICE_TIER_LABEL_KEYS: Record<string, string> = {
  special: 'Special price',
  low: 'Economy',
  medium: 'Standard',
  high: 'High quality',
}

export function isServiceTierGroup(group?: string | null): boolean {
  return Boolean(group?.trim() && SERVICE_TIER_LABEL_KEYS[group.trim()])
}

export function areServiceTierGroups(groups: readonly string[]): boolean {
  return Object.keys(SERVICE_TIER_LABEL_KEYS).every((tier) =>
    groups.includes(tier)
  )
}

export function getLocalizedGroupLabel(
  groupName: string | undefined,
  t: (key: string) => string
): string {
  if (!groupName) return ''
  return t(SERVICE_TIER_LABEL_KEYS[groupName] ?? groupName)
}
