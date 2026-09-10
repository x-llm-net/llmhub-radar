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
  Check,
  Download,
  Image,
  Laptop,
  ExternalLink,
  MousePointerClick,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Card, CardContent } from '@/components/ui/card'
import { getServerAddress } from '@/features/keys/lib/server-address'

function GuideStep(props: {
  number: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className='flex gap-3'>
      <span className='bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
        {props.number}
      </span>
      <div className='min-w-0 space-y-1'>
        <h3 className='text-sm font-semibold'>{props.title}</h3>
        <p className='text-muted-foreground text-sm leading-6'>
          {props.children}
        </p>
      </div>
    </div>
  )
}

function GuideImage(props: { src: string; alt: string; caption: string }) {
  return (
    <figure className='space-y-2'>
      <div className='border-border/70 bg-muted/20 overflow-hidden rounded-xl border'>
        <img
          src={props.src}
          alt={props.alt}
          loading='lazy'
          className='h-auto w-full object-contain'
        />
      </div>
      <figcaption className='text-muted-foreground text-xs leading-5'>
        {props.caption}
      </figcaption>
    </figure>
  )
}

export function DesktopGuide() {
  const { t } = useTranslation()

  return (
    <Card>
      <CardContent className='space-y-6 p-5 md:p-6'>
        <div className='border-border/70 bg-muted/25 flex items-start gap-3 rounded-xl border p-4'>
          <Laptop
            className='text-primary mt-0.5 size-5 shrink-0'
            aria-hidden='true'
          />
          <div className='space-y-1'>
            <p className='text-sm font-medium'>
              {t('Recommended desktop path')}
            </p>
            <p className='text-muted-foreground text-sm leading-6'>
              {t(
                'Codex desktop does not need you to edit configuration files. Use CC Switch to import the site address and API key, then open Codex normally.'
              )}
            </p>
            <div className='flex flex-wrap items-center gap-x-4 gap-y-1 pt-1'>
              <a
                href='https://chatgpt.com/download/'
                target='_blank'
                rel='noreferrer'
                className='text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline'
              >
                {t('Get Codex desktop')}
                <ExternalLink className='size-3.5' aria-hidden='true' />
              </a>
              <a
                href='https://ccswitch.io'
                target='_blank'
                rel='noreferrer'
                className='text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline'
              >
                {t('Get CC Switch')}
                <ExternalLink className='size-3.5' aria-hidden='true' />
              </a>
            </div>
          </div>
        </div>

        <div className='grid gap-5 lg:grid-cols-2'>
          <div className='space-y-5'>
            <GuideStep number='1' title={t('Install Codex desktop')}>
              {t(
                'Download Codex desktop from the official website and install it. Do not open it yet.'
              )}
            </GuideStep>
            <GuideStep number='2' title={t('Install and open CC Switch')}>
              {t(
                'Download the version for your system, install it, and open CC Switch before importing the configuration.'
              )}
            </GuideStep>
            <GuideStep number='3' title={t('Create an API key on this site')}>
              {t(
                'Sign in to this site, open API Keys, and create a key. After it is created, stay on this page and use the action menu on the key row.'
              )}
            </GuideStep>
            <GuideStep number='4' title={t('Open the CC Switch action')}>
              {t(
                'On the new key row, open the three-dot menu and choose CC Switch.'
              )}
            </GuideStep>
          </div>
          <div className='space-y-5'>
            <GuideStep number='5' title={t('Choose Codex and a model')}>
              {t(
                'In the CC Switch dialog, select Codex, choose a model, and keep the prefilled site address and API endpoint.'
              )}
            </GuideStep>
            <GuideStep number='6' title={t('Import the configuration')}>
              {t(
                'Give the configuration a recognizable name, click Open CC Switch, and confirm the import in CC Switch if it asks.'
              )}
            </GuideStep>
            <GuideStep number='7' title={t('Enable the imported profile')}>
              {t(
                'In CC Switch, find the imported Codex profile and switch to it. The endpoint already includes the required /v1 path.'
              )}
            </GuideStep>
            <GuideStep number='8' title={t('Start Codex desktop')}>
              {t(
                'Only after switching profiles, open or restart Codex desktop. Then describe the task you want it to complete.'
              )}
            </GuideStep>
            <div className='border-border/70 bg-muted/25 flex items-start gap-3 rounded-xl border p-4'>
              <Check
                className='text-primary mt-0.5 size-4 shrink-0'
                aria-hidden='true'
              />
              <p className='text-muted-foreground text-sm leading-6'>
                {t(
                  'When Codex returns an answer, the connection is ready. Keep the API key private and do not paste it into a task.'
                )}
              </p>
            </div>
          </div>
        </div>

        <div className='border-border/70 border-t pt-6'>
          <p className='mb-4 text-sm font-semibold'>
            {t('Follow the pictures')}
          </p>
          <div className='grid gap-5 md:grid-cols-3'>
            <GuideImage
              src='/guide-assets/api-key-created.png'
              alt={t('API Keys page with a newly created key')}
              caption={t(
                'After creating a key, use the menu on the right side of its row. You do not need to copy the key.'
              )}
            />
            <GuideImage
              src='/guide-assets/key-actions.png'
              alt={t('API key action menu with CC Switch selected')}
              caption={t('Choose CC Switch from the key row action menu.')}
            />
            <GuideImage
              src='/guide-assets/cc-switch-dialog.png'
              alt={t('CC Switch import dialog with Codex selected')}
              caption={t(
                'Select Codex and a model, then open CC Switch to import the configuration.'
              )}
            />
          </div>
        </div>

        <div className='border-border/70 flex items-start gap-3 border-t pt-5'>
          <MousePointerClick
            className='text-muted-foreground mt-0.5 size-4 shrink-0'
            aria-hidden='true'
          />
          <p className='text-muted-foreground text-sm leading-6'>
            {t(
              'If the profile does not appear, switch to it in CC Switch first and reopen Codex. You can return to API Keys to create a replacement key at any time.'
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export function ImageGenerationGuide() {
  const { t } = useTranslation()
  const skillDownloadUrl = `${getServerAddress()}/downloads/llmhub-imagegen.zip`
  const generationPrompt = 'Use $llmhub-imagegen to generate an image of ...'
  const installPrompt = t(
    'Please download and install the LLM-Hub image generation skill from {{url}}. Extract the llmhub-imagegen folder into the Codex skills directory, then tell me when it is ready.',
    { url: skillDownloadUrl }
  )

  return (
    <Card>
      <CardContent className='space-y-5 p-5 md:p-6'>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
          <div className='flex min-w-0 items-start gap-3'>
            <div className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg'>
              <Image className='size-4' aria-hidden='true' />
            </div>
            <div className='space-y-1'>
              <h3 className='text-sm font-semibold'>
                {t('Generate images with your LLM-Hub key')}
              </h3>
              <p className='text-muted-foreground text-sm leading-6'>
                {t(
                  'Install the skill once, then invoke it by name in a Codex task. The skill uses the provider and API key already configured in Codex.'
                )}
              </p>
            </div>
          </div>
          <div className='flex w-full shrink-0 gap-2 sm:w-auto'>
            <CopyButton
              value={installPrompt}
              variant='default'
              size='default'
              className='min-w-0 flex-1 gap-2 sm:flex-none'
              tooltip={t('Copy installation prompt')}
            >
              {t('Copy installation prompt')}
            </CopyButton>
            <a
              href={skillDownloadUrl}
              download
              className='border-border hover:bg-muted inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors'
              title={t('Direct download')}
              aria-label={t('Direct download')}
            >
              <Download className='size-4' aria-hidden='true' />
            </a>
          </div>
        </div>

        <div className='border-border/70 grid gap-4 border-t pt-5 sm:grid-cols-2'>
          <GuideStep number='1' title={t('Install the image skill')}>
            {t(
              'Copy the installation prompt into a Codex task, or download and extract the package manually.'
            )}
          </GuideStep>
          <GuideStep number='2' title={t('Describe the image')}>
            {t(
              'After restarting Codex, start with “Use $llmhub-imagegen”, then describe the subject, style, size, and any required text.'
            )}
          </GuideStep>
        </div>

        <div className='border-border/70 bg-muted/30 flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5'>
          <code className='min-w-0 flex-1 text-xs break-words'>
            {generationPrompt}
          </code>
          <CopyButton
            value={generationPrompt}
            size='icon'
            variant='ghost'
            className='size-7 shrink-0'
            iconClassName='size-3.5'
            tooltip={t('Copy example prompt')}
          />
        </div>

        <p className='text-muted-foreground border-border/70 border-t pt-5 text-xs leading-5'>
          {t(
            'The skill sends one request to the standard Images API with gpt-image-2. It does not contain or display your API key.'
          )}
        </p>
      </CardContent>
    </Card>
  )
}
