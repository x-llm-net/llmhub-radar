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
import { ArrowUpRight, Menu, Moon, Store, Sun, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useTheme } from '@/context/theme-provider'
import { useSystemConfig } from '@/hooks/use-system-config'

const navigation = [
  { label: 'Homepage', href: '#top' },
  { label: 'Model rankings', href: '#model-rankings' },
  { label: 'Ranking rules', href: '#ranking-rules' },
  { label: 'Become a channel provider', href: '#provider-onboarding' },
]

export function PublicHomeHeader() {
  const { t } = useTranslation()
  const { resolvedTheme, setTheme } = useTheme()
  const { systemName, tenantBrand } = useSystemConfig()
  const [mobileOpen, setMobileOpen] = useState(false)
  const brandName = systemName || 'LLMHub'
  const brandLogo = tenantBrand?.logo_url?.trim()

  return (
    <header className='hub-header'>
      <div className='hub-shell hub-header-inner'>
        <a className='hub-brand' href='#top' aria-label={brandName}>
          {brandLogo ? (
            <img
              className='hub-brand-mark object-contain'
              src={brandLogo}
              alt=''
            />
          ) : (
            <span className='hub-brand-mark' aria-hidden='true'>
              <i />
              <i />
              <i />
            </span>
          )}
          <span className='hub-brand-copy'>
            <strong>{brandName}</strong>
            <small>{t('Relay field-test rankings')}</small>
          </span>
        </a>

        <nav className='hub-desktop-nav' aria-label={t('Primary navigation')}>
          {navigation.map((item, index) => {
            let className: string | undefined
            if (item.href === '#provider-onboarding') {
              className = 'is-provider-entry'
            } else if (index === 0) {
              className = 'is-active'
            }

            return (
              <a key={item.href} className={className} href={item.href}>
                {item.href === '#provider-onboarding' && (
                  <Store aria-hidden='true' />
                )}
                {t(item.label)}
              </a>
            )
          })}
        </nav>

        <div className='hub-header-actions'>
          <button
            className='hub-theme-toggle'
            type='button'
            aria-label={t('Toggle theme')}
            title={t('Toggle theme')}
            onClick={() =>
              setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
            }
          >
            {resolvedTheme === 'dark' ? (
              <Sun aria-hidden='true' />
            ) : (
              <Moon aria-hidden='true' />
            )}
          </button>
          <a className='hub-console-link' href='/dashboard/overview'>
            {t('Open console')}
            <ArrowUpRight aria-hidden='true' />
          </a>
        </div>

        <button
          className='hub-mobile-menu-button'
          type='button'
          aria-label={t('Toggle navigation menu')}
          title={t('Toggle navigation menu')}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X aria-hidden='true' /> : <Menu aria-hidden='true' />}
        </button>
      </div>

      {mobileOpen && (
        <nav className='hub-mobile-nav' aria-label={t('Primary navigation')}>
          {navigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
            >
              {item.href === '#provider-onboarding' && (
                <Store aria-hidden='true' />
              )}
              {t(item.label)}
            </a>
          ))}
          <a href='/dashboard/overview' onClick={() => setMobileOpen(false)}>
            {t('Open console')}
            <ArrowUpRight aria-hidden='true' />
          </a>
        </nav>
      )}
    </header>
  )
}
