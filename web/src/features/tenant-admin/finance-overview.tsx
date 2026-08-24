import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatQuota } from '@/lib/format'

import { getHubAdminTenantFinance, tenantAdminFinanceQueryKey } from './api'

function tenantStatusLabel(
  status: string,
  t: ReturnType<typeof useTranslation>['t']
) {
  return status === 'active' ? t('Active') : t('Disabled')
}

const reconciliationIssueLabels: Record<string, string> = {
  active_owner_missing: 'Active tenant has no owner',
  multiple_active_owners: 'Tenant has multiple active owners',
  invalid_balance_transfer: 'Invalid balance transfer entry',
  invalid_withdrawal_status: 'Invalid withdrawal status',
  invalid_withdrawal_amount: 'Invalid withdrawal amount',
  missing_payout_snapshot: 'Missing payout account snapshot',
  paid_withdrawal_incomplete: 'Paid withdrawal is incomplete',
  multiple_open_withdrawals: 'Multiple open withdrawals',
  debits_exceed_settled_income:
    'Transfers or withdrawals exceed settled income',
}

export function TenantFinanceOverview() {
  const { t } = useTranslation()
  const financeQuery = useQuery({
    queryKey: tenantAdminFinanceQueryKey,
    queryFn: getHubAdminTenantFinance,
  })
  const items = financeQuery.data?.data?.items ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Tenant finance overview')}</CardTitle>
        <CardDescription>
          {t(
            'Read-only view of earnings and settlement balances across all tenants.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='p-0'>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Tenant')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead>{t('Settled earnings')}</TableHead>
                <TableHead>{t('Pending tenant earnings')}</TableHead>
                <TableHead>{t('Withdrawable')}</TableHead>
                <TableHead>{t('Transferred to balance')}</TableHead>
                <TableHead>{t('Total withdrawn')}</TableHead>
                <TableHead>{t('Platform fee')}</TableHead>
                <TableHead>{t('Reconciliation')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {financeQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className='h-24 text-center'>
                    <Loader2 className='mx-auto animate-spin' />
                  </TableCell>
                </TableRow>
              )}
              {!financeQuery.isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className='text-muted-foreground h-24 text-center'
                  >
                    {t('No tenants found')}
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => (
                <TableRow key={item.tenant_id}>
                  <TableCell>
                    <div className='min-w-40'>
                      <p className='font-medium'>{item.tenant_name}</p>
                      <p className='text-muted-foreground text-xs'>
                        {item.tenant_slug}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        item.tenant_status === 'active'
                          ? 'default'
                          : 'secondary'
                      }
                    >
                      {tenantStatusLabel(item.tenant_status, t)}
                    </Badge>
                  </TableCell>
                  <TableCell className='whitespace-nowrap tabular-nums'>
                    {formatQuota(item.summary.settled_income_quota)}
                  </TableCell>
                  <TableCell className='whitespace-nowrap tabular-nums'>
                    {formatQuota(item.summary.pending_income_quota)}
                  </TableCell>
                  <TableCell className='font-medium whitespace-nowrap tabular-nums'>
                    {formatQuota(item.summary.withdrawable_quota)}
                  </TableCell>
                  <TableCell className='whitespace-nowrap tabular-nums'>
                    {formatQuota(item.summary.transferred_balance_quota)}
                  </TableCell>
                  <TableCell className='whitespace-nowrap tabular-nums'>
                    {formatQuota(item.summary.paid_withdrawal_quota)}
                  </TableCell>
                  <TableCell className='whitespace-nowrap tabular-nums'>
                    {formatQuota(item.summary.platform_fee_quota)}
                  </TableCell>
                  <TableCell>
                    {item.reconciliation.reconciled ? (
                      <Badge variant='default' className='gap-1'>
                        <CheckCircle2 />
                        {t('Reconciled')}
                      </Badge>
                    ) : (
                      <div className='flex min-w-56 flex-col gap-1'>
                        <Badge variant='destructive' className='w-fit gap-1'>
                          <AlertTriangle />
                          {t('Needs review')}
                        </Badge>
                        <div className='text-muted-foreground text-xs'>
                          {item.reconciliation.issues.map((issue) => (
                            <p key={issue}>
                              {t(reconciliationIssueLabels[issue] || issue)}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
