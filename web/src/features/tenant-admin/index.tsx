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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Globe2, Plus, Power, ShieldCheck, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TenantBrandEditor } from '@/features/tenant-brand/brand-editor'
import type { TenantBrand } from '@/features/tenant-brand/types'
import { searchUsers } from '@/features/users/api'
import type { User } from '@/features/users/types'

import {
  createHubAdminTenant,
  createHubAdminTenantDomain,
  tenantAdminQueryKey,
  getHubAdminTenants,
  updateHubAdminTenantDomain,
  updateHubAdminTenantMember,
  updateHubAdminTenantSettlementSettings,
  updateHubAdminTenantStatus,
  updateHubAdminTenantBrand,
  upsertHubAdminTenantMember,
} from './api'
import { TenantFinanceOverview } from './finance-overview'
import { TenantPlatformFeeEditor } from './platform-fee-editor'
import type { TenantAdminTenant } from './types'

const EMPTY_TENANTS: TenantAdminTenant[] = []

function statusBadge(
  status: string,
  t: ReturnType<typeof useTranslation>['t']
) {
  return status === 'active' ? (
    <Badge variant='default'>{t('Active')}</Badge>
  ) : (
    <Badge variant='secondary'>{t('Disabled')}</Badge>
  )
}

function formClassName() {
  return 'grid gap-2'
}

export function TenantAdmin() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null)
  const [tenantName, setTenantName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [domainHost, setDomainHost] = useState('')
  const [domainPrimary, setDomainPrimary] = useState(true)
  const [domainTrusted, setDomainTrusted] = useState(true)
  const [userKeyword, setUserKeyword] = useState('')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [memberRole, setMemberRole] = useState('owner')

  const tenantsQuery = useQuery({
    queryKey: tenantAdminQueryKey,
    queryFn: getHubAdminTenants,
  })
  const tenantItems = tenantsQuery.data?.data?.items
  const tenants = tenantItems ?? EMPTY_TENANTS
  const selectedTenant = useMemo(
    () => tenantItems?.find((tenant) => tenant.id === selectedTenantId) ?? null,
    [selectedTenantId, tenantItems]
  )

  useEffect(() => {
    if (selectedTenantId === null && tenantItems && tenantItems.length > 0) {
      setSelectedTenantId(tenantItems[0].id)
    }
  }, [selectedTenantId, tenantItems])

  const usersQuery = useQuery({
    queryKey: ['tenant-admin-user-search', userKeyword],
    queryFn: () =>
      searchUsers({ keyword: userKeyword, status: '1', page_size: 8 }),
    enabled: userKeyword.trim().length >= 1,
    staleTime: 30 * 1000,
  })
  const userResults = usersQuery.data?.data?.items ?? []

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: tenantAdminQueryKey })
  }

  const createTenantMutation = useMutation({
    mutationFn: createHubAdminTenant,
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Request failed'))
        return
      }
      await refresh()
      if (response.data) setSelectedTenantId(response.data.id)
      setTenantName('')
      setTenantSlug('')
      toast.success(t('Tenant created'))
    },
    onError: (error) => toast.error(error.message || t('Request failed')),
  })

  const updateTenantStatusMutation = useMutation({
    mutationFn: ({ tenantId, status }: { tenantId: number; status: string }) =>
      updateHubAdminTenantStatus(tenantId, status),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Request failed'))
        return
      }
      await refresh()
      toast.success(t('Tenant status updated'))
    },
    onError: (error) => toast.error(error.message || t('Request failed')),
  })

  const updateTenantSettlementMutation = useMutation({
    mutationFn: ({
      tenantId,
      platformFeeBasisPoints,
    }: {
      tenantId: number
      platformFeeBasisPoints: number | null
    }) =>
      updateHubAdminTenantSettlementSettings(tenantId, {
        platform_fee_basis_points: platformFeeBasisPoints,
      }),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Request failed'))
        return
      }
      await refresh()
      toast.success(t('Setting updated successfully'))
    },
    onError: (error) => toast.error(error.message || t('Request failed')),
  })

  const updateTenantBrandMutation = useMutation({
    mutationFn: ({
      tenantId,
      brand,
      logoFile,
    }: {
      tenantId: number
      brand: TenantBrand
      logoFile?: File
    }) => updateHubAdminTenantBrand(tenantId, brand, logoFile),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Request failed'))
        return
      }
      await refresh()
      toast.success(t('Brand saved'))
    },
    onError: (error) => toast.error(error.message || t('Request failed')),
  })

  const createDomainMutation = useMutation({
    mutationFn: (input: {
      tenantId: number
      host: string
      isPrimary: boolean
      trusted: boolean
    }) =>
      createHubAdminTenantDomain(input.tenantId, {
        host: input.host,
        is_primary: input.isPrimary,
        trusted: input.trusted,
      }),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Request failed'))
        return
      }
      await refresh()
      setDomainHost('')
      toast.success(t('Domain added'))
    },
    onError: (error) => toast.error(error.message || t('Request failed')),
  })

  const updateDomainMutation = useMutation({
    mutationFn: ({
      tenantId,
      domainId,
      input,
    }: {
      tenantId: number
      domainId: number
      input: { status?: string; verification_status?: string }
    }) => updateHubAdminTenantDomain(tenantId, domainId, input),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Request failed'))
        return
      }
      await refresh()
      toast.success(t('Domain updated'))
    },
    onError: (error) => toast.error(error.message || t('Request failed')),
  })

  const upsertMemberMutation = useMutation({
    mutationFn: ({
      tenantId,
      userId,
      role,
    }: {
      tenantId: number
      userId: number
      role: string
    }) => upsertHubAdminTenantMember(tenantId, { user_id: userId, role }),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Request failed'))
        return
      }
      await refresh()
      setSelectedUser(null)
      setUserKeyword('')
      toast.success(t('Tenant administrator assigned'))
    },
    onError: (error) => toast.error(error.message || t('Request failed')),
  })

  const updateMemberMutation = useMutation({
    mutationFn: ({
      tenantId,
      userId,
      input,
    }: {
      tenantId: number
      userId: number
      input: { status?: string; role?: string }
    }) => updateHubAdminTenantMember(tenantId, userId, input),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message || t('Request failed'))
        return
      }
      await refresh()
      toast.success(t('Tenant administrator updated'))
    },
    onError: (error) => toast.error(error.message || t('Request failed')),
  })

  const isBusy =
    createTenantMutation.isPending ||
    updateTenantStatusMutation.isPending ||
    updateTenantSettlementMutation.isPending ||
    updateTenantBrandMutation.isPending ||
    createDomainMutation.isPending ||
    updateDomainMutation.isPending ||
    upsertMemberMutation.isPending ||
    updateMemberMutation.isPending

  const renderTenantList = () => {
    if (tenantsQuery.isLoading) {
      return <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
    }
    if (tenants.length === 0) {
      return (
        <p className='text-muted-foreground text-sm'>{t('No tenants found')}</p>
      )
    }
    return tenants.map((tenant) => (
      <div
        key={tenant.id}
        className={`flex items-center gap-2 rounded-lg border p-2 ${selectedTenantId === tenant.id ? 'border-primary bg-muted/40' : ''}`}
      >
        <button
          type='button'
          className='min-w-0 flex-1 text-left'
          onClick={() => setSelectedTenantId(tenant.id)}
        >
          <span className='block truncate font-medium'>{tenant.name}</span>
          <span className='text-muted-foreground block truncate text-xs'>
            {tenant.slug}
          </span>
        </button>
        {statusBadge(tenant.status, t)}
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          disabled={isBusy}
          onClick={() =>
            updateTenantStatusMutation.mutate({
              tenantId: tenant.id,
              status: tenant.status === 'active' ? 'disabled' : 'active',
            })
          }
          aria-label={tenant.status === 'active' ? t('Disable') : t('Enable')}
        >
          <Power />
        </Button>
      </div>
    ))
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Tenant Administration')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='h-full min-h-0 overflow-y-auto'>
          <div className='mx-auto grid max-w-7xl gap-4 pb-6'>
            <Alert>
              <ShieldCheck />
              <AlertTitle>{t('Internal tenant access')}</AlertTitle>
              <AlertDescription>
                {t(
                  'Add a trusted domain and assign an owner or admin user before testing the tenant portal.'
                )}
              </AlertDescription>
            </Alert>

            <TenantFinanceOverview />

            <div className='grid gap-4 xl:grid-cols-[minmax(280px,0.7fr)_minmax(0,1.3fr)]'>
              <Card>
                <CardHeader>
                  <CardTitle>{t('Tenants')}</CardTitle>
                  <CardDescription>
                    {t(
                      'Create and select the tenant for domain and member setup.'
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className='grid gap-4'>
                  <form
                    className='grid gap-3 rounded-lg border p-3'
                    onSubmit={(event) => {
                      event.preventDefault()
                      createTenantMutation.mutate({
                        name: tenantName,
                        slug: tenantSlug,
                      })
                    }}
                  >
                    <div className={formClassName()}>
                      <Label htmlFor='tenant-name'>{t('Tenant name')}</Label>
                      <Input
                        id='tenant-name'
                        value={tenantName}
                        onChange={(event) => setTenantName(event.target.value)}
                        required
                      />
                    </div>
                    <div className={formClassName()}>
                      <Label htmlFor='tenant-slug'>{t('Tenant slug')}</Label>
                      <Input
                        id='tenant-slug'
                        value={tenantSlug}
                        onChange={(event) => setTenantSlug(event.target.value)}
                        placeholder='aiproxy'
                        required
                      />
                    </div>
                    <Button
                      type='submit'
                      disabled={
                        isBusy || !tenantName.trim() || !tenantSlug.trim()
                      }
                    >
                      <Plus />
                      {t('Create tenant')}
                    </Button>
                  </form>

                  <div className='grid gap-1'>{renderTenantList()}</div>
                </CardContent>
              </Card>

              {selectedTenant ? (
                <TenantDetails
                  tenant={selectedTenant}
                  domainHost={domainHost}
                  setDomainHost={setDomainHost}
                  domainPrimary={domainPrimary}
                  setDomainPrimary={setDomainPrimary}
                  domainTrusted={domainTrusted}
                  setDomainTrusted={setDomainTrusted}
                  userKeyword={userKeyword}
                  setUserKeyword={setUserKeyword}
                  selectedUser={selectedUser}
                  setSelectedUser={setSelectedUser}
                  userResults={userResults}
                  memberRole={memberRole}
                  setMemberRole={setMemberRole}
                  isBusy={isBusy}
                  onAddDomain={() =>
                    createDomainMutation.mutate({
                      tenantId: selectedTenant.id,
                      host: domainHost,
                      isPrimary: domainPrimary,
                      trusted: domainTrusted,
                    })
                  }
                  onUpdateDomain={(domainId, input) =>
                    updateDomainMutation.mutate({
                      tenantId: selectedTenant.id,
                      domainId,
                      input,
                    })
                  }
                  onAddMember={() => {
                    if (selectedUser) {
                      upsertMemberMutation.mutate({
                        tenantId: selectedTenant.id,
                        userId: selectedUser.id,
                        role: memberRole,
                      })
                    }
                  }}
                  onUpdateMember={(userId, input) =>
                    updateMemberMutation.mutate({
                      tenantId: selectedTenant.id,
                      userId,
                      input,
                    })
                  }
                  onUpdateBrand={(brand, logoFile) =>
                    updateTenantBrandMutation.mutate({
                      tenantId: selectedTenant.id,
                      brand,
                      logoFile,
                    })
                  }
                  onUpdateSettlement={(platformFeeBasisPoints) =>
                    updateTenantSettlementMutation.mutate({
                      tenantId: selectedTenant.id,
                      platformFeeBasisPoints,
                    })
                  }
                />
              ) : (
                <Card className='flex min-h-60 items-center justify-center'>
                  <p className='text-muted-foreground text-sm'>
                    {t('Select a tenant to continue')}
                  </p>
                </Card>
              )}
            </div>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function TenantDetails(props: {
  tenant: TenantAdminTenant
  domainHost: string
  setDomainHost: (value: string) => void
  domainPrimary: boolean
  setDomainPrimary: (value: boolean) => void
  domainTrusted: boolean
  setDomainTrusted: (value: boolean) => void
  userKeyword: string
  setUserKeyword: (value: string) => void
  selectedUser: User | null
  setSelectedUser: (user: User | null) => void
  userResults: User[]
  memberRole: string
  setMemberRole: (value: string) => void
  isBusy: boolean
  onAddDomain: () => void
  onUpdateDomain: (
    domainId: number,
    input: { status?: string; verification_status?: string }
  ) => void
  onAddMember: () => void
  onUpdateMember: (
    userId: number,
    input: { status?: string; role?: string }
  ) => void
  onUpdateBrand: (brand: TenantBrand, logoFile?: File) => void
  onUpdateSettlement: (platformFeeBasisPoints: number | null) => void
}) {
  const { t } = useTranslation()
  return (
    <div className='grid gap-4'>
      <TenantPlatformFeeEditor
        tenant={props.tenant}
        isBusy={props.isBusy}
        onSave={props.onUpdateSettlement}
      />
      <TenantBrandEditor
        brand={props.tenant.brand}
        saving={props.isBusy}
        onSave={props.onUpdateBrand}
      />
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Globe2 />
            {props.tenant.name}
          </CardTitle>
          <CardDescription>
            {props.tenant.slug} · {statusBadge(props.tenant.status, t)}
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4 lg:grid-cols-2'>
          <div className='grid gap-3 rounded-lg border p-3'>
            <div>
              <h3 className='font-medium'>{t('Trusted domains')}</h3>
              <p className='text-muted-foreground text-xs'>
                {t('Only active and trusted domains can enter this tenant.')}
              </p>
            </div>
            {props.tenant.domains.map((domain) => (
              <div
                key={domain.id}
                className='flex items-center gap-2 rounded-md border p-2'
              >
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm'>{domain.host}</div>
                  <div className='text-muted-foreground flex flex-wrap gap-1 text-xs'>
                    {domain.is_primary && <span>{t('Primary')}</span>}
                    <span>{domain.verification_status}</span>
                    <span>{domain.status}</span>
                  </div>
                </div>
                {domain.verification_status !== 'verified' && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={props.isBusy}
                    onClick={() =>
                      props.onUpdateDomain(domain.id, {
                        verification_status: 'verified',
                      })
                    }
                  >
                    <Check />
                    {t('Trust')}
                  </Button>
                )}
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  disabled={props.isBusy}
                  onClick={() =>
                    props.onUpdateDomain(domain.id, {
                      status:
                        domain.status === 'active' ? 'disabled' : 'active',
                    })
                  }
                  aria-label={
                    domain.status === 'active' ? t('Disable') : t('Enable')
                  }
                >
                  <Power />
                </Button>
              </div>
            ))}
            <form
              className='grid gap-3 border-t pt-3'
              onSubmit={(event) => {
                event.preventDefault()
                props.onAddDomain()
              }}
            >
              <div className='grid gap-2'>
                <Label htmlFor='tenant-domain'>{t('Domain')}</Label>
                <Input
                  id='tenant-domain'
                  value={props.domainHost}
                  onChange={(event) => props.setDomainHost(event.target.value)}
                  placeholder='aiproxy.example.com'
                  required
                />
              </div>
              <div className='flex items-center justify-between gap-3'>
                <Label htmlFor='tenant-domain-primary'>
                  {t('Primary domain')}
                </Label>
                <Switch
                  id='tenant-domain-primary'
                  checked={props.domainPrimary}
                  onCheckedChange={props.setDomainPrimary}
                />
              </div>
              <div className='flex items-center justify-between gap-3'>
                <Label htmlFor='tenant-domain-trusted'>
                  {t('Trust domain now')}
                </Label>
                <Switch
                  id='tenant-domain-trusted'
                  checked={props.domainTrusted}
                  onCheckedChange={props.setDomainTrusted}
                />
              </div>
              <Button
                type='submit'
                disabled={props.isBusy || !props.domainHost.trim()}
              >
                <Plus />
                {t('Add domain')}
              </Button>
            </form>
          </div>

          <div className='grid gap-3 rounded-lg border p-3'>
            <div>
              <h3 className='font-medium'>{t('Tenant administrators')}</h3>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'An active owner or admin can use the trusted tenant domain.'
                )}
              </p>
            </div>
            {props.tenant.members.map((member) => (
              <div
                key={member.id}
                className='flex items-center gap-2 rounded-md border p-2'
              >
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm'>
                    {member.display_name || member.username}
                  </div>
                  <div className='text-muted-foreground truncate text-xs'>
                    #{member.user_id} · {member.username}
                  </div>
                </div>
                <select
                  className='border-input bg-background h-8 rounded-lg border px-2 text-sm'
                  value={member.role}
                  disabled={props.isBusy}
                  onChange={(event) =>
                    props.onUpdateMember(member.user_id, {
                      role: event.target.value,
                    })
                  }
                  aria-label={t('Role')}
                >
                  <option value='owner'>{t('Tenant owner')}</option>
                  <option value='admin'>{t('Tenant admin')}</option>
                </select>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  disabled={props.isBusy}
                  onClick={() =>
                    props.onUpdateMember(member.user_id, {
                      status:
                        member.status === 'active' ? 'disabled' : 'active',
                    })
                  }
                  aria-label={
                    member.status === 'active' ? t('Disable') : t('Enable')
                  }
                >
                  <Power />
                </Button>
                {statusBadge(member.status, t)}
              </div>
            ))}
            <div className='grid gap-3 border-t pt-3'>
              <div className='grid gap-2'>
                <Label htmlFor='tenant-user-search'>{t('Find user')}</Label>
                <Input
                  id='tenant-user-search'
                  value={props.userKeyword}
                  onChange={(event) => {
                    props.setUserKeyword(event.target.value)
                    props.setSelectedUser(null)
                  }}
                  placeholder={t('Search by username, email, or user ID')}
                />
              </div>
              {props.userResults.length > 0 && !props.selectedUser && (
                <div className='grid gap-1 rounded-md border p-1'>
                  {props.userResults.map((user) => (
                    <button
                      type='button'
                      key={user.id}
                      className='hover:bg-muted flex items-center gap-2 rounded-md p-2 text-left text-sm'
                      onClick={() => {
                        props.setSelectedUser(user)
                        props.setUserKeyword(user.username)
                      }}
                    >
                      <span className='min-w-0 flex-1 truncate'>
                        {user.display_name || user.username}
                      </span>
                      <span className='text-muted-foreground text-xs'>
                        #{user.id} · {user.username}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {props.selectedUser && (
                <div className='bg-muted/40 flex items-center gap-2 rounded-md border p-2 text-sm'>
                  <UserPlus className='size-4' />
                  <span className='min-w-0 flex-1 truncate'>
                    {props.selectedUser.display_name ||
                      props.selectedUser.username}{' '}
                    #{props.selectedUser.id}
                  </span>
                  <select
                    className='border-input bg-background h-8 rounded-lg border px-2 text-sm'
                    value={props.memberRole}
                    onChange={(event) =>
                      props.setMemberRole(event.target.value)
                    }
                    aria-label={t('Role')}
                  >
                    <option value='owner'>{t('Tenant owner')}</option>
                    <option value='admin'>{t('Tenant admin')}</option>
                  </select>
                  <Button
                    type='button'
                    size='sm'
                    disabled={props.isBusy}
                    onClick={props.onAddMember}
                  >
                    {t('Assign')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
