package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTenantPublicationExcludesAndRestoresRoutingCandidate(t *testing.T) {
	truncateTables(t)
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		InitChannelCache()
	})
	common.MemoryCacheEnabled = true
	InitChannelCache()

	provider := &HubProvider{OwnerUserId: 9101, Name: "Publication provider", Slug: "publication-provider"}
	require.NoError(t, DB.Create(provider).Error)
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "publication-key", Name: "publication-channel",
		Models: "gpt-publication", Group: "default", Status: common.ChannelStatusEnabled,
	}
	group := &HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 1, Status: HubSupplyGroupStatusAvailable,
		TenantPublished: true,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-publication").First(&target).Error)
	require.NoError(t, DB.Model(&target).Updates(map[string]any{
		"status":          HubSupplyProbeStatusAvailable,
		"last_success_at": common.GetTimestamp(),
	}).Error)
	priority := int64(0)
	require.NoError(t, DB.Create(&Ability{
		Group: hub_routing_setting.ServiceTierSpecial, Model: "gpt-publication", ChannelId: channel.Id,
		Enabled: true, Priority: &priority, Weight: 100,
	}).Error)
	InitChannelCache()

	selected, err := GetRandomSatisfiedChannel(hub_routing_setting.ServiceTierSpecial, "gpt-publication", 0, "/v1/chat/completions", nil)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, channel.Id, selected.Id)

	require.NoError(t, UpdateHubSupplyGroupTenantPublication([]int{channel.Id}, false))
	assert.False(t, IsHubSupplyChannelTenantPublished(channel.Id))
	selected, err = GetRandomSatisfiedChannel(hub_routing_setting.ServiceTierSpecial, "gpt-publication", 0, "/v1/chat/completions", nil)
	require.NoError(t, err)
	assert.Nil(t, selected)

	common.MemoryCacheEnabled = false
	selected, err = GetRandomSatisfiedChannel(hub_routing_setting.ServiceTierSpecial, "gpt-publication", 0, "/v1/chat/completions", nil)
	require.NoError(t, err)
	assert.Nil(t, selected)

	require.NoError(t, UpdateHubSupplyGroupTenantPublication([]int{channel.Id}, true))
	common.MemoryCacheEnabled = true
	InitChannelCache()
	selected, err = GetRandomSatisfiedChannel(hub_routing_setting.ServiceTierSpecial, "gpt-publication", 0, "/v1/chat/completions", nil)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, channel.Id, selected.Id)
}

func TestTenantPublicationBatchUpdateIsAtomicForMissingSupplyGroup(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{OwnerUserId: 9102, Name: "Batch publication provider", Slug: "batch-publication-provider"}
	require.NoError(t, DB.Create(provider).Error)
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "batch-publication-key", Name: "batch-publication-channel",
		Models: "gpt-batch-publication", Group: "default", Status: common.ChannelStatusEnabled,
	}
	group := &HubSupplyGroup{ProviderId: provider.Id, PriceMultiplier: 1, Status: HubSupplyGroupStatusAvailable}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	err := UpdateHubSupplyGroupTenantPublication([]int{channel.Id, 999999}, false)
	require.ErrorIs(t, err, ErrHubSupplyGroupNotFound)
	stored, err := GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.True(t, stored.TenantPublished)
}
