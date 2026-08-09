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
type FamilyMeta = {
  vendor: string
  title: string
  description: string
}

const familyMetadata: Record<string, FamilyMeta> = {
  anthropic: {
    vendor: 'Anthropic',
    title: 'Claude models',
    description:
      'Compare availability, latency, and recent status across Claude routes.',
  },
  openai: {
    vendor: 'OpenAI',
    title: 'OpenAI models',
    description:
      'Compare availability, latency, and recent status across GPT and Codex routes.',
  },
  google: {
    vendor: 'Google',
    title: 'Gemini models',
    description:
      'Compare availability, latency, and recent status across Gemini and image routes.',
  },
  xai: {
    vendor: 'xAI',
    title: 'Grok models',
    description:
      'Compare availability, latency, and recent status across Grok routes.',
  },
  deepseek: {
    vendor: 'DeepSeek',
    title: 'DeepSeek models',
    description: 'Compare real probe performance across DeepSeek routes.',
  },
  alibaba: {
    vendor: 'Alibaba Cloud',
    title: 'Qwen models',
    description: 'Compare real probe performance across Qwen and Wan routes.',
  },
  bytedance: {
    vendor: 'ByteDance',
    title: 'Doubao models',
    description:
      'Compare real probe performance across Doubao and Seed routes.',
  },
  zhipu: {
    vendor: 'Zhipu AI',
    title: 'GLM models',
    description: 'Compare real probe performance across GLM routes.',
  },
  other: {
    vendor: 'More providers',
    title: 'Other models',
    description:
      'Explore published models from additional upstream ecosystems.',
  },
}

export function getFamilyMeta(familyKey: string): FamilyMeta {
  return familyMetadata[familyKey] || familyMetadata.other
}

export function modelAnchor(familyKey: string, modelName: string) {
  const modelSlug = modelName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
  return `model-${familyKey}-${modelSlug || 'unknown'}`
}
