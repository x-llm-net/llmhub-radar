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
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  Code2,
  ExternalLink,
  HelpCircle,
  KeyRound,
  Play,
  ShieldCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { PublicLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getServerAddress } from '@/features/keys/lib/server-address'

import { DesktopGuide, ImageGenerationGuide } from './components/desktop-guide'

type GuideSectionProps = {
  id: string
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}

function GuideSection({
  id,
  icon,
  title,
  description,
  children,
}: GuideSectionProps) {
  return (
    <section id={id} className='scroll-mt-24 space-y-5'>
      <div className='flex items-start gap-3'>
        <div className='bg-primary/10 text-primary mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg'>
          {icon}
        </div>
        <div className='space-y-1'>
          <h2 className='text-xl font-semibold tracking-tight'>{title}</h2>
          <p className='text-muted-foreground text-sm leading-6'>
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  )
}

function Step(props: {
  number: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className='flex gap-3'>
      <span className='bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
        {props.number}
      </span>
      <div className='min-w-0 space-y-1'>
        <h3 className='text-sm font-semibold'>{props.title}</h3>
        <div className='text-muted-foreground text-sm leading-6'>
          {props.children}
        </div>
      </div>
    </div>
  )
}

function CodeLine(props: { label: string; value: string; copyValue?: string }) {
  return (
    <div className='border-border/70 bg-muted/30 flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5'>
      <span className='text-muted-foreground shrink-0 text-xs'>
        {props.label}
      </span>
      <code className='min-w-0 flex-1 truncate text-xs'>{props.value}</code>
      <CopyButton
        value={props.copyValue ?? props.value}
        size='icon'
        variant='ghost'
        className='size-7'
        iconClassName='size-3.5'
        tooltip={props.label}
      />
    </div>
  )
}

function FaqItem(props: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className='border-border/70 border-b last:border-b-0'>
      <button
        type='button'
        className='flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium'
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{props.question}</span>
        <ChevronDown
          aria-hidden='true'
          className={`text-muted-foreground size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <p className='text-muted-foreground pb-4 text-sm leading-6'>
          {props.answer}
        </p>
      )}
    </div>
  )
}

export function Guide() {
  const { t } = useTranslation()
  const [showExample, setShowExample] = useState(false)
  const apiOrigin = useMemo(() => getServerAddress(), [])
  const openAiEndpoint = `${apiOrigin}/v1`
  const exampleRequest = `curl ${apiOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer sk-xxx..." \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-5.6-sol","messages":[{"role":"user","content":"Hello"}]}'`

  return (
    <PublicLayout
      navLinks={[
        { title: 'Home', href: '/' },
        { title: 'Usage guide', href: '/guide' },
      ]}
    >
      <div className='mx-auto max-w-6xl py-4 pb-16'>
        <div className='grid gap-10 lg:grid-cols-[minmax(0,1fr)_220px]'>
          <main className='min-w-0 space-y-12'>
            <header className='border-border/70 bg-muted/20 rounded-2xl border px-6 py-8 md:px-10 md:py-10'>
              <div className='text-primary mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.16em] uppercase'>
                <BookOpen className='size-4' aria-hidden='true' />
                {t('Usage guide')}
              </div>
              <h1 className='max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl'>
                {t('Connect to AI models in a few minutes')}
              </h1>
              <p className='text-muted-foreground mt-4 max-w-2xl text-sm leading-7 md:text-base'>
                {t(
                  'Create an API key, choose an available model, and connect your preferred AI client. This guide uses the current site address automatically.'
                )}
              </p>
              <div className='mt-6 flex flex-wrap gap-3'>
                <Button render={<a href='/keys' />}>
                  <KeyRound className='size-4' aria-hidden='true' />
                  {t('Create an API key')}
                  <ArrowRight className='size-4' aria-hidden='true' />
                </Button>
                <Button variant='outline' render={<a href='#api-access' />}>
                  <Code2 className='size-4' aria-hidden='true' />
                  {t('View API access')}
                </Button>
              </div>
            </header>

            <GuideSection
              id='quick-start'
              icon={<Play className='size-4' aria-hidden='true' />}
              title={t('Quick start')}
              description={t(
                'The shortest path from registration to your first successful request.'
              )}
            >
              <Card>
                <CardContent className='space-y-5 p-5 md:p-6'>
                  <Step number='1' title={t('Sign in or create an account')}>
                    {t(
                      'Use the sign-in page to access this site. New users can register with an available email address.'
                    )}
                  </Step>
                  <Step number='2' title={t('Create an API key')}>
                    {t(
                      'Open API Keys and create a key. For Codex desktop, use the key row menu to import it into CC Switch instead of copying it manually.'
                    )}
                  </Step>
                  <Step number='3' title={t('Choose a model')}>
                    {t(
                      'Check the model square for supported models and their current published prices. Start with a model marked as available.'
                    )}
                  </Step>
                  <Step number='4' title={t('Send a test request')}>
                    {t(
                      'Use the OpenAI-compatible example in the API access section. If it returns content, your key and endpoint are ready.'
                    )}
                  </Step>
                </CardContent>
              </Card>
            </GuideSection>

            <GuideSection
              id='codex-desktop'
              icon={<BookOpen className='size-4' aria-hidden='true' />}
              title={t('Codex desktop')}
              description={t(
                'A step-by-step setup for users who do not want to edit configuration files.'
              )}
            >
              <DesktopGuide />
            </GuideSection>

            <GuideSection
              id='image-generation'
              icon={<Play className='size-4' aria-hidden='true' />}
              title={t('Generate images')}
              description={t(
                'Use Codex to generate a new image or edit an existing image with natural language.'
              )}
            >
              <ImageGenerationGuide />
            </GuideSection>

            <GuideSection
              id='api-access'
              icon={<Code2 className='size-4' aria-hidden='true' />}
              title={t('API access')}
              description={t(
                'The gateway provides an OpenAI-compatible endpoint for common tools and SDKs.'
              )}
            >
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <h3 className='text-sm font-semibold'>
                    {t('Connection details')}
                  </h3>
                  <div className='grid gap-2 sm:grid-cols-2'>
                    <CodeLine label={t('Base URL')} value={openAiEndpoint} />
                    <CodeLine label={t('API key example')} value='sk-xxx...' />
                  </div>
                </div>
                <div className='border-border/70 bg-foreground text-background overflow-hidden rounded-xl border'>
                  <div className='border-background/15 flex items-center justify-between border-b px-4 py-3'>
                    <span className='text-background/65 text-xs'>
                      cURL · OpenAI compatible
                    </span>
                    <CopyButton
                      value={exampleRequest}
                      variant='ghost'
                      size='icon'
                      className='text-background/75 hover:bg-background/10 hover:text-background size-7'
                      iconClassName='size-3.5'
                      tooltip={t('Copy example')}
                    />
                  </div>
                  <pre className='overflow-x-auto p-4 text-xs leading-6'>
                    <code>{exampleRequest}</code>
                  </pre>
                </div>
                <button
                  type='button'
                  className='text-primary inline-flex items-center gap-2 text-sm font-medium hover:underline'
                  onClick={() => setShowExample((value) => !value)}
                  aria-expanded={showExample}
                >
                  <ExternalLink className='size-4' aria-hidden='true' />
                  {t('Show request format')}
                </button>
                {showExample && (
                  <pre className='bg-muted/40 overflow-x-auto rounded-lg p-4 text-xs leading-6'>
                    <code>{`{
  "model": "gpt-5.6-sol",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true
}`}</code>
                  </pre>
                )}
              </div>
            </GuideSection>

            <GuideSection
              id='faq'
              icon={<HelpCircle className='size-4' aria-hidden='true' />}
              title={t('Common questions')}
              description={t(
                'A few answers for the first request and the most common issues.'
              )}
            >
              <Card>
                <CardContent className='px-5 md:px-6'>
                  <FaqItem
                    question={t('Why did my request fail?')}
                    answer={t(
                      'Check that the API key is enabled, the model name is correct, and your balance is sufficient. A temporarily unavailable channel may recover later; try again or choose another available model.'
                    )}
                  />
                  <FaqItem
                    question={t('Why is a model unavailable?')}
                    answer={t(
                      'The model may not be published by the current site, may be temporarily unhealthy, or may require a different route. Check the model square for its current status.'
                    )}
                  />
                  <FaqItem
                    question={t('Where can I see my balance and usage?')}
                    answer={t(
                      'Open the console after signing in. The overview and usage logs show your balance, requests, and consumption details.'
                    )}
                  />
                  <FaqItem
                    question={t('What should I do if I lose my API key?')}
                    answer={t(
                      'For security, the full key cannot be recovered. Delete the lost key and create a new one, then update the client using it.'
                    )}
                  />
                </CardContent>
              </Card>
            </GuideSection>

            <div className='border-border/70 bg-muted/20 flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between'>
              <div className='flex items-start gap-3'>
                <ShieldCheck
                  className='text-primary mt-0.5 size-5 shrink-0'
                  aria-hidden='true'
                />
                <div>
                  <p className='text-sm font-medium'>
                    {t('Keep your API key private')}
                  </p>
                  <p className='text-muted-foreground mt-1 text-xs leading-5'>
                    {t(
                      'Do not publish it in source code, screenshots, or public repositories.'
                    )}
                  </p>
                </div>
              </div>
              <a
                className='text-primary inline-flex shrink-0 items-center gap-1.5 text-sm font-medium hover:underline'
                href='/dashboard/overview'
              >
                {t('Open console')}
                <ArrowRight className='size-4' aria-hidden='true' />
              </a>
            </div>
          </main>

          <aside className='hidden lg:block'>
            <div className='sticky top-24 space-y-3'>
              <p className='text-muted-foreground px-3 text-xs font-semibold tracking-wider uppercase'>
                {t('On this page')}
              </p>
              <nav
                className='border-border/70 border-l pl-3'
                aria-label={t('On this page')}
              >
                {[
                  ['quick-start', t('Quick start')],
                  ['codex-desktop', t('Codex desktop')],
                  ['image-generation', t('Generate images')],
                  ['api-access', t('API access')],
                  ['faq', t('Common questions')],
                ].map(([id, label]) => (
                  <a
                    key={id}
                    className='text-muted-foreground hover:text-foreground block px-2 py-2 text-sm transition-colors'
                    href={`#${id}`}
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>
        </div>
      </div>
    </PublicLayout>
  )
}
