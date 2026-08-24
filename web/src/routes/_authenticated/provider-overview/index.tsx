import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/provider-overview/')({
  beforeLoad: () => {
    throw redirect({ to: '/providers' })
  },
})
