package model

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveHubProviderHost(t *testing.T) {
	truncateTables(t)
	t.Setenv("HUB_PROVIDER_ROOT_DOMAIN", "llm-hub.store")
	provider := &HubProvider{OwnerUserId: 94001, Name: "LLM Routers", Slug: "llm-routers"}
	require.NoError(t, CreateHubProvider(provider))

	for _, host := range []string{"llm-hub.store", "localhost:3100", "127.0.0.1:3100", "api.llm-hub.store"} {
		resolution, err := ResolveHubProviderHost(host)
		require.NoError(t, err, host)
		assert.False(t, resolution.IsProviderHost, host)
	}

	for _, host := range []string{"llm-routers.llm-hub.store", "llm-routers.localhost:3100"} {
		resolution, err := ResolveHubProviderHost(host)
		require.NoError(t, err, host)
		require.True(t, resolution.IsProviderHost, host)
		assert.Equal(t, provider.Id, resolution.Provider.Id)
		assert.Equal(t, "llm-routers", resolution.Provider.Slug)
	}

	_, err := ResolveHubProviderHost("missing-provider.llm-hub.store")
	assert.True(t, errors.Is(err, ErrHubProviderHostNotFound))
	_, err = ResolveHubProviderHost("nested.llm-routers.llm-hub.store")
	assert.True(t, errors.Is(err, ErrHubProviderHostInvalid))
}

func TestResolveHubProviderHostReturnsDisabledProviderForMiddlewareDecision(t *testing.T) {
	truncateTables(t)
	t.Setenv("HUB_PROVIDER_ROOT_DOMAIN", "llm-hub.store")
	provider := &HubProvider{OwnerUserId: 94002, Name: "Paused Router", Slug: "paused-router"}
	require.NoError(t, CreateHubProvider(provider))
	_, err := UpdateHubProviderStatus(provider.Id, HubProviderStatusDisabled)
	require.NoError(t, err)

	resolution, err := ResolveHubProviderHost("paused-router.llm-hub.store")
	require.NoError(t, err)
	require.True(t, resolution.IsProviderHost)
	assert.Equal(t, HubProviderStatusDisabled, resolution.Provider.Status)
}

func TestResolveHubProviderHostScopesDuplicateSlugByTenantDomain(t *testing.T) {
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&Tenant{}, &TenantDomain{}, &HubProvider{}))
	tenantA := Tenant{Name: "Tenant A", Slug: "tenant-a", Status: TenantStatusActive}
	tenantB := Tenant{Name: "Tenant B", Slug: "tenant-b", Status: TenantStatusActive}
	require.NoError(t, DB.Create(&tenantA).Error)
	require.NoError(t, DB.Create(&tenantB).Error)
	require.NoError(t, DB.Create(&[]TenantDomain{
		{TenantId: tenantA.Id, Host: "routing-a.example", IsPrimary: true, VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive},
		{TenantId: tenantB.Id, Host: "routing-b.example", IsPrimary: true, VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive},
	}).Error)
	providerA := &HubProvider{OwnerUserId: 95001, TenantId: &tenantA.Id, Name: "Provider A", Slug: "shared"}
	providerB := &HubProvider{OwnerUserId: 95002, TenantId: &tenantB.Id, Name: "Provider B", Slug: "shared"}
	require.NoError(t, CreateHubProvider(providerA))
	require.NoError(t, CreateHubProvider(providerB))
	InitChannelCache()

	resolution, err := ResolveHubProviderHost("shared.routing-a.example")
	require.NoError(t, err)
	assert.Equal(t, providerA.Id, resolution.Provider.Id)
	resolution, err = ResolveHubProviderHost("shared.routing-b.example")
	require.NoError(t, err)
	assert.Equal(t, providerB.Id, resolution.Provider.Id)

	_, err = ResolveHubProviderHost("missing.routing-b.example")
	assert.ErrorIs(t, err, ErrHubProviderHostNotFound)
	_, found := GetHubProviderRoutingBySlug("shared")
	assert.False(t, found, "a duplicate slug must be ambiguous without tenant context")
}
