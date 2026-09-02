package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMigrateHubTokenScopesBackfillsProviderAndRootTokens(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Tenant{}, &TenantDomain{}, &HubProvider{}))
	rootTenant := Tenant{Id: 10, Name: "Root tenant", Slug: "root", Status: TenantStatusActive}
	require.NoError(t, db.Create(&rootTenant).Error)
	require.NoError(t, db.Create(&TenantDomain{
		TenantId: 10, Host: HubProviderRootDomain(), IsPrimary: true,
		VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive,
	}).Error)
	providerTenantID := 20
	provider := HubProvider{
		OwnerUserId: 2, TenantId: &providerTenantID, Name: "Provider", Slug: "provider-one",
		Website: "https://provider.example", Description: "", LogoURL: "",
	}
	require.NoError(t, db.Create(&provider).Error)
	require.NoError(t, db.AutoMigrate(&Token{}))

	providerPolicy := &HubTokenRoutingPolicy{
		Mode: HubTokenRoutingModeProvider, ProviderID: provider.Id,
		Selections: []HubTokenRoutingSelection{{Family: "openai", ExactMultipliers: []float64{1}}},
	}
	policyJSON, err := common.Marshal(providerPolicy)
	require.NoError(t, err)
	require.NoError(t, db.Create(&Token{UserId: 1, Key: "provider-legacy", HubRoutingPolicy: string(policyJSON)}).Error)
	require.NoError(t, db.Create(&Token{UserId: 1, Key: "root-legacy"}).Error)

	require.NoError(t, migrateHubTokenScopes())
	require.NoError(t, migrateHubTokenScopes())

	var migratedProvider, migratedRoot Token
	require.NoError(t, db.Where("key = ?", "provider-legacy").First(&migratedProvider).Error)
	require.NoError(t, db.Where("key = ?", "root-legacy").First(&migratedRoot).Error)
	assert.Equal(t, providerTenantID, migratedProvider.HubTenantId)
	assert.Equal(t, provider.Id, migratedProvider.HubProviderId)
	assert.Equal(t, 10, migratedRoot.HubTenantId)
	assert.Zero(t, migratedRoot.HubProviderId)
}
