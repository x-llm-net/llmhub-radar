import { useMutation, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'

import { updateServiceTierRouting } from '../api'
import type { UpdateServiceTierRoutingRequest } from '../types'

export function useUpdateServiceTierRouting() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (request: UpdateServiceTierRoutingRequest) => {
      const response = await updateServiceTierRouting(request)
      if (!response.success) {
        throw new Error(
          response.message || i18next.t('Failed to update setting')
        )
      }
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-options'] })
      toast.success(i18next.t('Setting updated successfully'))
    },
    onError: (error: Error) => {
      toast.error(error.message || i18next.t('Failed to update setting'))
    },
  })
}
