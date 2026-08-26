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
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Globe2,
  KeyRound,
  Layers3,
  LayoutGrid,
  List,
  MessageCircle,
  Network,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { RichContent } from '@/components/rich-content'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { getFamilyMeta } from '@/features/home/components/public-home-family-meta'
import { getProviderPublicURL } from '@/lib/provider-domain'

import { getPublicProvider } from './api'
import { ProviderModelCard } from './components/provider-model-card'
import { ProviderModelNav } from './components/provider-model-nav'
import { ProviderModelRow } from './components/provider-model-row'
import { groupProviderModels, getProviderFamilyId } from './model-family'
import type { ProviderPublicProfile } from './types'

import './provider-public.css'

const providerPublicHeaderProps = {
  authButtonClassName: 'hub-provider-public-auth-button',
}

function ProviderPublicSkeleton() {
  return (
    <PublicLayout
      showMainContainer={false}
      headerProps={providerPublicHeaderProps}
    >
      <div className='mx-auto max-w-6xl px-4 pt-20 pb-16 md:px-6'>
        <Skeleton className='h-56 w-full rounded-2xl' />
        <div className='mt-8 grid gap-4 sm:grid-cols-4'>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className='h-20 rounded-xl' />
          ))}
        </div>
        <Skeleton className='mt-12 h-8 w-44' />
        <div className='mt-5 space-y-5'>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className='h-28 w-full' />
          ))}
        </div>
      </div>
    </PublicLayout>
  )
}

function formatPercent(value: number, sampleCount: number): string {
  return sampleCount > 0 ? `${value.toFixed(1)}%` : '--'
}

function formatProbeTime(
  timestamp: number,
  language: string,
  pendingLabel: string
) {
  if (timestamp <= 0) return pendingLabel
  let locale = language
  if (language === 'zhCN') locale = 'zh-CN'
  if (language === 'zhTW') locale = 'zh-TW'
  return new Date(timestamp * 1000).toLocaleString(locale)
}

function publicSupportLabel(type: string): string {
  switch (type) {
    case 'community':
      return 'Join community'
    case 'customer_service':
      return 'Contact support'
    case 'announcement':
      return 'View announcements'
    case 'email':
      return 'Contact by email'
    default:
      return 'User support'
  }
}

function publicSupportHref(type: string, value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value
  if (type === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return `mailto:${value}`
  }
  return null
}

function ProviderStats(props: { profile: ProviderPublicProfile }) {
  const { i18n, t } = useTranslation()
  const stats = props.profile.stats
  const items = [
    {
      label: t('Published models'),
      value: stats.published_model_count,
      icon: Layers3,
    },
    {
      label: t('Online models'),
      value: stats.online_model_count,
      icon: ShieldCheck,
    },
    {
      label: t('Supply channels'),
      value: stats.channel_count,
      icon: Zap,
    },
    {
      label: t('7-day stability'),
      value: formatPercent(stats.stability_7d, stats.sample_count),
      icon: ShieldCheck,
    },
    {
      label: t('Latest probe'),
      value: formatProbeTime(
        stats.last_probe_at,
        i18n.language,
        t('Awaiting first probe')
      ),
      icon: Clock3,
    },
  ]

  return (
    <dl className='hub-provider-stats'>
      {items.map((item) => (
        <div className='hub-provider-stat' key={item.label}>
          <dt>
            <item.icon aria-hidden='true' />
            {item.label}
          </dt>
          <dd title={String(item.value)}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ProviderPublicPage(props: { providerSlug?: string }) {
  const { t } = useTranslation()
  const [modelView, setModelView] = useState<'cards' | 'list'>('cards')
  const params = useParams({ strict: false }) as { providerSlug?: string }
  const providerSlug = props.providerSlug || params.providerSlug || ''
  const query = useQuery({
    queryKey: ['public-provider', providerSlug],
    queryFn: () => getPublicProvider(providerSlug),
    enabled: providerSlug !== '',
    retry: false,
    staleTime: 60 * 1000,
  })
  const modelFamilies = useMemo(
    () => groupProviderModels(query.data?.data?.models || []),
    [query.data?.data?.models]
  )

  useEffect(() => {
    const provider = query.data?.data?.provider
    if (!provider) return

    document.title = `${provider.name} | LLMHub`
    let description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    )
    if (!description) {
      description = document.createElement('meta')
      description.name = 'description'
      document.head.appendChild(description)
    }
    description.content = `${provider.name} 在 LLMHub 的模型稳定性、延迟与供给状态。`

    let canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]'
    )
    const hadCanonical = !!canonical
    const previousCanonicalHref = canonical
      ? canonical.getAttribute('href')
      : null
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = getProviderPublicURL(provider.slug)
    return () => {
      if (!hadCanonical) {
        canonical.remove()
      } else if (previousCanonicalHref === null) {
        canonical.removeAttribute('href')
      } else {
        canonical.href = previousCanonicalHref
      }
    }
  }, [query.data])

  if (query.isLoading) return <ProviderPublicSkeleton />

  if (query.isError || !query.data?.data) {
    return (
      <PublicLayout headerProps={providerPublicHeaderProps}>
        <div className='mx-auto max-w-2xl py-16'>
          <ErrorState
            title={t('Provider homepage unavailable')}
            onRetry={() => void query.refetch()}
          />
        </div>
      </PublicLayout>
    )
  }

  const profile = query.data.data
  const provider = profile.provider
  const supportHref = publicSupportHref(
    provider.support_type,
    provider.support_value
  )
  const initials = provider.name.slice(0, 2).toUpperCase()
  const hasOnlineModels = profile.stats.online_model_count > 0
  const hasProbeData = profile.stats.sample_count > 0
  let providerState = { label: t('Awaiting data'), className: 'is-pending' }
  if (hasProbeData) {
    providerState = {
      label: t('Currently failing'),
      className: 'is-degraded',
    }
  }
  if (hasOnlineModels) {
    providerState = { label: t('Online'), className: '' }
  }

  return (
    <PublicLayout
      showMainContainer={false}
      headerProps={providerPublicHeaderProps}
    >
      <main className='llmhub-provider-page'>
        <section className='hub-provider-hero'>
          <div className='hub-provider-shell hub-provider-hero-inner'>
            <div className='hub-provider-identity'>
              <div className='hub-provider-logo'>
                <Avatar className='size-full rounded-[inherit]'>
                  <AvatarImage src={provider.logo_url || undefined} alt='' />
                  <AvatarFallback className='rounded-[inherit] bg-transparent text-inherit'>
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className='hub-provider-identity-copy'>
                <p className='hub-provider-kicker'>
                  {t('Channel provider')} · LLM-Hub
                </p>
                <h1>{provider.name}</h1>
                {provider.description && (
                  <RichContent
                    content={provider.description}
                    breaks
                    className='hub-provider-description'
                  />
                )}
                <div className='hub-provider-links'>
                  {provider.website && (
                    <a href={provider.website} target='_blank' rel='noreferrer'>
                      <Globe2 aria-hidden='true' />
                      {t('Visit website')}
                      <ArrowUpRight aria-hidden='true' />
                    </a>
                  )}
                  {provider.support_value && supportHref && (
                    <a href={supportHref} target='_blank' rel='noreferrer'>
                      <MessageCircle aria-hidden='true' />
                      {t(publicSupportLabel(provider.support_type))}
                      <ArrowUpRight aria-hidden='true' />
                    </a>
                  )}
                  {provider.support_value && !supportHref && (
                    <span title={provider.support_value}>
                      <MessageCircle aria-hidden='true' />
                      {t(publicSupportLabel(provider.support_type))}:{' '}
                      {provider.support_value}
                    </span>
                  )}
                  <a href='#provider-models'>
                    <Network aria-hidden='true' />
                    {t('View model rankings')}
                  </a>
                </div>
                <div className='hub-provider-hero-actions'>
                  <Link to='/keys'>
                    <KeyRound aria-hidden='true' />
                    {t('Create API key')}
                  </Link>
                  <Link to='/pricing'>
                    <Sparkles aria-hidden='true' />
                    {t('View platform pricing')}
                  </Link>
                </div>
              </div>
            </div>

            <aside
              className='hub-provider-snapshot'
              aria-label={t('Provider snapshot')}
            >
              <p className='hub-provider-snapshot-label'>
                {t('Current service status')}
              </p>
              <div
                className={`hub-provider-snapshot-state ${providerState.className}`}
              >
                <i aria-hidden='true' />
                {providerState.label}
              </div>
              <div className='hub-provider-snapshot-metric'>
                <strong>
                  {formatPercent(
                    profile.stats.stability_7d,
                    profile.stats.sample_count
                  )}
                </strong>
                <span>{t('7-day stability')}</span>
              </div>
              <p className='hub-provider-snapshot-note'>
                <CheckCircle2 aria-hidden='true' />
                {t('Based on real LLM-Hub probes')}
              </p>
            </aside>
          </div>
        </section>

        <section
          className='hub-provider-shell'
          aria-label={t('Provider overview')}
        >
          <ProviderStats profile={profile} />
        </section>

        <section className='hub-provider-usage'>
          <div className='hub-provider-shell'>
            <div className='hub-provider-usage-heading'>
              <div>
                <p className='hub-provider-section-kicker'>{t('HOW TO USE')}</p>
                <h2>{t('Use published models through LLM-Hub')}</h2>
                <p className='hub-provider-usage-lede'>
                  {t(
                    'Create a platform API key to use the published models. LLM-Hub routes requests using current supply and probe results.'
                  )}
                </p>
              </div>
            </div>
            <div className='hub-provider-usage-grid'>
              <article className='hub-provider-usage-step'>
                <div className='hub-provider-usage-step-top'>
                  <span>01</span>
                  <KeyRound aria-hidden='true' />
                </div>
                <h3>{t('Create a platform API key')}</h3>
                <p>
                  {t(
                    'Use one key for the models and services available on LLM-Hub.'
                  )}
                </p>
              </article>
              <article className='hub-provider-usage-step'>
                <div className='hub-provider-usage-step-top'>
                  <span>02</span>
                  <Layers3 aria-hidden='true' />
                </div>
                <h3>{t('Choose a published model')}</h3>
                <p>
                  {t(
                    'Compare price, availability, and first-token latency before you integrate.'
                  )}
                </p>
              </article>
              <article className='hub-provider-usage-step'>
                <div className='hub-provider-usage-step-top'>
                  <span>03</span>
                  <Network aria-hidden='true' />
                </div>
                <h3>{t('Let the platform route requests')}</h3>
                <p>
                  {t(
                    'The platform uses current channel status and retry rules to keep requests available.'
                  )}
                </p>
              </article>
            </div>
          </div>
        </section>

        {modelFamilies.length > 0 && (
          <ProviderModelNav families={modelFamilies} />
        )}

        <section
          id='provider-models'
          className='hub-provider-models'
          aria-labelledby='provider-models-title'
        >
          <div className='hub-provider-shell'>
            <div className='hub-provider-models-heading'>
              <div>
                <p className='hub-provider-section-kicker'>
                  {t('MODEL PERFORMANCE')}
                </p>
                <h2 id='provider-models-title'>
                  {t('Published model performance')}
                </h2>
                <p className='hub-provider-models-lede'>
                  {t(
                    'Each model is shown independently with seven-day stability, first-token latency, supply coverage, and price multiplier.'
                  )}
                </p>
              </div>
              <div className='hub-provider-models-toolbar'>
                <p className='hub-provider-update'>
                  <i aria-hidden='true' />
                  {t('Updated from the latest probes')}
                </p>
                <div
                  className='hub-provider-view-switcher'
                  role='group'
                  aria-label={t('View mode')}
                >
                  <button
                    type='button'
                    className={modelView === 'cards' ? 'is-active' : undefined}
                    aria-pressed={modelView === 'cards'}
                    onClick={() => setModelView('cards')}
                  >
                    <LayoutGrid aria-hidden='true' />
                    {t('Card view')}
                  </button>
                  <button
                    type='button'
                    className={modelView === 'list' ? 'is-active' : undefined}
                    aria-pressed={modelView === 'list'}
                    onClick={() => setModelView('list')}
                  >
                    <List aria-hidden='true' />
                    {t('List view')}
                  </button>
                </div>
              </div>
            </div>

            {modelFamilies.length === 0 ? (
              <div className='hub-provider-empty'>
                <p>{t('No published models yet')}</p>
                <p>
                  {t('This provider has not published an available model.')}
                </p>
              </div>
            ) : (
              <div className='hub-provider-model-families'>
                {modelFamilies.map((family) => {
                  const meta = getFamilyMeta(family.key)
                  return (
                    <section
                      key={family.key}
                      id={getProviderFamilyId(family.key)}
                      className='hub-provider-model-family'
                    >
                      <header className='hub-provider-model-family-heading'>
                        <div>
                          <p className='hub-provider-section-kicker'>
                            {meta.vendor}
                          </p>
                          <h3>{t(meta.title)}</h3>
                        </div>
                        <span>
                          {t('{{count}} published models', {
                            count: family.models.length,
                          })}
                        </span>
                      </header>
                      <div
                        className={
                          modelView === 'cards'
                            ? 'hub-provider-model-card-grid'
                            : 'hub-provider-model-list'
                        }
                      >
                        {family.models.map((model) =>
                          modelView === 'cards' ? (
                            <ProviderModelCard
                              key={model.model_name}
                              model={model}
                            />
                          ) : (
                            <ProviderModelRow
                              key={model.model_name}
                              model={model}
                            />
                          )
                        )}
                      </div>
                    </section>
                  )
                })}
              </div>
            )}

            <div className='hub-provider-disclaimer'>
              <ShieldCheck aria-hidden='true' />
              <p>
                {t(
                  'Stability data is based on LLM-Hub probes, not a guarantee of future availability.'
                )}
              </p>
            </div>
          </div>
        </section>
      </main>
    </PublicLayout>
  )
}
