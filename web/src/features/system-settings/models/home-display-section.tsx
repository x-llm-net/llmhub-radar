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
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const schema = z.object({
  modelBlacklist: z.string(),
})

type FormValues = z.infer<typeof schema>

function parseModelNames(value: string) {
  const seen = new Set<string>()
  const models: string[] = []

  for (const rawModelName of value.split(/[\r\n,]+/)) {
    const modelName = rawModelName.trim()
    if (!modelName || seen.has(modelName)) continue
    seen.add(modelName)
    models.push(modelName)
  }

  return models
}

function formatModelNames(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .join('\n')
    }
  } catch {
    // Keep an invalid legacy value editable instead of discarding it.
  }
  return value
}

function normalizeModelBlacklist(value: string) {
  return JSON.stringify(parseModelNames(value))
}

type HomeDisplaySectionProps = {
  defaultValue: string
}

export function HomeDisplaySection(props: HomeDisplaySectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { modelBlacklist: formatModelNames(props.defaultValue) },
  })

  useEffect(() => {
    form.reset({ modelBlacklist: formatModelNames(props.defaultValue) })
  }, [form, props.defaultValue])

  const onSubmit = async (values: FormValues) => {
    const value = normalizeModelBlacklist(values.modelBlacklist)
    const previousValue = normalizeModelBlacklist(
      formatModelNames(props.defaultValue)
    )
    if (value === previousValue) {
      toast.info(t('No changes to save'))
      return
    }

    await updateOption.mutateAsync({
      key: 'hub_public_home.model_blacklist',
      value,
    })
  }

  return (
    <SettingsSection title={t('Home Display')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='modelBlacklist'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Models hidden from the public home')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    className='min-h-36 font-mono text-sm'
                    placeholder='codex-auto-review'
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Enter one exact model name per line. This only hides models from the public home page; it does not affect probing, routing, pricing, or API calls.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
