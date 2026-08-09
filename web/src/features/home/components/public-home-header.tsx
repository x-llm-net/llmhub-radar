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
import { ArrowUpRight, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const navigation = [
  { label: 'Homepage', href: '#top' },
  { label: 'Model rankings', href: '#model-rankings' },
  { label: 'Ranking rules', href: '#ranking-rules' },
  { label: 'Provider onboarding', href: '#provider-onboarding' },
]

export function PublicHomeHeader() {
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className='hub-header'>
      <div className='hub-shell hub-header-inner'>
        <a className='hub-brand' href='#top' aria-label='LLMHub'>
          <span className='hub-brand-mark' aria-hidden='true'>
            <i />
            <i />
            <i />
          </span>
          <span className='hub-brand-copy'>
            <strong>LLMHub</strong>
            <small>{t('Relay field-test rankings')}</small>
          </span>
        </a>

        <nav className='hub-desktop-nav' aria-label={t('Primary navigation')}>
          {navigation.map((item, index) => (
            <a
              key={item.href}
              className={index === 0 ? 'is-active' : undefined}
              href={item.href}
            >
              {t(item.label)}
            </a>
          ))}
        </nav>

        <a className='hub-console-link' href='/dashboard/overview'>
          {t('Open console')}
          <ArrowUpRight aria-hidden='true' />
        </a>

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
