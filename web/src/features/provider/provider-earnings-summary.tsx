import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  ArrowRightLeft,
  BanknoteArrowDown,
  CircleDollarSign,
  ReceiptText,
  RefreshCw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getProviderEarningSummary,
  providerEarningSummaryQueryKey,
} from '@/features/wallet/api'
import { formatQuota } from '@/lib/format'

export function ProviderEarningsSummary() {
  const { t } = useTranslation()
  const summary = useQuery({
    queryKey: providerEarningSummaryQueryKey,
    queryFn: getProviderEarningSummary,
  })
  const data = summary.data?.data
  const feePercent = (data?.platform_fee_basis_points ?? 1000) / 100
  const stats = [
    {
      label: t('Total provider earnings'),
      value: data?.settled_income_quota ?? 0,
      icon: CircleDollarSign,
    },
    {
      label: t('Available earnings'),
      value: data?.withdrawable_quota ?? 0,
      icon: BanknoteArrowDown,
      description: t('Transfer to balance or request withdrawal'),
      detail:
        (data?.reserved_withdrawal_quota ?? 0) > 0
          ? t('Withdrawal in progress: {{amount}}', {
              amount: formatQuota(data?.reserved_withdrawal_quota ?? 0),
            })
          : undefined,
    },
    {
      label: t('Transferred to balance'),
      value: data?.transferred_balance_quota ?? 0,
      icon: ArrowRightLeft,
    },
    {
      label: t('Total withdrawn'),
      value: data?.paid_withdrawal_quota ?? 0,
      icon: ReceiptText,
    },
  ]

  return (
    <section className='space-y-4'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h2 className='text-lg font-semibold'>
            {t('Provider earnings overview')}
          </h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(
              'Successful charges from your supply channels are settled automatically. The current platform fee is {{percent}}%.',
              { percent: feePercent }
            )}
          </p>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          render={<Link to='/wallet' search={{ tab: 'earnings' }} />}
        >
          {t('View earning details')}
          <ArrowRight />
        </Button>
      </div>

      {summary.isError ? (
        <div className='border-destructive/40 bg-destructive/5 flex min-h-24 items-center justify-between gap-4 rounded-lg border px-4 py-3'>
          <p className='text-sm'>{t('Failed to load provider earnings')}</p>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => void summary.refetch()}
          >
            <RefreshCw />
            {t('Retry')}
          </Button>
        </div>
      ) : (
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          {stats.map((stat) => (
            <Card key={stat.label} size='sm' className='rounded-lg'>
              <CardHeader className='grid grid-cols-[1fr_auto] items-center'>
                <CardTitle className='text-muted-foreground font-normal'>
                  {stat.label}
                </CardTitle>
                <stat.icon className='text-muted-foreground size-4' />
              </CardHeader>
              <CardContent className='space-y-1'>
                {summary.isLoading ? (
                  <Skeleton className='h-7 w-28' />
                ) : (
                  <>
                    <p className='text-xl font-semibold tabular-nums'>
                      {formatQuota(stat.value)}
                    </p>
                    {stat.description && (
                      <p className='text-muted-foreground text-xs'>
                        {stat.description}
                      </p>
                    )}
                    {stat.detail && (
                      <p className='text-muted-foreground text-xs'>
                        {stat.detail}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
