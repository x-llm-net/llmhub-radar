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
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PublicHomeFamily } from '../types'
import { getFamilyMeta, modelAnchor } from './public-home-family-meta'

export function PublicHomeFamilyNav(props: { families: PublicHomeFamily[] }) {
  const { t } = useTranslation()
  const models = useMemo(
    () =>
      props.families.flatMap((family) =>
        family.models.map((model) => ({ familyKey: family.key, model }))
      ),
    [props.families]
  )
  const modelIds = useMemo(
    () =>
      models.map(({ familyKey, model }) =>
        modelAnchor(familyKey, model.model_name)
      ),
    [models]
  )
  const shellRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>())
  const frameRef = useRef(0)
  const [activeId, setActiveId] = useState(modelIds[0] || '')

  const revealTab = useCallback((id: string, behavior: ScrollBehavior) => {
    const rail = railRef.current
    const link = linkRefs.current.get(id)
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

  const scrollRail = useCallback((direction: -1 | 1) => {
    const rail = railRef.current
    if (!rail) return

    rail.scrollBy({
      left: direction * Math.max(240, rail.clientWidth * 0.65),
      behavior: 'smooth',
    })
  }, [])

  const syncActiveTab = useCallback(() => {
    if (modelIds.length === 0) return

    const shell = shellRef.current
    const stickyTop = shell
      ? Number.parseFloat(getComputedStyle(shell).top) || 0
      : 0
    const activationLine = stickyTop + (shell?.offsetHeight || 0) + 8
    let nextId = modelIds[0]

    for (const id of modelIds) {
      const section = document.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
      if (section && section.getBoundingClientRect().top <= activationLine) {
        nextId = id
      }
    }

    setActiveId((currentId) => {
      if (currentId === nextId) return currentId
      window.requestAnimationFrame(() => revealTab(nextId, 'smooth'))
      return nextId
    })
  }, [modelIds, revealTab])

  const scheduleSync = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0
      syncActiveTab()
    })
  }, [syncActiveTab])

  useEffect(() => {
    const firstId = modelIds[0] || ''
    if (firstId) revealTab(firstId, 'auto')
    scheduleSync()

    window.addEventListener('scroll', scheduleSync, { passive: true })
    window.addEventListener('resize', scheduleSync)
    return () => {
      window.removeEventListener('scroll', scheduleSync)
      window.removeEventListener('resize', scheduleSync)
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
    }
  }, [modelIds, revealTab, scheduleSync])

  return (
    <>
      <section
        className='hub-family-section'
        aria-labelledby='model-families-title'
      >
        <div className='hub-shell'>
          <p className='hub-section-kicker'>{t('MODEL FAMILIES')}</p>
          <h2 id='model-families-title'>{t('Browse by model family')}</h2>
          <p className='hub-section-lede'>
            {t(
              'Choose a model first, then compare the providers that actually serve it.'
            )}
          </p>

          <div className='hub-family-grid'>
            {props.families.map((family) => {
              const meta = getFamilyMeta(family.key)
              const firstModel = family.models[0]
              const firstModelId = firstModel
                ? modelAnchor(family.key, firstModel.model_name)
                : ''
              return (
                <a
                  key={family.key}
                  className='hub-family-card'
                  href={`#family-${family.key}`}
                  onClick={() => {
                    if (!firstModelId) return
                    setActiveId(firstModelId)
                    window.requestAnimationFrame(() =>
                      revealTab(firstModelId, 'smooth')
                    )
                  }}
                >
                  <div className='hub-family-card-meta'>
                    <span>{meta.vendor}</span>
                    <span>
                      {t('{{count}} models', { count: family.models.length })}
                    </span>
                  </div>
                  <h3>{t(meta.title)}</h3>
                  <p>{t(meta.description)}</p>
                  <strong>
                    {t('View provider rankings')}
                    <ArrowRight aria-hidden='true' />
                  </strong>
                </a>
              )
            })}
          </div>
        </div>
      </section>

      <div ref={shellRef} className='hub-model-chips-shell'>
        <div className='hub-shell'>
          <div className='hub-model-chips-row'>
            <nav
              ref={railRef}
              className='hub-model-chips'
              aria-label={t('Published models')}
            >
              {models.map(({ familyKey, model }) => {
                const id = modelAnchor(familyKey, model.model_name)
                const active = id === activeId
                return (
                  <a
                    key={`${familyKey}-${model.model_name}`}
                    ref={(node) => {
                      if (node) linkRefs.current.set(id, node)
                      else linkRefs.current.delete(id)
                    }}
                    className={active ? 'is-active' : undefined}
                    href={`#${id}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      setActiveId(id)
                      window.requestAnimationFrame(() =>
                        revealTab(id, 'smooth')
                      )
                    }}
                  >
                    {model.model_name}
                  </a>
                )
              })}
            </nav>

            <div className='hub-model-chips-controls'>
              <button
                type='button'
                aria-label={t('Previous models')}
                title={t('Previous models')}
                onClick={() => scrollRail(-1)}
              >
                <ChevronLeft aria-hidden='true' />
              </button>
              <button
                type='button'
                aria-label={t('Next models')}
                title={t('Next models')}
                onClick={() => scrollRail(1)}
              >
                <ChevronRight aria-hidden='true' />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
