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
import { Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getLobeIcon } from '@/lib/lobe-icon'

type ProviderIconMatch = {
  iconKey: string
  name: string
}

const PROVIDER_ICON_RULES: Array<{
  pattern: RegExp
  match: ProviderIconMatch
}> = [
  {
    pattern: /^(claude|anthropic)/i,
    match: { iconKey: 'Claude', name: 'Anthropic' },
  },
  {
    pattern: /^(gpt|o[1-4](?:-|$)|chatgpt|codex|dall-e|whisper|tts)/i,
    match: { iconKey: 'OpenAI', name: 'OpenAI' },
  },
  {
    pattern: /^(gemini|imagen|veo|nano-banana|banana)/i,
    match: { iconKey: 'Gemini', name: 'Google' },
  },
  {
    pattern: /^deepseek/i,
    match: { iconKey: 'DeepSeek', name: 'DeepSeek' },
  },
  {
    pattern: /^(qwen|qwq|wan|tongyi)/i,
    match: { iconKey: 'Qwen', name: 'Alibaba Cloud' },
  },
  {
    pattern: /^(doubao|seed)/i,
    match: { iconKey: 'Doubao', name: 'ByteDance' },
  },
  {
    pattern: /^(glm|chatglm|cogview|cogvideo)/i,
    match: { iconKey: 'Zhipu', name: 'Zhipu AI' },
  },
  { pattern: /^grok/i, match: { iconKey: 'XAI', name: 'xAI' } },
  { pattern: /^(llama|meta)/i, match: { iconKey: 'Meta', name: 'Meta' } },
  {
    pattern: /^(mistral|mixtral)/i,
    match: { iconKey: 'Mistral', name: 'Mistral' },
  },
  {
    pattern: /^(kimi|moonshot)/i,
    match: { iconKey: 'Kimi', name: 'Moonshot AI' },
  },
  { pattern: /^minimax/i, match: { iconKey: 'Minimax', name: 'MiniMax' } },
  {
    pattern: /^(cohere|command)/i,
    match: { iconKey: 'Cohere', name: 'Cohere' },
  },
  {
    pattern: /^(hunyuan|混元)/i,
    match: { iconKey: 'Hunyuan', name: 'Tencent' },
  },
  {
    pattern: /^(baichuan|百川)/i,
    match: { iconKey: 'Baichuan', name: 'Baichuan' },
  },
  { pattern: /^yi-/i, match: { iconKey: 'Yi', name: '01.AI' } },
]

function getProviderIconMatch(modelName: string): ProviderIconMatch | null {
  const normalizedName = modelName.trim()
  return (
    PROVIDER_ICON_RULES.find((rule) => rule.pattern.test(normalizedName))
      ?.match || null
  )
}

export function ProviderModelIcon(props: { modelName: string }) {
  const { t } = useTranslation()
  const match = getProviderIconMatch(props.modelName)

  if (!match) {
    return (
      <span
        className='hub-provider-model-icon is-fallback'
        title={t('Unknown provider')}
        aria-label={t('Unknown provider')}
      >
        <Server aria-hidden='true' />
      </span>
    )
  }

  return (
    <span
      className='hub-provider-model-icon'
      title={match.name}
      aria-label={match.name}
    >
      {getLobeIcon(`${match.iconKey}.Color`, 22)}
    </span>
  )
}
