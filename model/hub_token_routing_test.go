package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeHubTokenRoutingPolicyRoundsPublicRangesToThreeDecimals(t *testing.T) {
	policy, err := NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
		Mode: HubTokenRoutingModePublic,
		Selections: []HubTokenRoutingSelection{{
			Family:        " OpenAI ",
			MinMultiplier: 0.0104,
			MaxMultiplier: 0.0504,
		}},
	}, 0)

	require.NoError(t, err)
	require.NotNil(t, policy)
	assert.Equal(t, "openai", policy.Selections[0].Family)
	assert.Equal(t, 0.01, policy.Selections[0].MinMultiplier)
	assert.Equal(t, 0.05, policy.Selections[0].MaxMultiplier)
	assert.True(t, policy.AllowsMultiplier("openai", 0.05))
	assert.False(t, policy.AllowsMultiplier("openai", 0.051))
}

func TestNormalizeHubTokenRoutingPolicyAllowsPremiumMultipliersAboveBaseline(t *testing.T) {
	policy, err := NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
		Selections: []HubTokenRoutingSelection{{
			Family:        "openai",
			MinMultiplier: 5.0004,
			MaxMultiplier: 6.0004,
		}},
	}, 0)

	require.NoError(t, err)
	require.NotNil(t, policy)
	assert.Equal(t, 5.0, policy.Selections[0].MinMultiplier)
	assert.Equal(t, 6.0, policy.Selections[0].MaxMultiplier)
	assert.True(t, policy.AllowsMultiplier("openai", 5.5))
	assert.False(t, policy.AllowsMultiplier("openai", 6.001))
}

func TestNormalizeHubTokenRoutingPolicyBindsProviderAndDeduplicatesExactMultipliers(t *testing.T) {
	policy, err := NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
		Mode: HubTokenRoutingModePublic,
		Selections: []HubTokenRoutingSelection{{
			Family:           "anthropic",
			ExactMultipliers: []float64{0.2, 0.2004, 0.5},
		}},
	}, 7)

	require.NoError(t, err)
	require.NotNil(t, policy)
	assert.Equal(t, HubTokenRoutingModeProvider, policy.Mode)
	assert.Equal(t, 7, policy.ProviderID)
	assert.Equal(t, []float64{0.2, 0.5}, policy.Selections[0].ExactMultipliers)
	assert.True(t, policy.AllowsMultiplier("anthropic", 0.2))
	assert.False(t, policy.AllowsMultiplier("anthropic", 0.3))
}

func TestNormalizeHubTokenRoutingPolicyRejectsDuplicateFamiliesAndInvalidRanges(t *testing.T) {
	_, err := NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
		Selections: []HubTokenRoutingSelection{
			{Family: "openai", MinMultiplier: 0.1, MaxMultiplier: 0.2},
			{Family: "openai", MinMultiplier: 0.3, MaxMultiplier: 0.4},
		},
	}, 0)
	assert.Error(t, err)

	_, err = NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
		Selections: []HubTokenRoutingSelection{{
			Family:        "google",
			MinMultiplier: 0.4,
			MaxMultiplier: 0.2,
		}},
	}, 0)
	assert.Error(t, err)
}

func TestNormalizeHubTokenRoutingPolicyDoesNotTrustProviderScopeWithoutHostBinding(t *testing.T) {
	_, err := NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
		Mode:       HubTokenRoutingModeProvider,
		ProviderID: 99,
		Selections: []HubTokenRoutingSelection{{
			Family:           "openai",
			ExactMultipliers: []float64{0.2},
		}},
	}, 0)

	assert.Error(t, err)
}

func TestHubTokenRoutingUsesPublishedGroupsAndKeepsFallbackInsideMultiplierPolicy(t *testing.T) {
	modelName := "gpt-hub-token-routing-test"
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})

	providers := []HubProvider{
		{OwnerUserId: 71001, Slot: 0, Name: "Routing Provider A", Slug: "routing-provider-a", Status: HubProviderStatusActive},
		{OwnerUserId: 71002, Slot: 0, Name: "Routing Provider B", Slug: "routing-provider-b", Status: HubProviderStatusActive},
	}
	require.NoError(t, DB.Create(&providers).Error)

	channels := []Channel{
		{Name: "routing-policy-a", Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Models: modelName, Group: "default"},
		{Name: "routing-policy-b", Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Models: modelName, Group: "default"},
		{Name: "routing-policy-expensive", Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Models: modelName, Group: "default"},
		{Name: "routing-policy-private", Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Models: modelName, Group: "vip"},
	}
	require.NoError(t, DB.Create(&channels).Error)

	supplyGroups := []HubSupplyGroup{
		{PublicId: "routing-policy-a", ProviderId: providers[0].Id, NewAPIChannelId: channels[0].Id, PriceMultiplier: 0.2, PublishedModels: modelName, ConfigVersion: 1, Status: HubSupplyGroupStatusAvailable},
		{PublicId: "routing-policy-b", ProviderId: providers[1].Id, NewAPIChannelId: channels[1].Id, PriceMultiplier: 0.2, PublishedModels: modelName, ConfigVersion: 1, Status: HubSupplyGroupStatusAvailable},
		{PublicId: "routing-policy-expensive", ProviderId: providers[1].Id, NewAPIChannelId: channels[2].Id, PriceMultiplier: 0.5, PublishedModels: modelName, ConfigVersion: 1, Status: HubSupplyGroupStatusAvailable},
		{PublicId: "routing-policy-private", ProviderId: providers[0].Id, NewAPIChannelId: channels[3].Id, PriceMultiplier: 0.3, PublishedModels: modelName, ConfigVersion: 1, Status: HubSupplyGroupStatusAvailable},
	}
	require.NoError(t, DB.Create(&supplyGroups).Error)

	abilities := []Ability{
		{Group: "default", Model: modelName, ChannelId: channels[0].Id, Enabled: true},
		{Group: "default", Model: modelName, ChannelId: channels[1].Id, Enabled: true},
		{Group: "default", Model: modelName, ChannelId: channels[2].Id, Enabled: true},
		{Group: "vip", Model: modelName, ChannelId: channels[3].Id, Enabled: true},
	}
	require.NoError(t, DB.Create(&abilities).Error)
	probeTargets := make([]HubSupplyGroupProbeTarget, 0, len(supplyGroups))
	for _, group := range supplyGroups {
		probeTargets = append(probeTargets, HubSupplyGroupProbeTarget{
			GroupId:       group.Id,
			ConfigVersion: group.ConfigVersion,
			ModelName:     modelName,
			EndpointType:  "openai",
			ProbeKind:     HubSupplyProbeKindText,
			Status:        HubSupplyProbeStatusAvailable,
		})
	}
	require.NoError(t, DB.Create(&probeTargets).Error)
	require.NoError(t, RefreshHubSupplyPricingCache())
	t.Cleanup(func() {
		groupIDs := make([]int, 0, len(supplyGroups))
		channelIDs := make([]int, 0, len(channels))
		providerIDs := make([]int, 0, len(providers))
		for _, group := range supplyGroups {
			groupIDs = append(groupIDs, group.Id)
		}
		for _, channel := range channels {
			channelIDs = append(channelIDs, channel.Id)
		}
		for _, provider := range providers {
			providerIDs = append(providerIDs, provider.Id)
		}
		DB.Where("group_id IN ?", groupIDs).Delete(&HubSupplyGroupProbeTarget{})
		DB.Where("channel_id IN ?", channelIDs).Delete(&Ability{})
		DB.Where("id IN ?", groupIDs).Delete(&HubSupplyGroup{})
		DB.Where("id IN ?", channelIDs).Delete(&Channel{})
		DB.Where("id IN ?", providerIDs).Delete(&HubProvider{})
		require.NoError(t, RefreshHubSupplyPricingCache())
	})

	policy, err := NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
		Selections: []HubTokenRoutingSelection{{
			Family:        "openai",
			MinMultiplier: 0.2,
			MaxMultiplier: 0.2,
		}},
	}, 0)
	require.NoError(t, err)

	channel, _, err := GetRandomSatisfiedChannelWithHubPolicy(
		policy,
		modelName,
		0,
		"/v1/chat/completions",
		nil,
		ChannelProviderFilter{ProviderID: providers[0].Id, Mode: ChannelProviderOnly, StrictExcludedChannels: true},
	)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, channels[0].Id, channel.Id)

	channel, _, err = GetRandomSatisfiedChannelWithHubPolicy(
		policy,
		modelName,
		0,
		"/v1/chat/completions",
		map[int]struct{}{channels[0].Id: {}},
		ChannelProviderFilter{ProviderID: providers[0].Id, Mode: ChannelProviderExclude, StrictExcludedChannels: true},
	)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, channels[1].Id, channel.Id)
	assert.True(t, IsChannelEnabledForHubTokenPolicy(policy, modelName, channels[0].Id))
	assert.False(t, IsChannelEnabledForHubTokenPolicy(policy, modelName, channels[2].Id))
	assert.False(t, IsChannelEnabledForHubTokenPolicy(policy, modelName, channels[3].Id))

	options, err := GetHubTokenRoutingOptions(providers[0].Id)
	require.NoError(t, err)
	require.Len(t, options.Families, 1)
	assert.Equal(t, "openai", options.Families[0].Key)
	assert.Equal(t, []float64{0.2}, options.Families[0].ExactMultipliers)
	assert.Equal(t, []int{providers[0].Id}, options.Families[0].Availability[0].ProviderIDs)
}

func TestHubTokenRoutingPolicyRoundTripsThroughTokenCache(t *testing.T) {
	useUserCacheMiniRedis(t)
	policy := &HubTokenRoutingPolicy{
		Mode: HubTokenRoutingModePublic,
		Selections: []HubTokenRoutingSelection{{
			Family:        "anthropic",
			MinMultiplier: 0.1,
			MaxMultiplier: 0.3,
		}},
	}
	token := Token{Id: 73, UserId: 9, Key: "hub-routing-policy-cache-key", Name: "hub-routing-cache", Group: "default"}
	require.NoError(t, token.SetHubRoutingPolicy(policy))
	require.NoError(t, cacheSetToken(token))

	cached, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	cachedPolicy, err := cached.GetHubRoutingPolicy()
	require.NoError(t, err)
	require.NotNil(t, cachedPolicy)
	assert.Equal(t, policy, cachedPolicy)
}
