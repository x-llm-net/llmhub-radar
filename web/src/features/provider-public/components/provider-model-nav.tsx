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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getFamilyMeta } from '@/features/home/components/public-home-family-meta'

import { getProviderFamilyId } from '../model-family'
import type { ProviderPublicFamily } from '../types'
import { getProviderModelId } from '../utils'
import { ProviderModelIcon } from './provider-model-icon'

export function ProviderModelNav(props: { families: ProviderPublicFamily[] }) {
  const { t } = useTranslation()
  const familyRailRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const familyLinkRefs = useRef(new Map<string, HTMLAnchorElement>())
  const frameRef = useRef(0)
  const [activeFamilyKey, setActiveFamilyKey] = useState(
    () => props.families[0]?.key || ''
  )

  const revealFamily = useCallback((id: string, behavior: ScrollBehavior) => {
    const rail = familyRailRef.current
    const link = familyLinkRefs.current.get(id)
    if (!rail || !link) return

    const railRect = rail.getBoundingClientRect()
    const linkRect = link.getBoundingClientRect()
    const targetLeft =
      rail.scrollLeft +
      linkRect.left -
      railRect.left -
      (rail.clientWidth - linkRect.width) / 2
    const maxLeft = Math.max(0, rail.scrollWidth - rail.clientWidth)

    rail.scrollTo({
      left: Math.min(Math.max(0, targetLeft), maxLeft),
      behavior,
    })
  }, [])

  const syncActiveProvider = useCallback(() => {
    if (props.families.length === 0) return

    const nav = navRef.current
    const activationLine = (nav?.getBoundingClientRect().bottom || 0) + 16
    let nextFamilyKey = props.families[0]?.key || ''
    for (const family of props.families) {
      const section = document.querySelector<HTMLElement>(
        `#${getProviderFamilyId(family.key)}`
      )
      if (section && section.getBoundingClientRect().top <= activationLine) {
        nextFamilyKey = family.key
      }
    }

    setActiveFamilyKey((current) =>
      current === nextFamilyKey ? current : nextFamilyKey
    )
  }, [props.families])

  const scheduleSync = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0
      syncActiveProvider()
    })
  }, [syncActiveProvider])

  useEffect(() => {
    const hashId = window.location.hash.slice(1)
    const hashFamily = props.families.find(
      (family) => getProviderFamilyId(family.key) === hashId
    )
    const hashModelFamily = props.families.find((family) =>
      family.models.some(
        (model) => getProviderModelId(model.model_name) === hashId
      )
    )
    let hashTarget = ''
    if (hashFamily) {
      hashTarget = getProviderFamilyId(hashFamily.key)
    } else if (hashModelFamily) {
      hashTarget = hashId
    }
    setActiveFamilyKey(
      hashFamily?.key || hashModelFamily?.key || props.families[0]?.key || ''
    )
    const hashFrame = window.requestAnimationFrame(() => {
      if (!hashTarget) return
      document.querySelector<HTMLElement>(`#${hashTarget}`)?.scrollIntoView({
        behavior: 'auto',
        block: 'start',
      })
      syncActiveProvider()
    })

    if (!hashTarget) scheduleSync()

    window.addEventListener('scroll', scheduleSync, { passive: true })
    window.addEventListener('resize', scheduleSync)
    return () => {
      window.removeEventListener('scroll', scheduleSync)
      window.removeEventListener('resize', scheduleSync)
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      window.cancelAnimationFrame(hashFrame)
    }
  }, [props.families, scheduleSync, syncActiveProvider])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (activeFamilyKey) {
        revealFamily(getProviderFamilyId(activeFamilyKey), 'smooth')
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeFamilyKey, revealFamily])

  return (
    <nav
      ref={navRef}
      className='hub-provider-model-nav'
      aria-label={t('Model providers')}
    >
      <div className='hub-provider-shell hub-provider-model-nav-inner'>
        <div className='hub-provider-model-nav-row'>
          <span className='hub-provider-model-nav-label'>{t('Provider')}</span>
          <div ref={familyRailRef} className='hub-provider-model-nav-links'>
            {props.families.map((family) => {
              const meta = getFamilyMeta(family.key)
              const id = getProviderFamilyId(family.key)
              const active = family.key === activeFamilyKey
              return (
                <a
                  key={family.key}
                  ref={(node) => {
                    if (node) familyLinkRefs.current.set(id, node)
                    else familyLinkRefs.current.delete(id)
                  }}
                  className={active ? 'is-active' : undefined}
                  href={`#${id}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={(event) => {
                    event.preventDefault()
                    setActiveFamilyKey(family.key)
                    window.history.pushState(null, '', `#${id}`)
                    document
                      .querySelector<HTMLElement>(`#${id}`)
                      ?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      })
                    scheduleSync()
                  }}
                >
                  <ProviderModelIcon
                    modelName={family.models[0]?.model_name || family.key}
                  />
                  <span>{meta.vendor}</span>
                </a>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )
}
