package model

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveTenantHostRequiresActiveVerifiedDomainAndTenant(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Tenant{}, &TenantDomain{}))

	activeTenant := Tenant{Name: "Active tenant", Slug: "active-tenant", Status: TenantStatusActive}
	pendingTenant := Tenant{Name: "Pending tenant", Slug: "pending-tenant", Status: TenantStatusActive}
	disabledTenant := Tenant{Name: "Disabled tenant", Slug: "disabled-tenant", Status: TenantStatusDisabled}
	require.NoError(t, db.Create(&activeTenant).Error)
	require.NoError(t, db.Create(&pendingTenant).Error)
	require.NoError(t, db.Create(&disabledTenant).Error)
	require.NoError(t, db.Create(&TenantDomain{
		TenantId: activeTenant.Id, Host: "brand.example.com",
		VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive,
	}).Error)
	require.NoError(t, db.Create(&TenantDomain{
		TenantId: pendingTenant.Id, Host: "pending.example.com",
		VerificationStatus: TenantDomainVerificationPending, Status: TenantDomainStatusActive,
	}).Error)
	require.NoError(t, db.Create(&TenantDomain{
		TenantId: disabledTenant.Id, Host: "disabled.example.com",
		VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive,
	}).Error)

	resolution, err := ResolveTenantHost("BRAND.EXAMPLE.COM:443")
	require.NoError(t, err)
	assert.True(t, resolution.IsConfigured)
	assert.True(t, resolution.IsTenantHost)
	assert.Equal(t, activeTenant.Id, resolution.TenantID)
	assert.Equal(t, "brand.example.com", resolution.Host)

	resolution, err = ResolveTenantHost("pending.example.com")
	require.NoError(t, err)
	assert.True(t, resolution.IsConfigured)
	assert.False(t, resolution.IsTenantHost)

	resolution, err = ResolveTenantHost("disabled.example.com")
	require.NoError(t, err)
	assert.True(t, resolution.IsConfigured)
	assert.False(t, resolution.IsTenantHost)

	resolution, err = ResolveTenantHost("unknown.example.com")
	require.NoError(t, err)
	assert.False(t, resolution.IsConfigured)
	assert.False(t, resolution.IsTenantHost)
}

func TestResolveTenantHostInheritsProviderTenant(t *testing.T) {
	truncateTables(t)
	t.Setenv("HUB_PROVIDER_ROOT_DOMAIN", "llm-hub.store")
	require.NoError(t, DB.AutoMigrate(&Tenant{}, &TenantDomain{}, &HubProvider{}))
	tenant := Tenant{Name: "Provider tenant", Slug: "provider-tenant", Status: TenantStatusActive}
	require.NoError(t, DB.Create(&tenant).Error)
	provider := &HubProvider{
		OwnerUserId: 94003,
		TenantId:    &tenant.Id,
		Name:        "Provider",
		Slug:        "tenant-router",
		Status:      HubProviderStatusActive,
	}
	require.NoError(t, CreateHubProvider(provider))

	resolution, err := ResolveTenantHost("tenant-router.llm-hub.store")
	require.NoError(t, err)
	assert.True(t, resolution.IsConfigured)
	assert.True(t, resolution.IsTenantHost)
	assert.Equal(t, tenant.Id, resolution.TenantID)
	assert.Equal(t, "tenant-router.llm-hub.store", resolution.Host)
}

func TestResolveTenantHostRejectsLocalAndIPHosts(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Tenant{}, &TenantDomain{}))

	for _, host := range []string{"localhost:3100", "127.0.0.1:3100", "invalid-host"} {
		_, err := ResolveTenantHost(host)
		assert.True(t, errors.Is(err, ErrTenantHostInvalid), host)
	}
}
