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
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { HubProviderPayoutAccount } from '../types'
import { payoutMethodLabel } from './payout-account-utils'
import {
  ProviderPayoutAccountDialog,
  type ProviderPayoutAccountFormValue,
} from './provider-payout-account-dialog'

interface ProviderPayoutAccountsProps {
  accounts: HubProviderPayoutAccount[]
  loading: boolean
  pending: boolean
  onSave: (
    account: HubProviderPayoutAccount | null,
    value: ProviderPayoutAccountFormValue
  ) => Promise<boolean>
  onDelete: (account: HubProviderPayoutAccount) => Promise<boolean>
  getAssetBlob?: (assetId: number) => Promise<Blob>
}

export function ProviderPayoutAccounts(props: ProviderPayoutAccountsProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<HubProviderPayoutAccount | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState<HubProviderPayoutAccount | null>(
    null
  )

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (account: HubProviderPayoutAccount) => {
    setEditing(account)
    setDialogOpen(true)
  }

  return (
    <section id='provider-payout-accounts' className='scroll-mt-4 space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h3 className='font-medium'>{t('Payout accounts')}</h3>
          <p className='text-muted-foreground text-sm'>
            {t('Manage the accounts administrators can use for withdrawals.')}
          </p>
        </div>
        <Button type='button' variant='outline' onClick={openCreate}>
          <Plus />
          {t('Add payout account')}
        </Button>
      </div>
      <div className='overflow-hidden rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Payout method')}</TableHead>
              <TableHead>{t('Recipient')}</TableHead>
              <TableHead>{t('Account')}</TableHead>
              <TableHead>{t('Default')}</TableHead>
              <TableHead className='text-right'>{t('Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.loading && (
              <TableRow>
                <TableCell colSpan={5} className='h-24 text-center'>
                  <Loader2 className='mx-auto animate-spin' />
                </TableCell>
              </TableRow>
            )}
            {!props.loading && props.accounts.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className='text-muted-foreground h-24 text-center'
                >
                  {t('No payout accounts yet')}
                </TableCell>
              </TableRow>
            )}
            {!props.loading &&
              props.accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className='font-medium'>
                    {payoutMethodLabel(account.method, t)}
                  </TableCell>
                  <TableCell>{account.details.recipient_name}</TableCell>
                  <TableCell className='font-mono text-xs'>
                    {account.masked_summary || t('QR code')}
                  </TableCell>
                  <TableCell>
                    {account.is_default ? t('Default') : '-'}
                  </TableCell>
                  <TableCell>
                    <div className='flex justify-end gap-1'>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon-sm'
                              onClick={() => openEdit(account)}
                              aria-label={t('Edit payout account')}
                            />
                          }
                        >
                          <Pencil />
                        </TooltipTrigger>
                        <TooltipContent>{t('Edit')}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon-sm'
                              onClick={() => setDeleting(account)}
                              aria-label={t('Delete payout account')}
                            />
                          }
                        >
                          <Trash2 />
                        </TooltipTrigger>
                        <TooltipContent>{t('Delete')}</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <ProviderPayoutAccountDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!props.pending) setDialogOpen(open)
        }}
        account={editing}
        pending={props.pending}
        onConfirm={(value) => props.onSave(editing, value)}
        getAssetBlob={props.getAssetBlob}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !props.pending) setDeleting(null)
        }}
        title={t('Delete payout account')}
        desc={t(
          'This account will no longer be available for new withdrawals. Existing withdrawal records keep their original snapshot.'
        )}
        destructive
        isLoading={props.pending}
        confirmText={t('Delete')}
        handleConfirm={async () => {
          if (!deleting) return
          const success = await props.onDelete(deleting)
          if (success) setDeleting(null)
        }}
      />
    </section>
  )
}
