package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeHubTokenRoutingChannelsAndRejectLegacy(t *testing.T) {
	policy, err := NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
		ProviderID: 999, ChannelIDs: []int{3, 1, 2},
		Channels: []HubTokenRoutingChannel{{ChannelID: 3, Multiplier: 100}},
	}, 42)
	require.NoError(t, err)
	assert.Equal(t, HubTokenRoutingModeChannels, policy.Mode)
	assert.Equal(t, 42, policy.ProviderID)
	assert.Equal(t, []int{3, 1, 2}, policy.ChannelIDs)
	assert.Nil(t, policy.Channels)
	for _, ids := range [][]int{nil, {1, 1}, {0}, {-1}, {1, 2, 3, 4, 5, 6, 7, 8, 9}} {
		_, err = NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{ChannelIDs: ids}, 42)
		assert.Error(t, err)
	}
	_, err = NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{ChannelIDs: []int{1}}, 0)
	assert.Error(t, err)
	for _, legacy := range []string{
		`{"mode":"provider","provider_id":42,"selections":[{"family":"openai","exact_multipliers":[0.3]}]}`,
		`{"mode":"public_pool","selections":[{"model":"gpt-4o","multipliers":[0.3]}]}`,
		`{"mode":"channels","provider_id":42,"channel_ids":[]}`,
	} {
		token := Token{HubRoutingPolicy: legacy}
		_, err = token.GetHubRoutingPolicy()
		assert.ErrorIs(t, err, ErrHubRoutingPolicyRequiresSelection)
	}
}

func TestHubTokenRoutingRuntimeFollowsCurrentPublishedChannelDefinitions(t *testing.T) {
	providers, channels, groups := createHubTokenRoutingSupply(t)
	input := &HubTokenRoutingPolicy{Mode: HubTokenRoutingModeChannels, ProviderID: providers[0].Id, ChannelIDs: []int{channels[1].Id, channels[0].Id}}
	policy, err := ResolveHubTokenRoutingPolicy(input)
	require.NoError(t, err)
	assert.Equal(t, []float64{0.6, 0.3}, policy.OrderedMultipliers("gpt-routing-text"))
	assert.Equal(t, []float64{0.3}, policy.OrderedMultipliers("claude-routing-text"))
	assert.False(t, policy.AllowsModel("gpt-routing-image"))
	assert.False(t, policy.AllowsModel("openai"))
	assert.False(t, policy.AllowsModel("GPT-ROUTING-TEXT"))
	preferred, ok := policy.ProviderFallbackProtectionMultiplier("gpt-routing-text")
	require.True(t, ok)
	assert.Equal(t, 0.6, preferred)

	require.NoError(t, DB.Model(&Channel{}).Where("id = ?", channels[0].Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	require.NoError(t, DB.Model(&HubSupplyGroup{}).Where("id = ?", groups[0].Id).Update("tenant_published", false).Error)
	disabled, err := ResolveHubTokenRoutingPolicy(input)
	require.NoError(t, err)
	assert.Equal(t, []float64{0.3}, disabled.OrderedMultipliers("claude-routing-text"))
	require.NoError(t, ValidateHubTokenProviderSelections(disabled))

	require.NoError(t, DB.Model(&HubSupplyGroup{}).Where("id = ?", groups[0].Id).Update("price_multiplier", 0.8).Error)
	repriced, err := ResolveHubTokenRoutingPolicy(input)
	require.NoError(t, err)
	assert.Equal(t, []float64{0.6, 0.8}, repriced.OrderedMultipliers("gpt-routing-text"))
	assert.Equal(t, []float64{0.6, 0.3}, policy.OrderedMultipliers("gpt-routing-text"), "an in-flight request retains its resolved definitions")
	assert.True(t, repriced.AllowsMultiplierForPlatformFallback("gpt-routing-text", 0.8))
	assert.False(t, repriced.AllowsMultiplierForPlatformFallback("gpt-routing-text", 0.801))
	assert.False(t, repriced.AllowsMultiplierForPlatformFallback("gpt-routing-image", 0.1))

	require.NoError(t, DB.Model(&Channel{}).Where("id = ?", channels[0].Id).Update("models", "gpt-routing-text,claude-routing-text,gpt-routing-new").Error)
	unpublishedNew, err := ResolveHubTokenRoutingPolicy(input)
	require.NoError(t, err)
	assert.False(t, unpublishedNew.AllowsModel("gpt-routing-new"))
	require.NoError(t, DB.Model(&HubSupplyGroup{}).Where("id = ?", groups[0].Id).Update("published_models", "gpt-routing-text,gpt-routing-new").Error)
	publishedNew, err := ResolveHubTokenRoutingPolicy(input)
	require.NoError(t, err)
	assert.True(t, publishedNew.AllowsModel("gpt-routing-new"))
	assert.False(t, publishedNew.AllowsModel("claude-routing-text"))

	require.NoError(t, DB.Delete(&Channel{}, channels[0].Id).Error)
	deleted, err := ResolveHubTokenRoutingPolicy(input)
	require.NoError(t, err)
	assert.Equal(t, []float64{0.6}, deleted.OrderedMultipliers("gpt-routing-text"))
	assert.False(t, deleted.AllowsModel("gpt-routing-new"))
	require.Error(t, ValidateHubTokenProviderSelections(deleted))
}

func TestHubTokenRoutingSelectsExactChannelsAndGlobalFallbackWithCacheParity(t *testing.T) {
	providers, channels, groups := createHubTokenRoutingSupply(t)
	for _, memoryCache := range []bool{false, true} {
		t.Run(fmt.Sprintf("memory_cache_%t", memoryCache), func(t *testing.T) {
			original := common.MemoryCacheEnabled
			common.MemoryCacheEnabled = memoryCache
			t.Cleanup(func() { common.MemoryCacheEnabled = original; InitChannelCache() })
			InitChannelCache()
			policy, err := ResolveHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
				Mode: HubTokenRoutingModeChannels, ProviderID: providers[0].Id,
				ChannelIDs: []int{channels[0].Id, channels[1].Id},
			})
			require.NoError(t, err)
			preferredFilter := ChannelProviderFilter{PreferredChannelID: channels[1].Id}
			selected, snapshot, err := GetRandomSatisfiedChannelWithHubPolicy(policy, "gpt-routing-text", 0, "/v1/chat/completions", nil, preferredFilter)
			require.NoError(t, err)
			require.NotNil(t, selected)
			assert.Equal(t, channels[0].Id, selected.Id, "affinity cannot skip the first selected multiplier")
			assert.Equal(t, 0.3, snapshot.Pricing.PriceMultiplier)

			excluded := map[int]struct{}{channels[0].Id: {}}
			selected, _, err = GetRandomSatisfiedChannelWithHubPolicy(policy, "gpt-routing-text", 0, "/v1/chat/completions", excluded, ChannelProviderFilter{})
			require.NoError(t, err)
			require.NotNil(t, selected)
			assert.Equal(t, channels[1].Id, selected.Id, "an unselected channel at 0.3 is not a preferred route")

			fallbackFilter := ChannelProviderFilter{PlatformFallback: true, PreferredChannelID: channels[4].Id}
			selected, snapshot, err = GetRandomSatisfiedChannelWithHubPolicy(policy, "gpt-routing-text", 0, "/v1/chat/completions", nil, fallbackFilter)
			require.NoError(t, err)
			require.NotNil(t, selected)
			assert.Equal(t, channels[3].Id, selected.Id, "cheaper global supply precedes fallback affinity")
			assert.Equal(t, providers[1].Id, snapshot.Pricing.SupplyProviderId)
			assert.Equal(t, 2, *snapshot.Pricing.TenantId)

			excluded[channels[3].Id] = struct{}{}
			selected, _, err = GetRandomSatisfiedChannelWithHubPolicy(policy, "gpt-routing-text", 0, "/v1/chat/completions", excluded, ChannelProviderFilter{PlatformFallback: true, PreferredChannelID: channels[2].Id})
			require.NoError(t, err)
			require.NotNil(t, selected)
			assert.Equal(t, channels[2].Id, selected.Id, "fallback includes unselected supply from the origin provider")
			excluded[channels[2].Id] = struct{}{}
			selected, _, err = GetRandomSatisfiedChannelWithHubPolicy(policy, "gpt-routing-text", 0, "/v1/chat/completions", excluded, fallbackFilter)
			require.NoError(t, err)
			require.NotNil(t, selected)
			assert.Equal(t, channels[4].Id, selected.Id, "fallback may exceed preferred but never the selected maximum")
			excluded[channels[4].Id] = struct{}{}
			selected, _, err = GetRandomSatisfiedChannelWithHubPolicy(policy, "gpt-routing-text", 0, "/v1/chat/completions", excluded, fallbackFilter)
			require.NoError(t, err)
			assert.Nil(t, selected, "0.8 exceeds the selected maximum of 0.6")

			assert.True(t, IsChannelEnabledForHubTokenPolicy(policy, "gpt-routing-text", channels[0].Id))
			assert.False(t, IsChannelEnabledForHubTokenPolicy(policy, "gpt-routing-text", channels[2].Id))
			assert.True(t, IsChannelEnabledForHubTokenPolicyFallback(policy, "gpt-routing-text", "/v1/chat/completions", channels[2].Id))
			assert.False(t, IsChannelEnabledForHubTokenPolicyFallback(policy, "gpt-routing-text", "/v1/chat/completions", channels[0].Id))
			selected, _, err = GetRandomSatisfiedChannelWithHubPolicy(policy, "gpt-routing-image", 0, "/v1/images/generations", nil, fallbackFilter)
			require.NoError(t, err)
			assert.Nil(t, selected, "an unselected model cannot gain authorization through fallback")
			imagePolicy, err := ResolveHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
				Mode: HubTokenRoutingModeChannels, ProviderID: providers[1].Id, ChannelIDs: []int{channels[6].Id},
			})
			require.NoError(t, err)
			imageAvailable, err := IsModelAvailableForHubTokenPolicy(imagePolicy, "gpt-routing-image")
			require.NoError(t, err)
			assert.True(t, imageAvailable, "model discovery includes selected image-only supply")
			selected, _, err = GetRandomSatisfiedChannelWithHubPolicy(policy, "gpt-routing-text", 0, "/v1/images/generations", nil, ChannelProviderFilter{})
			require.NoError(t, err)
			assert.Nil(t, selected, "text-only supply cannot satisfy an image endpoint")

			originalRuntime := hubRoutingRuntimeSnapshotValue.Load()
			PublishHubRoutingRuntimeSignals(time.Now().Unix(), []HubRoutingRuntimeSignal{{
				ChannelID: channels[0].Id, ModelName: "gpt-routing-text", ProbeKind: HubSupplyProbeKindText,
				RealHealthState: HubRoutingRealHealthQuarantined,
			}})
			selected, _, err = GetRandomSatisfiedChannelWithHubPolicy(policy, "gpt-routing-text", 0, "/v1/chat/completions", nil, ChannelProviderFilter{})
			hubRoutingRuntimeSnapshotValue.Store(originalRuntime)
			require.NoError(t, err)
			require.NotNil(t, selected)
			assert.Equal(t, channels[1].Id, selected.Id, "quarantined selected supply is skipped")

			require.NoError(t, DB.Model(&Channel{}).Where("id IN ?", []int{channels[0].Id, channels[1].Id}).Update("status", common.ChannelStatusManuallyDisabled).Error)
			InitChannelCache()
			unavailable, err := ResolveHubTokenRoutingPolicy(policy)
			require.NoError(t, err)
			selected, _, err = GetRandomSatisfiedChannelWithHubPolicy(unavailable, "gpt-routing-text", 0, "/v1/chat/completions", nil, ChannelProviderFilter{})
			require.NoError(t, err)
			assert.Nil(t, selected)
			selected, _, err = GetRandomSatisfiedChannelWithHubPolicy(unavailable, "gpt-routing-text", 0, "/v1/chat/completions", nil, fallbackFilter)
			require.NoError(t, err)
			require.NotNil(t, selected)
			assert.Equal(t, channels[3].Id, selected.Id)
			available, err := IsModelAvailableForHubTokenPolicy(unavailable, "gpt-routing-text")
			require.NoError(t, err)
			assert.True(t, available)
			require.NoError(t, DB.Model(&Channel{}).Where("id IN ?", []int{channels[0].Id, channels[1].Id}).Update("status", common.ChannelStatusEnabled).Error)
			InitChannelCache()

			captured := CaptureHubSupplyPricingSnapshot(channels[0].Id)
			require.NoError(t, DB.Model(&HubSupplyGroup{}).Where("id = ?", groups[0].Id).Update("price_multiplier", 0.9).Error)
			InitChannelCache()
			repriced, err := ResolveHubTokenRoutingPolicy(policy)
			require.NoError(t, err)
			assert.True(t, IsChannelEnabledForHubTokenPolicySnapshot(policy, "gpt-routing-text", "", captured, false))
			assert.False(t, IsChannelEnabledForHubTokenPolicy(policy, "gpt-routing-text", channels[0].Id), "a captured request cannot silently adopt a newer channel price")
			assert.True(t, IsChannelEnabledForHubTokenPolicy(repriced, "gpt-routing-text", channels[0].Id))
			require.NoError(t, DB.Model(&HubSupplyGroup{}).Where("id = ?", groups[0].Id).Update("price_multiplier", 0.3).Error)
			InitChannelCache()
		})
	}
}

func TestHubTokenRoutingOptionsExposeProviderChannelsAndKeepUnavailableSelections(t *testing.T) {
	providers, channels, groups := createHubTokenRoutingSupply(t)
	require.NoError(t, DB.Model(&HubSupplyGroup{}).Where("id = ?", groups[0].Id).Update("tenant_published", false).Error)
	options, err := GetHubTokenRoutingOptions(providers[0].Id)
	require.NoError(t, err)
	assert.Equal(t, HubTokenRoutingModeChannels, options.Mode)
	require.Len(t, options.Channels, 3)
	assert.Equal(t, channels[0].Id, options.Channels[0].ChannelID)
	assert.False(t, options.Channels[0].Available)
	assert.Equal(t, []string{"gpt-routing-text", "claude-routing-text"}, options.Channels[0].Models)
	assert.Equal(t, []string{"openai", "anthropic"}, options.Channels[0].ModelFamilies)
	assert.Equal(t, 0.3, options.Channels[0].Multiplier)
	policy := &HubTokenRoutingPolicy{Mode: HubTokenRoutingModeChannels, ProviderID: providers[0].Id, ChannelIDs: []int{channels[0].Id}}
	require.NoError(t, ValidateHubTokenProviderSelections(policy))
	policy.ChannelIDs = []int{channels[3].Id}
	require.Error(t, ValidateHubTokenProviderSelections(policy))
}

func TestHubTokenRoutingPolicyRoundTripsOnlyOrderedIDsThroughTokenCache(t *testing.T) {
	useUserCacheMiniRedis(t)
	policy := &HubTokenRoutingPolicy{
		Mode: HubTokenRoutingModeChannels, ProviderID: 42, ChannelIDs: []int{3, 1},
		Channels: []HubTokenRoutingChannel{{ChannelID: 3, Multiplier: 0.3, Models: []string{"gpt-4o"}}},
	}
	token := Token{Id: 73, UserId: 9, Key: "hub-routing-policy-cache-key", Name: "hub-routing-cache", Group: "default"}
	require.NoError(t, token.SetHubRoutingPolicy(policy))
	assert.JSONEq(t, `{"mode":"channels","provider_id":42,"channel_ids":[3,1]}`, token.HubRoutingPolicy)
	require.NoError(t, cacheSetToken(token))
	cached, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	cachedPolicy, err := cached.GetHubRoutingPolicy()
	require.NoError(t, err)
	assert.Equal(t, policy.ChannelIDs, cachedPolicy.ChannelIDs)
	assert.Nil(t, cachedPolicy.Channels, "token cache must not freeze current models or prices")
}

func createHubTokenRoutingSupply(t *testing.T) ([]HubProvider, []Channel, []HubSupplyGroup) {
	t.Helper()
	tenantA, tenantB := 1, 2
	providers := []HubProvider{
		{OwnerUserId: 71001, TenantId: &tenantA, Name: "Routing A", Slug: "routing-a"},
		{OwnerUserId: 71002, TenantId: &tenantB, Name: "Routing B", Slug: "routing-b"},
	}
	require.NoError(t, DB.Create(&providers).Error)
	channels := make([]Channel, 7)
	groups := make([]HubSupplyGroup, len(channels))
	multipliers := []float64{0.3, 0.6, 0.3, 0.2, 0.4, 0.8, 0.1}
	providerIDs := []int{providers[0].Id, providers[0].Id, providers[0].Id, providers[1].Id, providers[1].Id, providers[1].Id, providers[1].Id}
	for index := range channels {
		models := "gpt-routing-text"
		if index == 0 {
			models += ",claude-routing-text"
		}
		if index == 6 {
			models = "gpt-routing-image"
		}
		channels[index] = Channel{Name: fmt.Sprintf("routing-channel-%d", index), Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Models: models, Group: HubTokenRoutingAbilityGroup}
		require.NoError(t, DB.Create(&channels[index]).Error)
		groups[index] = HubSupplyGroup{
			ProviderId: providerIDs[index], NewAPIChannelId: channels[index].Id,
			PriceMultiplier: multipliers[index], PublishedModels: models, TenantPublished: true, ConfigVersion: 1,
		}
		require.NoError(t, DB.Create(&groups[index]).Error)
		for _, modelName := range channels[index].GetModels() {
			probeKind := HubSupplyProbeKindText
			if index == 6 {
				probeKind = HubSupplyProbeKindImage
			}
			require.NoError(t, DB.Create(&Ability{Group: HubTokenRoutingAbilityGroup, Model: modelName, ChannelId: channels[index].Id, Enabled: true}).Error)
			require.NoError(t, DB.Create(&HubSupplyGroupProbeTarget{
				GroupId: groups[index].Id, ConfigVersion: 1, ModelName: modelName,
				EndpointType: "openai", ProbeKind: probeKind, Status: HubSupplyProbeStatusAvailable,
			}).Error)
		}
	}
	InitChannelCache()
	t.Cleanup(func() {
		for index := range channels {
			require.NoError(t, DB.Where("group_id = ?", groups[index].Id).Delete(&HubSupplyGroupProbeTarget{}).Error)
			require.NoError(t, DB.Where("channel_id = ?", channels[index].Id).Delete(&Ability{}).Error)
			require.NoError(t, DB.Delete(&HubSupplyGroup{}, groups[index].Id).Error)
			require.NoError(t, DB.Delete(&Channel{}, channels[index].Id).Error)
		}
		for _, provider := range providers {
			require.NoError(t, DB.Delete(&HubProvider{}, provider.Id).Error)
		}
		InitChannelCache()
	})
	return providers, channels, groups
}

func TestPremiumMultiplierSupplyIsPublishedOnlyToHubTokenRouting(t *testing.T) {
	const modelName = "gpt-premium-routing-only"
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	originalModelRatios := ratio_setting.ModelRatio2JSONString()
	common.MemoryCacheEnabled = false
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-premium-routing-only":1}`))
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalModelRatios))
	})

	provider := HubProvider{
		OwnerUserId: 71201,
		Name:        "Premium Routing Provider",
		Slug:        "premium-routing-provider",
		Status:      HubProviderStatusActive,
	}
	require.NoError(t, DB.Create(&provider).Error)
	channel := Channel{
		Name:   "premium-routing-channel",
		Type:   constant.ChannelTypeOpenAI,
		Status: common.ChannelStatusEnabled,
		Models: modelName,
		Group:  "default",
	}
	require.NoError(t, DB.Create(&channel).Error)
	supplyGroup := HubSupplyGroup{
		PublicId:                "premium-routing-supply",
		ProviderId:              provider.Id,
		NewAPIChannelId:         channel.Id,
		PriceMultiplier:         5.5,
		PublishedModels:         modelName,
		AutoProbeDisabledModels: modelName,
		ConfigVersion:           1,
		Status:                  HubSupplyGroupStatusAvailable,
	}
	require.NoError(t, DB.Create(&supplyGroup).Error)
	require.NoError(t, channel.UpdateAbilities(nil))
	require.NoError(t, RefreshHubSupplyPricingCache())
	t.Cleanup(func() {
		DB.Where("channel_id = ?", channel.Id).Delete(&Ability{})
		DB.Delete(&HubSupplyGroup{}, supplyGroup.Id)
		DB.Delete(&Channel{}, channel.Id)
		DB.Delete(&HubProvider{}, provider.Id)
		require.NoError(t, RefreshHubSupplyPricingCache())
	})

	var abilities []Ability
	require.NoError(t, DB.Where("channel_id = ?", channel.Id).Find(&abilities).Error)
	require.Len(t, abilities, 1)
	assert.Equal(t, HubTokenRoutingAbilityGroup, abilities[0].Group)
	assert.Equal(t, modelName, abilities[0].Model)
	defaultChannel, err := GetRandomSatisfiedChannel("default", modelName, 0, "/v1/chat/completions", nil)
	require.NoError(t, err)
	assert.Nil(t, defaultChannel)

	policy, err := NormalizeHubTokenRoutingPolicy(&HubTokenRoutingPolicy{
		ChannelIDs: []int{channel.Id},
	}, provider.Id)
	require.NoError(t, err)
	require.NoError(t, ValidateHubTokenProviderSelections(policy))

	selected, snapshot, err := GetRandomSatisfiedChannelWithHubPolicy(
		policy,
		modelName,
		0,
		"/v1/chat/completions",
		nil,
		ChannelProviderFilter{ProviderID: provider.Id, Mode: ChannelProviderOnly},
	)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, channel.Id, selected.Id)
	assert.Equal(t, 5.5, snapshot.Pricing.PriceMultiplier)

	options, err := GetHubTokenRoutingOptions(provider.Id)
	require.NoError(t, err)
	require.Len(t, options.Channels, 1)
	assert.Equal(t, 5.5, options.Channels[0].Multiplier)
	assert.Equal(t, []string{modelName}, options.Channels[0].Models)
}
