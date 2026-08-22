package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTenantScopeSeparatesPlatformAndTenantProviders(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Tenant{}, &HubProvider{}))

	tenantA := Tenant{Name: "Tenant A", Slug: "tenant-a", Status: TenantStatusActive}
	tenantB := Tenant{Name: "Tenant B", Slug: "tenant-b", Status: TenantStatusActive}
	require.NoError(t, db.Create(&tenantA).Error)
	require.NoError(t, db.Create(&tenantB).Error)

	providerA := HubProvider{OwnerUserId: 101, Slot: 1, TenantId: &tenantA.Id, Name: "Provider A", Slug: "provider-a"}
	providerB := HubProvider{OwnerUserId: 102, Slot: 1, TenantId: &tenantB.Id, Name: "Provider B", Slug: "provider-b"}
	platformProvider := HubProvider{OwnerUserId: 103, Slot: 1, Name: "Platform provider", Slug: "platform-provider"}
	require.NoError(t, db.Create(&providerA).Error)
	require.NoError(t, db.Create(&providerB).Error)
	require.NoError(t, db.Create(&platformProvider).Error)

	stored, err := GetHubProviderByIDInTenant(providerA.Id, &tenantA.Id)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, providerA.Id, stored.Id)

	stored, err = GetHubProviderByIDInTenant(providerA.Id, &tenantB.Id)
	require.NoError(t, err)
	assert.Nil(t, stored)

	stored, err = GetHubProviderByIDInTenant(platformProvider.Id, nil)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, platformProvider.Id, stored.Id)

	stored, err = GetHubProviderByIDInTenant(platformProvider.Id, &tenantA.Id)
	require.NoError(t, err)
	assert.Nil(t, stored)
}

func TestGetActiveTenantMemberRejectsDisabledMembers(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Tenant{}, &TenantMember{}))
	tenant := Tenant{Name: "Tenant A", Slug: "tenant-a", Status: TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	require.NoError(t, db.Create(&TenantMember{
		TenantId: tenant.Id,
		UserId:   101,
		Role:     TenantMemberRoleOwner,
		Status:   TenantMemberStatusDisabled,
	}).Error)
	require.NoError(t, db.Create(&TenantMember{
		TenantId: tenant.Id,
		UserId:   102,
		Role:     TenantMemberRoleAdmin,
		Status:   TenantMemberStatusActive,
	}).Error)

	member, err := GetActiveTenantMember(tenant.Id, 101)
	assert.ErrorIs(t, err, ErrTenantMemberNotFound)
	assert.Nil(t, member)

	member, err = GetActiveTenantMember(tenant.Id, 102)
	require.NoError(t, err)
	require.NotNil(t, member)
	assert.True(t, IsTenantAdminRole(member.Role))
	assert.False(t, IsTenantAdminRole("viewer"))
}

func TestGetActiveTenantMemberRejectsMembersOfDisabledTenant(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Tenant{}, &TenantMember{}))
	tenant := Tenant{Name: "Disabled tenant", Slug: "disabled-tenant", Status: TenantStatusDisabled}
	require.NoError(t, db.Create(&tenant).Error)
	require.NoError(t, db.Create(&TenantMember{
		TenantId: tenant.Id,
		UserId:   101,
		Role:     TenantMemberRoleOwner,
		Status:   TenantMemberStatusActive,
	}).Error)

	member, err := GetActiveTenantMember(tenant.Id, 101)
	assert.ErrorIs(t, err, ErrTenantMemberNotFound)
	assert.Nil(t, member)
}
