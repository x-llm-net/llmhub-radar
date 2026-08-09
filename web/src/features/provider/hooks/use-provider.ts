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
import { useQuery } from '@tanstack/react-query'

import {
  getProviderChannel,
  getProviderChannels,
  getProviderSelf,
  getProviderChannelProbes,
} from '../api'

export const providerQueryKey = ['hub-provider', 'self'] as const
export const providerChannelsQueryKey = ['hub-provider', 'channels'] as const
export const providerChannelQueryKey = (channelId: number) =>
  ['hub-provider', 'channels', channelId] as const
export const providerChannelProbesQueryKey = (channelId: number) =>
  ['hub-provider', 'channels', channelId, 'probes'] as const

export function useProvider(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: providerQueryKey,
    queryFn: getProviderSelf,
    enabled: options?.enabled ?? true,
    staleTime: 60 * 1000,
    retry: false,
  })

  return {
    ...query,
    provider: query.data?.data ?? null,
  }
}

export function useProviderChannels(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: providerChannelsQueryKey,
    queryFn: () => getProviderChannels(),
    enabled: options?.enabled ?? true,
    staleTime: 30 * 1000,
    retry: false,
    refetchInterval: 15 * 1000,
  })

  return {
    ...query,
    channels: query.data?.data?.items ?? [],
  }
}

export function useProviderChannel(
  channelId: number,
  options?: { enabled?: boolean }
) {
  const query = useQuery({
    queryKey: providerChannelQueryKey(channelId),
    queryFn: () => getProviderChannel(channelId),
    enabled: (options?.enabled ?? true) && channelId > 0,
    staleTime: 30 * 1000,
    retry: false,
  })

  return {
    ...query,
    providerChannel: query.data?.data ?? null,
  }
}

export function useProviderChannelProbes(
  channelId: number,
  options?: { enabled?: boolean }
) {
  const query = useQuery({
    queryKey: providerChannelProbesQueryKey(channelId),
    queryFn: () => getProviderChannelProbes(channelId),
    enabled: (options?.enabled ?? true) && channelId > 0,
    staleTime: 0,
    retry: false,
    refetchInterval: (currentQuery) =>
      currentQuery.state.data?.data?.running ? 1000 : false,
  })

  return {
    ...query,
    probeState: query.data?.data ?? null,
  }
}
