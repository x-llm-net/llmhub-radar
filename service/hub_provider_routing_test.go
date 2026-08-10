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
