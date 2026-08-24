package model

import (
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHubChannelOwnershipQueriesAndFilters(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Channel{}, &HubProvider{}, &HubSupplyGroup{}))

	providerA := HubProvider{OwnerUserId: 101, Slot: 1, Name: "Provider A", Slug: "provider-a"}
	providerB := HubProvider{OwnerUserId: 102, Slot: 1, Name: "Provider B", Slug: "provider-b"}
	require.NoError(t, db.Create(&providerA).Error)
	require.NoError(t, db.Create(&providerB).Error)

	channels := []Channel{
		{Name: "Platform", Key: "platform-key"},
		{Name: "Supply A", Key: "supply-a-key"},
		{Name: "Supply B", Key: "supply-b-key"},
	}
	require.NoError(t, db.Create(&channels).Error)
	require.NoError(t, db.Create(&HubSupplyGroup{
		ProviderId:      providerA.Id,
		NewAPIChannelId: channels[1].Id,
		PriceMultiplier: 0.8,
	}).Error)
	require.NoError(t, db.Create(&HubSupplyGroup{
		ProviderId:      providerB.Id,
		NewAPIChannelId: channels[2].Id,
		PriceMultiplier: 1.1,
	}).Error)

	ownership, err := GetHubChannelProviderOwnership([]int{
		channels[0].Id,
		channels[1].Id,
		channels[2].Id,
	})
	require.NoError(t, err)
	assert.NotContains(t, ownership, channels[0].Id)
	assert.Equal(t, providerA.Id, ownership[channels[1].Id].ProviderId)
	assert.Equal(t, providerB.Name, ownership[channels[2].Id].ProviderName)

	queryIDs := func(filter string) []int {
		ids := make([]int, 0)
		require.NoError(t,
			ApplyHubChannelOwnershipFilter(db.Model(&Channel{}), filter).
				Order("id ASC").
				Pluck("id", &ids).Error,
		)
		return ids
	}
	assert.Equal(t, []int{channels[0].Id}, queryIDs("platform"))
	assert.Equal(t, []int{channels[1].Id, channels[2].Id}, queryIDs("provider"))
	assert.Equal(t, []int{channels[1].Id}, queryIDs("provider:"+strconv.Itoa(providerA.Id)))

	options, err := GetHubChannelOwnershipOptions()
	require.NoError(t, err)
	assert.Equal(t, int64(1), options.PlatformChannelCount)
	assert.Equal(t, int64(2), options.ProviderChannelCount)
	require.Len(t, options.Providers, 2)
	assert.Equal(t, "Provider A", options.Providers[0].Name)
	assert.Equal(t, int64(1), options.Providers[0].ChannelCount)
}

func TestHubChannelOwnershipOptionsAreScopedToTenant(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Channel{}, &HubProvider{}, &HubSupplyGroup{}, &Tenant{}))

	tenantA := Tenant{Name: "Tenant A", Slug: "tenant-a", Status: TenantStatusActive}
	tenantB := Tenant{Name: "Tenant B", Slug: "tenant-b", Status: TenantStatusActive}
	require.NoError(t, db.Create(&tenantA).Error)
	require.NoError(t, db.Create(&tenantB).Error)
	providerA := HubProvider{OwnerUserId: 201, TenantId: &tenantA.Id, Slot: 1, Name: "Provider A", Slug: "provider-a"}
	providerB := HubProvider{OwnerUserId: 202, TenantId: &tenantB.Id, Slot: 1, Name: "Provider B", Slug: "provider-b"}
	require.NoError(t, db.Create(&providerA).Error)
	require.NoError(t, db.Create(&providerB).Error)
	channels := []Channel{
		{Name: "Tenant A supply", Key: "tenant-a-key"},
		{Name: "Tenant B supply", Key: "tenant-b-key"},
		{Name: "Platform", Key: "platform-key"},
	}
	require.NoError(t, db.Create(&channels).Error)
	require.NoError(t, db.Create(&HubSupplyGroup{ProviderId: providerA.Id, NewAPIChannelId: channels[0].Id}).Error)
	require.NoError(t, db.Create(&HubSupplyGroup{ProviderId: providerB.Id, NewAPIChannelId: channels[1].Id}).Error)

	options, err := GetHubChannelOwnershipOptionsInTenant(tenantA.Id)
	require.NoError(t, err)
	assert.Zero(t, options.PlatformChannelCount)
	assert.Equal(t, int64(1), options.ProviderChannelCount)
	require.Len(t, options.Providers, 1)
	assert.Equal(t, providerA.Id, options.Providers[0].Id)
	assert.Equal(t, int64(1), options.Providers[0].ChannelCount)
}
