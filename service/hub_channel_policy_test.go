package service_test

import (
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelPolicyTriesEverySelectionBeforeBoundedFallback(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.HubSupplyGroupRevision{}, &model.HubSupplyGroupProbeTarget{}, &model.HubSupplyGroupProbeSample{}))
	previousRetries, previousCache := common.RetryTimes, common.MemoryCacheEnabled
	previousRatios := ratio_setting.ModelRatio2JSONString()
	ratio_setting.InitRatioSettings()
	common.RetryTimes = 0
	provider := &model.HubProvider{OwnerUserId: 96301, Name: "Channel Policy", Slug: "channel-policy-retry"}
	require.NoError(t, model.CreateHubProvider(provider))
	var channelIDs []int
	t.Cleanup(func() {
		_, err := model.BatchDeleteChannels(channelIDs)
		require.NoError(t, err)
		require.NoError(t, model.DB.Delete(provider).Error)
		common.RetryTimes, common.MemoryCacheEnabled = previousRetries, previousCache
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios))
		model.InitChannelCache()
	})
	for index, multiplier := range []float64{0.3, 0.4, 0.5, 0.6, 0.7, 0.2} {
		_, channel := createProbedHubMarketplaceSupply(t, provider.Id, fmt.Sprintf("channel-policy-%d", index), multiplier)
		channelIDs = append(channelIDs, channel.Id)
	}
	model.InitChannelCache()
	for _, useCache := range []bool{false, true} {
		t.Run(fmt.Sprintf("cache=%t", useCache), func(t *testing.T) {
			common.MemoryCacheEnabled = useCache
			model.InitChannelCache()
			policy, err := model.ResolveHubTokenRoutingPolicy(&model.HubTokenRoutingPolicy{
				Mode: model.HubTokenRoutingModeChannels, ProviderID: provider.Id, ChannelIDs: channelIDs[:5],
			})
			require.NoError(t, err)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, policy)
			retry := &service.RetryParam{Ctx: ctx, TokenGroup: "default", ModelName: hubMarketplaceFlowModel,
				RequestPath: ctx.Request.URL.Path, Retry: common.GetPointer(0)}
			var attempted []int
			for ; retry.GetRetry() <= retry.MaxRetry(); retry.IncreaseRetry() {
				channel, _, err := service.CacheGetRandomSatisfiedChannel(retry)
				require.NoError(t, err)
				require.NotNil(t, channel)
				attempted = append(attempted, channel.Id)
				assert.Equal(t, len(attempted) == 6, common.GetContextKeyBool(ctx, constant.ContextKeyHubRoutingFallback))
				retry.ExcludeChannel(channel.Id)
			}
			assert.Equal(t, channelIDs, attempted)
			assert.Equal(t, 5, retry.MaxRetry())

			// Whole-channel unpublication retains the model and pricing basis,
			// but skips all preferred attempts and leaves one fallback attempt.
			require.NoError(t, model.UpdateHubSupplyGroupTenantPublication(channelIDs[:5], false))
			policy, err = model.ResolveHubTokenRoutingPolicy(policy)
			require.NoError(t, err)
			ctx, _ = gin.CreateTestContext(httptest.NewRecorder())
			common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, policy)
			retry = &service.RetryParam{Ctx: ctx, TokenGroup: "default", ModelName: hubMarketplaceFlowModel,
				RequestPath: "/v1/chat/completions", Retry: common.GetPointer(0)}
			channel, _, err := service.CacheGetRandomSatisfiedChannel(retry)
			require.NoError(t, err)
			require.NotNil(t, channel)
			assert.Equal(t, channelIDs[5], channel.Id)
			assert.Equal(t, 0, retry.MaxRetry())
			protected, ok := policy.ProviderFallbackProtectionMultiplier(hubMarketplaceFlowModel)
			assert.True(t, ok)
			assert.Equal(t, 0.3, protected)
			require.NoError(t, model.UpdateHubSupplyGroupTenantPublication(channelIDs[:5], true))
		})
	}
}
