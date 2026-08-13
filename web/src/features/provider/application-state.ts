/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { HubProviderStatus } from './types'

export type ProviderApplicationState = {
  title: string
  description: string
  label: string
  variant: 'warning' | 'danger'
  editLabel: string
  remarkLabel: string
  showRemark: boolean
  showEarnings: boolean
}

export function getProviderApplicationState(
  status: HubProviderStatus
): ProviderApplicationState {
  switch (status) {
    case 'pending':
      return {
        title: 'Application under review',
        description:
          'Your provider application is awaiting administrator review. Supply channel management will be available after approval.',
        label: 'Pending review',
        variant: 'warning',
        editLabel: 'Edit application',
        remarkLabel: 'Review reason',
        showRemark: false,
        showEarnings: false,
      }
    case 'rejected':
      return {
        title: 'Provider application rejected',
        description:
          'Update the application details and submit them again for review.',
        label: 'Rejected',
        variant: 'danger',
        editLabel: 'Edit application',
        remarkLabel: 'Review reason',
        showRemark: true,
        showEarnings: false,
      }
    case 'disabled':
      return {
        title: 'Provider account disabled',
        description:
          'Supply channel management is unavailable while this provider account is disabled.',
        label: 'Disabled',
        variant: 'danger',
        editLabel: 'Edit public profile',
        remarkLabel: 'Administrator note',
        showRemark: true,
        showEarnings: true,
      }
    case 'active':
      throw new Error('Active providers must use the provider workspace')
  }
}
