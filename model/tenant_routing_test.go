package model

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
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
		TenantId: activeTenant.Id, Host: "brand.example",
		VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive,
	}).Error)
	require.NoError(t, db.Create(&TenantDomain{
		TenantId: pendingTenant.Id, Host: "pending.example",
		VerificationStatus: TenantDomainVerificationPending, Status: TenantDomainStatusActive,
	}).Error)
	require.NoError(t, db.Create(&TenantDomain{
		TenantId: disabledTenant.Id, Host: "disabled.example",
		VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive,
	}).Error)

	resolution, err := ResolveTenantHost("BRAND.EXAMPLE:443")
	require.NoError(t, err)
	assert.True(t, resolution.IsConfigured)
	assert.True(t, resolution.IsTenantHost)
	assert.Equal(t, activeTenant.Id, resolution.TenantID)
	assert.Equal(t, "brand.example", resolution.Host)

	resolution, err = ResolveTenantHost("pending.example")
	require.NoError(t, err)
	assert.True(t, resolution.IsConfigured)
	assert.False(t, resolution.IsTenantHost)

	resolution, err = ResolveTenantHost("disabled.example")
	require.NoError(t, err)
	assert.True(t, resolution.IsConfigured)
	assert.False(t, resolution.IsTenantHost)

	resolution, err = ResolveTenantHost("unknown.example")
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

func TestResolveTenantHostUsesPublishedCacheWhenMemoryEnabled(t *testing.T) {
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})

	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Tenant{}, &TenantDomain{}, &HubProvider{}))
	tenant := Tenant{Name: "Cached tenant", Slug: "cached-tenant", Status: TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	domain := TenantDomain{
		TenantId: tenant.Id, Host: "cached-tenant.example",
		VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive,
	}
	require.NoError(t, db.Create(&domain).Error)
	require.NoError(t, ValidateTenantRoutingConfiguration())
	require.NoError(t, RefreshHubSupplyPricingCache())

	resolution, err := ResolveTenantHost(domain.Host)
	require.NoError(t, err)
	assert.True(t, resolution.IsTenantHost)

	require.NoError(t, db.Model(&domain).Update("status", TenantDomainStatusDisabled).Error)
	resolution, err = ResolveTenantHost(domain.Host)
	require.NoError(t, err)
	assert.True(t, resolution.IsTenantHost, "published cache should remain stable until refresh")

	invalidDomain := TenantDomain{
		TenantId: tenant.Id, Host: "unsupported.cached-tenant.example",
		VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive,
	}
	require.NoError(t, db.Create(&invalidDomain).Error)
	require.Error(t, ValidateTenantRoutingConfiguration())
	require.Error(t, RefreshHubSupplyPricingCache())
	resolution, err = ResolveTenantHost(domain.Host)
	require.NoError(t, err)
	assert.True(t, resolution.IsTenantHost, "a failed refresh must preserve the complete previous generation")
	require.NoError(t, db.Delete(&invalidDomain).Error)

	require.NoError(t, RefreshHubSupplyPricingCache())
	resolution, err = ResolveTenantHost(domain.Host)
	require.NoError(t, err)
	assert.True(t, resolution.IsConfigured)
	assert.False(t, resolution.IsTenantHost)
}

func TestNormalizeTenantRootDomainRequiresExactlyTwoLabels(t *testing.T) {
	for input, expected := range map[string]string{
		"LLM-Hub.Store":    "llm-hub.store",
		"343246113.xyz":    "343246113.xyz",
		"example.com.":     "example.com",
		"single-letter.io": "single-letter.io",
	} {
		host, err := NormalizeTenantRootDomain(input)
		require.NoError(t, err, input)
		assert.Equal(t, expected, host, input)
	}

	for _, input := range []string{
		"sub.example.com",
		"example.com.cn",
		"example.com:443",
		"https://example.com",
		"*.example.com",
		"-invalid.com",
		"invalid-.com",
		"invalid_name.com",
		"example.com..",
		"localhost",
		"127.0",
		"127.0.0.1",
	} {
		_, err := NormalizeTenantRootDomain(input)
		assert.ErrorIs(t, err, ErrTenantHostInvalid, input)
	}
}

func TestInvalidConfiguredProviderRootDomainFailsValidation(t *testing.T) {
	t.Setenv("HUB_PROVIDER_ROOT_DOMAIN", "sub.example.com")
	assert.Equal(t, defaultHubProviderRootDomain, HubProviderRootDomain())
	require.Error(t, ValidateTenantRoutingConfiguration())
}
