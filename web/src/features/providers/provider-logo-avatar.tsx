/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useProviderLogoURL } from '@/lib/provider-logo'

import type { HubProviderAdminItem } from './types'

export function ProviderLogoAvatar({
  provider,
}: {
  provider: HubProviderAdminItem
}) {
  const logoURL = useProviderLogoURL(provider.logo_url)
  return (
    <Avatar className='size-9 rounded-md'>
      <AvatarImage src={logoURL || undefined} alt='' />
      <AvatarFallback className='rounded-md text-xs'>
        {provider.name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
