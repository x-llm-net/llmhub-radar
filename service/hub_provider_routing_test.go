package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProviderHostRoutingPrefersProviderThenFallsBackToPlatformPool(t *testing.T) {
	const modelName = "hub-provider-routing-model"
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	originalRetryTimes := common.RetryTimes
	common.RetryTimes = 2

	provider := &model.HubProvider{OwnerUserId: 95001, Name: "Routing Provider", Slug: "routing-provider"}
	otherProvider := &model.HubProvider{OwnerUserId: 95002, Name: "Other Provider", Slug: "other-provider"}
	require.NoError(t, model.CreateHubProvider(provider))
	require.NoError(t, model.CreateHubProvider(otherProvider))

	priority := int64(0)
	providerChannels := make([]*model.Channel, 0, 2)
	allChannels := make([]*model.Channel, 0, 4)
	for _, name := range []string{"routing-provider-a", "routing-provider-b", "routing-other-provider", "routing-platform"} {
		channel := &model.Channel{
			Name: name, Type: constant.ChannelTypeOpenAI, Key: "test-key",
			Models: modelName, Group: "default", Status: common.ChannelStatusEnabled,
			Priority: &priority,
		}
		require.NoError(t, model.DB.Create(channel).Error)
		require.NoError(t, model.DB.Create(&model.Ability{
			Group: "default", Model: modelName, ChannelId: channel.Id,
			Enabled: true, Priority: &priority,
		}).Error)
		allChannels = append(allChannels, channel)
		switch name {
		case "routing-provider-a", "routing-provider-b":
			providerChannels = append(providerChannels, channel)
			require.NoError(t, model.DB.Create(&model.HubSupplyGroup{
				ProviderId: provider.Id, NewAPIChannelId: channel.Id, PriceMultiplier: 1,
			}).Error)
		case "routing-other-provider":
			require.NoError(t, model.DB.Create(&model.HubSupplyGroup{
				ProviderId: otherProvider.Id, NewAPIChannelId: channel.Id, PriceMultiplier: 1,
			}).Error)
		}
	}

	channelIDs := make([]int, 0, len(allChannels))
	for _, channel := range allChannels {
		channelIDs = append(channelIDs, channel.Id)
	}
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		common.RetryTimes = originalRetryTimes
		model.DB.Where("new_api_channel_id IN ?", channelIDs).Delete(&model.HubSupplyGroup{})
		model.DB.Where("channel_id IN ?", channelIDs).Delete(&model.Ability{})
		model.DB.Where("id IN ?", channelIDs).Delete(&model.Channel{})
		model.DB.Where("id IN ?", []int{provider.Id, otherProvider.Id}).Delete(&model.HubProvider{})
		model.InitChannelCache()
	})

	for _, memoryCacheEnabled := range []bool{false, true} {
		name := "database"
		if memoryCacheEnabled {
			name = "memory-cache"
		}
		t.Run(name, func(t *testing.T) {
			common.MemoryCacheEnabled = memoryCacheEnabled
			model.InitChannelCache()
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, provider.Id)
			common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderSlug, provider.Slug)
			param := &RetryParam{
				Ctx: ctx, TokenGroup: "default", ModelName: modelName,
				Retry: common.GetPointer(0),
			}

			first, _, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, first)
			firstSnapshot, ok := common.GetContextKeyType[model.HubSupplyPricingSnapshot](ctx, constant.ContextKeyHubSupplyPricingSnapshot)
			require.True(t, ok)
			assert.Equal(t, first.Id, firstSnapshot.ChannelID)
			assert.Equal(t, provider.Id, firstSnapshot.Pricing.SupplyProviderId)
			assert.True(t, model.ChannelMatchesProviderFilter(first.Id, model.ChannelProviderFilter{
				ProviderID: provider.Id, Mode: model.ChannelProviderOnly,
			}))

			param.ExcludeChannel(first.Id)
			param.IncreaseRetry()
			second, _, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, second)
			secondSnapshot, ok := common.GetContextKeyType[model.HubSupplyPricingSnapshot](ctx, constant.ContextKeyHubSupplyPricingSnapshot)
			require.True(t, ok)
			assert.Equal(t, second.Id, secondSnapshot.ChannelID)
			assert.Equal(t, provider.Id, secondSnapshot.Pricing.SupplyProviderId)
			assert.NotEqual(t, first.Id, second.Id)
			assert.True(t, model.ChannelMatchesProviderFilter(second.Id, model.ChannelProviderFilter{
				ProviderID: provider.Id, Mode: model.ChannelProviderOnly,
			}))

			param.ExcludeChannel(second.Id)
			param.IncreaseRetry()
			fallback, _, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, fallback)
			fallbackSnapshot, ok := common.GetContextKeyType[model.HubSupplyPricingSnapshot](ctx, constant.ContextKeyHubSupplyPricingSnapshot)
			require.True(t, ok)
			assert.Equal(t, fallback.Id, fallbackSnapshot.ChannelID)
			assert.True(t, model.ChannelMatchesProviderFilter(fallback.Id, model.ChannelProviderFilter{
				ProviderID: provider.Id, Mode: model.ChannelProviderExclude,
			}))
			assert.True(t, common.GetContextKeyBool(ctx, constant.ContextKeyHubRoutingFallback))
			assert.Equal(t, "platform_fallback", common.GetContextKeyString(ctx, constant.ContextKeyHubRoutingPhase))
		})
	}
}

func TestProviderHostRoutingFallsBackImmediatelyWhenProviderHasNoModel(t *testing.T) {
	const modelName = "hub-provider-immediate-fallback-model"
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	provider := &model.HubProvider{OwnerUserId: 95003, Name: "Empty Provider", Slug: "empty-provider"}
	require.NoError(t, model.CreateHubProvider(provider))
	priority := int64(0)
	platform := &model.Channel{
		Name: "routing-immediate-platform", Type: constant.ChannelTypeOpenAI,
		Key: "test-key", Models: modelName, Group: "default",
		Status: common.ChannelStatusEnabled, Priority: &priority,
	}
	require.NoError(t, model.DB.Create(platform).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: modelName, ChannelId: platform.Id,
		Enabled: true, Priority: &priority,
	}).Error)
	model.InitChannelCache()
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		model.DB.Where("channel_id = ?", platform.Id).Delete(&model.Ability{})
		model.DB.Delete(&model.Channel{}, platform.Id)
		model.DB.Delete(&model.HubProvider{}, provider.Id)
		model.InitChannelCache()
	})

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, provider.Id)
	param := &RetryParam{Ctx: ctx, TokenGroup: "default", ModelName: modelName, Retry: common.GetPointer(0)}
	selected, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, platform.Id, selected.Id)
	assert.True(t, common.GetContextKeyBool(ctx, constant.ContextKeyHubRoutingFallback))
}

func TestProviderPolicyDoesNotFallbackWhenOriginProviderIsDisabled(t *testing.T) {
	const modelName = "gpt-disabled-origin-provider-policy"
	originProvider := &model.HubProvider{OwnerUserId: 95011, Name: "Disabled Origin", Slug: "disabled-origin"}
	fallbackProvider := &model.HubProvider{OwnerUserId: 95012, Name: "Disabled Origin Fallback", Slug: "disabled-origin-fallback"}
	require.NoError(t, model.CreateHubProvider(originProvider))
	require.NoError(t, model.CreateHubProvider(fallbackProvider))

	priority := int64(0)
	fallbackChannel := &model.Channel{
		Name: "disabled-origin-fallback-channel", Type: constant.ChannelTypeOpenAI,
		Key: "test-key", Models: modelName, Group: "default",
		Status: common.ChannelStatusEnabled, Priority: &priority,
	}
	require.NoError(t, model.DB.Create(fallbackChannel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: model.HubTokenRoutingAbilityGroup, Model: modelName,
		ChannelId: fallbackChannel.Id, Enabled: true, Priority: &priority,
	}).Error)
	require.NoError(t, model.DB.Create(&model.HubSupplyGroup{
		ProviderId: fallbackProvider.Id, NewAPIChannelId: fallbackChannel.Id,
		PriceMultiplier: 0.5, Status: model.HubSupplyGroupStatusAvailable,
	}).Error)
	_, err := model.UpdateHubProviderStatus(originProvider.Id, model.HubProviderStatusDisabled)
	require.NoError(t, err)
	model.InitChannelCache()
	t.Cleanup(func() {
		model.DB.Where("new_api_channel_id = ?", fallbackChannel.Id).Delete(&model.HubSupplyGroup{})
		model.DB.Where("channel_id = ?", fallbackChannel.Id).Delete(&model.Ability{})
		model.DB.Delete(&model.Channel{}, fallbackChannel.Id)
		model.DB.Where("id IN ?", []int{originProvider.Id, fallbackProvider.Id}).Delete(&model.HubProvider{})
		model.InitChannelCache()
	})

	policy, err := model.NormalizeHubTokenRoutingPolicy(&model.HubTokenRoutingPolicy{
		Selections: []model.HubTokenRoutingSelection{{
			Family: "openai", ExactMultipliers: []float64{0.5},
		}},
	}, originProvider.Id)
	require.NoError(t, err)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, policy)
	param := &RetryParam{
		Ctx: ctx, TokenGroup: "default", ModelName: modelName,
		RequestPath: "/v1/chat/completions", Retry: common.GetPointer(0),
	}

	selected, _, err := CacheGetRandomSatisfiedChannel(param)

	require.Error(t, err)
	require.Nil(t, selected)
	require.Contains(t, err.Error(), "provider is unavailable")
}

func TestProviderHostRoutingPreservesAutoGroupRetryState(t *testing.T) {
	db := setupChannelSelectAutoGroupsTest(t)
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}, &model.HubSupplyGroup{}))

	originalRetryTimes := common.RetryTimes
	common.RetryTimes = 1
	t.Cleanup(func() { common.RetryTimes = originalRetryTimes })

	const modelName = "provider-auto-retry-state-model"
	provider := &model.HubProvider{OwnerUserId: 95004, Name: "Auto Routing Provider", Slug: "auto-routing-provider"}
	require.NoError(t, model.CreateHubProvider(provider))
	createChannelSelectAutoGroupsChannel(t, db, 2201, "vip", modelName)
	createChannelSelectAutoGroupsChannel(t, db, 2202, "default", modelName)
	createChannelSelectAutoGroupsChannel(t, db, 2203, "vip", modelName)
	for _, channelID := range []int{2201, 2202} {
		require.NoError(t, db.Create(&model.HubSupplyGroup{
			ProviderId: provider.Id, NewAPIChannelId: channelID, PriceMultiplier: 0.4,
		}).Error)
	}
	model.InitChannelCache()

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenAutoGroups, []string{"vip", "default"})
	common.SetContextKey(ctx, constant.ContextKeyTokenCrossGroupRetry, true)
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, provider.Id)
	param := &RetryParam{
		Ctx: ctx, TokenGroup: "auto", ModelName: modelName,
		RequestPath: "/v1/chat/completions", Retry: common.GetPointer(0),
	}

	first, group, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, 2201, first.Id)
	assert.Equal(t, "vip", group)

	param.ExcludeChannel(first.Id)
	param.IncreaseRetry()
	second, group, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, 2202, second.Id)
	assert.Equal(t, "default", group)

	param.ExcludeChannel(second.Id)
	param.IncreaseRetry()
	fallback, group, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, fallback)
	assert.Equal(t, 2203, fallback.Id)
	assert.Equal(t, "vip", group)
	assert.Equal(t, "platform_fallback", common.GetContextKeyString(ctx, constant.ContextKeyHubRoutingPhase))
	assert.True(t, common.GetContextKeyBool(ctx, constant.ContextKeyHubRoutingFallback))
}
