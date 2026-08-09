package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHubTierPrerequisites(t *testing.T) {
	_, _, priced := ratio_setting.GetModelRatioOrPrice("gpt-5")
	require.True(t, priced)
	tiers := hub_routing_setting.ResolveEligibleServiceTiers("openai", 0.15, 2)
	assert.Equal(t, []string{hub_routing_setting.ServiceTierLow}, tiers)
}

func TestBuildChannelAbilitiesCreatesPriceAndHighQualityRows(t *testing.T) {
	original := *hub_routing_setting.Get()
	t.Cleanup(func() { *hub_routing_setting.Get() = original })
	hub_routing_setting.Get().Enabled = true
	hub_routing_setting.Get().HighQualityProviderIDs = []int{1}

	channel := &Channel{
		Id:     91001,
		Status: common.ChannelStatusEnabled,
		Models: "gpt-5",
		Group:  "default",
	}
	group := HubSupplyGroup{
		ProviderId:      1,
		NewAPIChannelId: channel.Id,
		PriceMultiplier: 0.08,
		PublishedModels: channel.Models,
		ConfigVersion:   1,
	}
	require.NoError(t, DB.Create(&group).Error)
	require.NoError(t, DB.Create(&HubSupplyGroupProbeTarget{
		GroupId:       group.Id,
		ConfigVersion: group.ConfigVersion,
		ModelName:     "gpt-5",
		EndpointType:  "openai",
		ProbeKind:     "text",
		Status:        HubSupplyProbeStatusAvailable,
	}).Error)
	t.Cleanup(func() {
		DB.Where("group_id = ?", group.Id).Delete(&HubSupplyGroupProbeTarget{})
		DB.Delete(&HubSupplyGroup{}, group.Id)
	})

	abilities, err := buildChannelAbilities(nil, channel)
	require.NoError(t, err)
	require.Len(t, abilities, 2)
	assert.Equal(t, hub_routing_setting.ServiceTierSpecial, abilities[0].Group)
	assert.Equal(t, hub_routing_setting.ServiceTierHigh, abilities[1].Group)
	assert.Equal(t, "gpt-5", abilities[0].Model)
	assert.Equal(t, channel.Id, abilities[1].ChannelId)
}

func TestSelectHubTierChannelStrictlyExcludesFailedChannels(t *testing.T) {
	candidates := []hubTierChannelCandidate{
		{ChannelID: 11, Provider: 1, Priority: 10, Weight: 100},
		{ChannelID: 12, Provider: 1, Priority: 0, Weight: 100},
	}
	assert.Equal(t, 12, selectHubTierChannel(candidates, map[int]struct{}{11: {}}))
	assert.Zero(t, selectHubTierChannel(candidates, map[int]struct{}{11: {}, 12: {}}))
}

func TestSelectHubTierProviderChannelUsesHighestRemainingPriority(t *testing.T) {
	candidates := []hubTierChannelCandidate{
		{ChannelID: 21, Provider: 2, Priority: 0, Weight: 100},
		{ChannelID: 22, Provider: 2, Priority: 10, Weight: 0},
	}
	assert.Equal(t, 22, selectHubTierProviderChannel(candidates))
}
