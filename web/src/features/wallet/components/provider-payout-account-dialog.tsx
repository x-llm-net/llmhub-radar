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
import { ImageUp, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type {
  HubProviderPayoutAccount,
  HubProviderPayoutAccountDetails,
  HubProviderPayoutMethod,
} from '../types'
import { PayoutQRCodeImage } from './payout-account'
import { payoutMethodLabel } from './payout-account-utils'

const payoutMethods: HubProviderPayoutMethod[] = ['alipay', 'wechat', 'bank']
const payoutQRCodeMaxBytes = 2 * 1024 * 1024
const payoutQRCodeTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface ProviderPayoutAccountFormValue {
  method: HubProviderPayoutMethod
  details: HubProviderPayoutAccountDetails
  qrCodeAssetId: number
  qrCodeFile: File | null
  isDefault: boolean
}

interface ProviderPayoutAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: HubProviderPayoutAccount | null
  pending: boolean
  onConfirm: (value: ProviderPayoutAccountFormValue) => Promise<boolean>
}

export function ProviderPayoutAccountDialog(
  props: ProviderPayoutAccountDialogProps
) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [method, setMethod] = useState<HubProviderPayoutMethod>('alipay')
  const [recipientName, setRecipientName] = useState('')
  const [account, setAccount] = useState('')
  const [accountType, setAccountType] = useState<'personal' | 'business'>(
    'personal'
  )
  const [bankName, setBankName] = useState('')
  const [bankBranch, setBankBranch] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [qrCodeAssetId, setQRCodeAssetId] = useState(0)
  const [qrCodeFile, setQRCodeFile] = useState<File | null>(null)
  const [previewURL, setPreviewURL] = useState('')
  const [fileError, setFileError] = useState('')

  useEffect(() => {
    if (!props.open) return
    const current = props.account
    setMethod(current?.method ?? 'alipay')
    setRecipientName(current?.details.recipient_name ?? '')
    setAccount(current?.details.account ?? '')
    setAccountType(current?.details.account_type ?? 'personal')
    setBankName(current?.details.bank_name ?? '')
    setBankBranch(current?.details.bank_branch ?? '')
    setIsDefault(current?.is_default ?? false)
    setQRCodeAssetId(current?.qr_code_asset_id ?? 0)
    setQRCodeFile(null)
    setFileError('')
  }, [props.account, props.open])

  useEffect(() => {
    if (!qrCodeFile) {
      setPreviewURL('')
      return
    }
    const url = URL.createObjectURL(qrCodeFile)
    setPreviewURL(url)
    return () => URL.revokeObjectURL(url)
  }, [qrCodeFile])

  const hasQRCode = qrCodeFile !== null || qrCodeAssetId > 0
  const requiresAccount = method === 'alipay' || method === 'bank'
  const canSubmit =
    recipientName.trim().length > 0 &&
    (!requiresAccount || account.trim().length > 0) &&
    (method !== 'bank' || bankName.trim().length > 0) &&
    (method !== 'wechat' || hasQRCode) &&
    !fileError &&
    !props.pending

  const handleFile = (file: File | undefined) => {
    setFileError('')
    if (!file) return
    if (!payoutQRCodeTypes.has(file.type) || file.size > payoutQRCodeMaxBytes) {
      setQRCodeFile(null)
      setFileError(t('Use a PNG, JPEG, or WebP image no larger than 2 MB.'))
      return
    }
    setQRCodeFile(file)
  }

  const handleConfirm = async () => {
    if (!canSubmit) return
    const success = await props.onConfirm({
      method,
      details: {
        version: 1,
        recipient_name: recipientName.trim(),
        account:
          method === 'wechat' ? account.trim() || undefined : account.trim(),
        account_type: method === 'bank' ? accountType : undefined,
        bank_name: method === 'bank' ? bankName.trim() : undefined,
        bank_branch:
          method === 'bank' ? bankBranch.trim() || undefined : undefined,
      },
      qrCodeAssetId: method === 'bank' ? 0 : qrCodeAssetId,
      qrCodeFile,
      isDefault,
    })
    if (success) props.onOpenChange(false)
  }

  const renderQRCodePreview = () => {
    if (previewURL) {
      return (
        <img
          src={previewURL}
          alt={t('Payment QR code preview')}
          className='size-28 rounded-md border bg-white object-contain p-1'
        />
      )
    }
    if (qrCodeAssetId > 0) {
      return (
        <PayoutQRCodeImage
          assetId={qrCodeAssetId}
          alt={t('Payment QR code')}
          className='size-28'
        />
      )
    }
    return (
      <div className='bg-muted/40 text-muted-foreground flex size-28 items-center justify-center rounded-md border'>
        <ImageUp />
      </div>
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.account ? t('Edit payout account') : t('Add payout account')}
      description={t(
        'Payout accounts are private and are only shown to you and administrators handling withdrawals.'
      )}
      contentHeight='auto'
      contentClassName='sm:max-w-xl'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={props.pending}
          >
            {t('Cancel')}
          </Button>
          <Button type='button' onClick={handleConfirm} disabled={!canSubmit}>
            {props.pending && <Loader2 className='animate-spin' />}
            {props.account ? t('Save changes') : t('Add account')}
          </Button>
        </>
      }
    >
      <div className='space-y-2'>
        <Label>{t('Payout method')}</Label>
        <Select
          items={payoutMethods.map((value) => ({
            value,
            label: payoutMethodLabel(value, t),
          }))}
          value={method}
          onValueChange={(value) => value && setMethod(value)}
        >
          <SelectTrigger className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {payoutMethods.map((value) => (
                <SelectItem key={value} value={value}>
                  {payoutMethodLabel(value, t)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {method === 'bank' && (
        <div className='space-y-2'>
          <Label>{t('Account type')}</Label>
          <Select
            items={[
              { value: 'personal', label: t('Personal account') },
              { value: 'business', label: t('Business account') },
            ]}
            value={accountType}
            onValueChange={(value) => value && setAccountType(value)}
          >
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value='personal'>
                  {t('Personal account')}
                </SelectItem>
                <SelectItem value='business'>
                  {t('Business account')}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className='space-y-2'>
        <Label htmlFor='payout-recipient-name'>{t('Recipient name')}</Label>
        <Input
          id='payout-recipient-name'
          value={recipientName}
          onChange={(event) => setRecipientName(event.target.value)}
          maxLength={128}
          placeholder={
            method === 'bank' && accountType === 'business'
              ? t('Enter the company account name')
              : t('Enter the recipient name')
          }
        />
      </div>

      {method !== 'wechat' && (
        <div className='space-y-2'>
          <Label htmlFor='payout-account-number'>
            {method === 'bank' ? t('Bank account number') : t('Alipay account')}
          </Label>
          <Input
            id='payout-account-number'
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            maxLength={255}
            autoComplete='off'
          />
        </div>
      )}

      {method === 'wechat' && (
        <div className='space-y-2'>
          <Label htmlFor='payout-wechat-id'>{t('WeChat ID (optional)')}</Label>
          <Input
            id='payout-wechat-id'
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            maxLength={255}
            autoComplete='off'
          />
        </div>
      )}

      {method === 'bank' && (
        <>
          <div className='space-y-2'>
            <Label htmlFor='payout-bank-name'>{t('Bank name')}</Label>
            <Input
              id='payout-bank-name'
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              maxLength={128}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='payout-bank-branch'>
              {t('Bank branch (optional)')}
            </Label>
            <Input
              id='payout-bank-branch'
              value={bankBranch}
              onChange={(event) => setBankBranch(event.target.value)}
              maxLength={255}
            />
          </div>
        </>
      )}

      {method !== 'bank' && (
        <div className='space-y-2'>
          <Label>
            {method === 'wechat'
              ? t('Payment QR code')
              : t('Payment QR code (optional)')}
          </Label>
          <div className='flex flex-wrap items-center gap-3'>
            {renderQRCodePreview()}
            <div className='flex flex-wrap gap-2'>
              <input
                ref={fileInputRef}
                type='file'
                accept='image/png,image/jpeg,image/webp'
                className='hidden'
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
              <Button
                type='button'
                variant='outline'
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageUp />
                {hasQRCode ? t('Replace image') : t('Upload image')}
              </Button>
              {qrCodeFile && (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  onClick={() => {
                    setQRCodeFile(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                  aria-label={t('Remove selected image')}
                  title={t('Remove selected image')}
                >
                  <X />
                </Button>
              )}
              {!qrCodeFile && qrCodeAssetId > 0 && (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  onClick={() => setQRCodeAssetId(0)}
                  aria-label={t('Remove payment QR code')}
                  title={t('Remove payment QR code')}
                >
                  <X />
                </Button>
              )}
            </div>
          </div>
          <p
            className={
              fileError
                ? 'text-destructive text-xs'
                : 'text-muted-foreground text-xs'
            }
          >
            {fileError || t('PNG, JPEG, or WebP, up to 2 MB.')}
          </p>
        </div>
      )}

      <div className='flex items-center gap-2 pt-1'>
        <Checkbox
          id='payout-account-default'
          checked={isDefault}
          onCheckedChange={(checked) => setIsDefault(checked === true)}
          disabled={props.account?.is_default}
        />
        <Label htmlFor='payout-account-default' className='font-normal'>
          {t('Use as default payout account')}
        </Label>
      </div>
    </Dialog>
  )
}
