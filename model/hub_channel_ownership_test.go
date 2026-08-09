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

	providerA := HubProvider{OwnerUserId: 101, Slot: 1, Name: "Provider A"}
	providerB := HubProvider{OwnerUserId: 102, Slot: 1, Name: "Provider B"}
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
