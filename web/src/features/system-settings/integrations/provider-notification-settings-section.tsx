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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Plus, Send, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchRow,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import {
  getProviderNotificationSettings,
  testProviderNotification,
  updateProviderNotificationSettings,
  type ProviderNotificationSettings,
  type ProviderNotificationWebhook,
} from './provider-notification-settings-api'

const EMPTY_SETTINGS: ProviderNotificationSettings = {
  enabled: true,
  notify_on_application: true,
  notify_on_review: true,
  email_recipients: [],
  webhooks: [],
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function ProviderNotificationSettingsSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: ['provider-notification-settings'],
    queryFn: getProviderNotificationSettings,
  })
  const [settings, setSettings] =
    useState<ProviderNotificationSettings>(EMPTY_SETTINGS)
  const [emailInput, setEmailInput] = useState('')
  const [webhookDraft, setWebhookDraft] = useState({
    name: '',
    url: '',
  })

  useEffect(() => {
    if (settingsQuery.data) {
      setSettings(settingsQuery.data)
    }
  }, [settingsQuery.data])

  const updateMutation = useMutation({
    mutationFn: updateProviderNotificationSettings,
    onSuccess: (nextSettings) => {
      setSettings(nextSettings)
      queryClient.setQueryData(['provider-notification-settings'], nextSettings)
      toast.success(t('Provider notification settings saved'))
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to update setting'))
    },
  })
  const testMutation = useMutation({
    mutationFn: testProviderNotification,
    onSuccess: () => toast.success(t('Test notification sent')),
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to send test notification'))
    },
  })

  const addEmail = () => {
    const email = emailInput.trim()
    if (!isEmail(email)) {
      toast.error(t('Enter a valid email address'))
      return
    }
    if (settings.email_recipients.includes(email)) {
      setEmailInput('')
      return
    }
    setSettings((current) => ({
      ...current,
      email_recipients: [...current.email_recipients, email],
    }))
    setEmailInput('')
  }

  const addWebhook = () => {
    const name = webhookDraft.name.trim() || t('Enterprise WeChat bot')
    const url = webhookDraft.url.trim()
    if (!isHttpUrl(url)) {
      toast.error(t('Enter a valid webhook URL'))
      return
    }
    if (settings.webhooks.some((webhook) => webhook.url === url)) {
      toast.error(t('This webhook URL has already been added'))
      return
    }
    const webhook: ProviderNotificationWebhook = {
      id: crypto.randomUUID(),
      name,
      url,
      enabled: true,
    }
    setSettings((current) => ({
      ...current,
      webhooks: [...current.webhooks, webhook],
    }))
    setWebhookDraft({ name: '', url: '' })
  }

  const removeEmail = (email: string) => {
    setSettings((current) => ({
      ...current,
      email_recipients: current.email_recipients.filter(
        (recipient) => recipient !== email
      ),
    }))
  }

  const removeWebhook = (id: string) => {
    setSettings((current) => ({
      ...current,
      webhooks: current.webhooks.filter((webhook) => webhook.id !== id),
    }))
  }

  const updateWebhook = (
    id: string,
    update: Partial<ProviderNotificationWebhook>
  ) => {
    setSettings((current) => ({
      ...current,
      webhooks: current.webhooks.map((webhook) =>
        webhook.id === id ? { ...webhook, ...update } : webhook
      ),
    }))
  }

  const handleSave = () => {
    updateMutation.mutate(settings)
  }

  if (settingsQuery.isLoading) {
    return (
      <div className='text-muted-foreground text-sm'>{t('Loading...')}</div>
    )
  }

  if (settingsQuery.isError) {
    return (
      <div className='text-destructive text-sm'>
        {t('Failed to load provider notification settings')}
      </div>
    )
  }

  return (
    <SettingsSection title={t('Provider Notifications')}>
      <SettingsForm
        onSubmit={(event) => {
          event.preventDefault()
          handleSave()
        }}
      >
        <SettingsPageFormActions
          onSave={handleSave}
          isSaving={updateMutation.isPending}
          saveLabel='Save notification settings'
        />

        <SettingsSwitchRow>
          <SettingsSwitchContent>
            <Label>{t('Enable provider notifications')}</Label>
            <p className='text-muted-foreground text-xs'>
              {t('Notify administrators when provider applications change.')}
            </p>
          </SettingsSwitchContent>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) =>
              setSettings((current) => ({ ...current, enabled }))
            }
          />
        </SettingsSwitchRow>

        <div className='grid gap-3 md:grid-cols-2'>
          <SettingsSwitchRow>
            <SettingsSwitchContent>
              <Label>{t('New application submitted')}</Label>
            </SettingsSwitchContent>
            <Switch
              checked={settings.notify_on_application}
              onCheckedChange={(notify_on_application) =>
                setSettings((current) => ({
                  ...current,
                  notify_on_application,
                }))
              }
              disabled={!settings.enabled}
            />
          </SettingsSwitchRow>
          <SettingsSwitchRow>
            <SettingsSwitchContent>
              <Label>{t('Application review completed')}</Label>
            </SettingsSwitchContent>
            <Switch
              checked={settings.notify_on_review}
              onCheckedChange={(notify_on_review) =>
                setSettings((current) => ({ ...current, notify_on_review }))
              }
              disabled={!settings.enabled}
            />
          </SettingsSwitchRow>
        </div>

        <Separator />

        <div data-settings-form-span='full' className='space-y-3'>
          <div>
            <h4 className='font-medium'>{t('Email recipients')}</h4>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t(
                'Use SMTP settings to send provider notifications to multiple administrators.'
              )}
            </p>
          </div>
          <div className='flex gap-2'>
            <div className='relative min-w-0 flex-1'>
              <Mail className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
              <Input
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addEmail()
                  }
                }}
                placeholder={t('admin@example.com')}
                className='pl-9'
                disabled={!settings.enabled}
              />
            </div>
            <Button
              type='button'
              variant='outline'
              onClick={addEmail}
              disabled={!settings.enabled}
              aria-label={t('Add email recipient')}
            >
              <Plus data-icon='inline-start' />
              <span>{t('Add')}</span>
            </Button>
          </div>
          {settings.email_recipients.map((email) => (
            <div
              key={email}
              className='bg-muted/30 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm'
            >
              <span className='min-w-0 truncate'>{email}</span>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                onClick={() => removeEmail(email)}
                aria-label={t('Remove email recipient')}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        <div data-settings-form-span='full' className='space-y-3'>
          <div>
            <h4 className='font-medium'>{t('Enterprise WeChat Webhooks')}</h4>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t(
                'Add one robot webhook for each administrator group that should receive alerts.'
              )}
            </p>
          </div>
          <div className='grid gap-2 md:grid-cols-[minmax(10rem,0.35fr)_minmax(0,1fr)_auto]'>
            <Input
              value={webhookDraft.name}
              onChange={(event) =>
                setWebhookDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder={t('Operations group')}
              disabled={!settings.enabled}
            />
            <Input
              value={webhookDraft.url}
              onChange={(event) =>
                setWebhookDraft((current) => ({
                  ...current,
                  url: event.target.value,
                }))
              }
              placeholder='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
              disabled={!settings.enabled}
            />
            <Button
              type='button'
              variant='outline'
              onClick={addWebhook}
              disabled={!settings.enabled}
              aria-label={t('Add webhook')}
            >
              <Plus data-icon='inline-start' />
              <span>{t('Add')}</span>
            </Button>
          </div>
          {settings.webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className='bg-muted/30 grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(10rem,0.35fr)_minmax(0,1fr)_auto_auto] md:items-center'
            >
              <Input
                value={webhook.name}
                onChange={(event) =>
                  updateWebhook(webhook.id, { name: event.target.value })
                }
                aria-label={t('Webhook name')}
                disabled={!settings.enabled}
              />
              <Input
                value={webhook.url}
                onChange={(event) =>
                  updateWebhook(webhook.id, { url: event.target.value })
                }
                aria-label={t('Webhook URL')}
                disabled={!settings.enabled}
              />
              <div className='flex items-center gap-2'>
                <Switch
                  checked={webhook.enabled}
                  onCheckedChange={(enabled) =>
                    updateWebhook(webhook.id, { enabled })
                  }
                  disabled={!settings.enabled}
                />
                <span className='text-muted-foreground text-xs'>
                  {t('Enabled')}
                </span>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                onClick={() => removeWebhook(webhook.id)}
                aria-label={t('Remove webhook')}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        <div data-settings-form-span='full' className='flex justify-end'>
          <Button
            type='button'
            variant='outline'
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || !settings.enabled}
          >
            <Send data-icon='inline-start' />
            <span>{t('Send test notification')}</span>
          </Button>
        </div>
      </SettingsForm>
    </SettingsSection>
  )
}
