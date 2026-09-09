package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveUserRegistrationSourcePrefersProviderDomain(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	previousMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		_ = RefreshHubSupplyPricingCache()
		common.MemoryCacheEnabled = previousMemoryCache
	})
	require.NoError(t, db.AutoMigrate(&Tenant{}, &TenantDomain{}, &HubProvider{}, &User{}))

	tenant := Tenant{Name: "Tenant A", Slug: "tenant-a", Status: TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	require.NoError(t, db.Create(&TenantDomain{
		TenantId: tenant.Id, Host: "tenant.example",
		VerificationStatus: TenantDomainVerificationVerified,
		Status:             TenantDomainStatusActive,
	}).Error)
	provider := &HubProvider{
		OwnerUserId: 1,
		TenantId:    &tenant.Id,
		Name:        "Provider A",
		Slug:        "provider-a",
		Status:      HubProviderStatusActive,
	}
	require.NoError(t, db.Create(provider).Error)
	require.NoError(t, RefreshHubSupplyPricingCache())

	source := ResolveUserRegistrationSource("provider-a.tenant.example")
	assert.Equal(t, RegistrationSourceProviderDomain, source.Kind)
	assert.Equal(t, tenant.Id, source.TenantID)
	assert.Equal(t, provider.Id, source.ProviderID)

	source = ResolveUserRegistrationSource("tenant.example")
	assert.Equal(t, RegistrationSourceTenantDirect, source.Kind)
	assert.Equal(t, tenant.Id, source.TenantID)
	assert.Zero(t, source.ProviderID)
}

func TestEnrichUserRegistrationSourcesLoadsNamesInBatch(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Tenant{}, &HubProvider{}, &User{}))
	tenant := Tenant{Name: "Tenant B", Slug: "tenant-b", Status: TenantStatusActive}
	provider := HubProvider{Name: "Provider B", Slug: "provider-b", OwnerUserId: 2, Status: HubProviderStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	require.NoError(t, db.Create(&provider).Error)

	users := []*User{
		{RegistrationTenantId: tenant.Id, RegistrationProviderId: provider.Id},
		{RegistrationTenantId: tenant.Id},
	}
	require.NoError(t, EnrichUserRegistrationSources(users))
	assert.Equal(t, "Tenant B", users[0].RegistrationTenantName)
	assert.Equal(t, "Provider B", users[0].RegistrationProviderName)
	assert.Equal(t, "Tenant B", users[1].RegistrationTenantName)
}
