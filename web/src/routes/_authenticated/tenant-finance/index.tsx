/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { createFileRoute, redirect } from '@tanstack/react-router'

import { getHubAdminAccess } from '@/features/providers/api'
import { TenantFinance } from '@/features/tenant-finance'

export const Route = createFileRoute('/_authenticated/tenant-finance/')({
  beforeLoad: async () => {
    try {
      const response = await getHubAdminAccess()
      if (!response.success || !response.data?.can_view_tenant_finance) {
        throw new Error('tenant finance is unavailable')
      }
    } catch {
      throw redirect({ to: '/403' })
    }
  },
  component: TenantFinance,
})
