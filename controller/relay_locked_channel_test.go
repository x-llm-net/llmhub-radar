package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	taskdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLockedTaskRetriesDoNotUseSelectedChannelBudget(t *testing.T) {
	previousRetries := common.RetryTimes
	t.Cleanup(func() { common.RetryTimes = previousRetries })
	for _, retries := range []int{0, 2} {
		t.Run(fmt.Sprintf("retry_times_%d", retries), func(t *testing.T) {
			common.RetryTimes = retries
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			policy := &model.HubTokenRoutingPolicy{Mode: model.HubTokenRoutingModeChannels}
			for channelID := 1; channelID <= 8; channelID++ {
				policy.ChannelIDs = append(policy.ChannelIDs, channelID)
				policy.Channels = append(policy.Channels, model.HubTokenRoutingChannel{
					ChannelID: channelID, Models: []string{"sora-2"}, Multiplier: 0.3,
				})
			}
			common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, policy)
			retry := &service.RetryParam{Ctx: ctx, ModelName: "sora-2"}
			attempts := 0
			for ; retry.GetRetry() <= taskRelayMaxRetry(retry, true); retry.IncreaseRetry() {
				attempts++
				remaining := taskRelayMaxRetry(retry, true) - retry.GetRetry()
				if !shouldRetryTaskRelay(ctx, &taskdto.TaskError{StatusCode: http.StatusBadGateway}, remaining, true) {
					break
				}
			}
			assert.Equal(t, retries+1, attempts)
			assert.Equal(t, 8+retries, taskRelayMaxRetry(retry, false), "unlocked requests retain their channel traversal budget")
		})
	}
}

func TestLockedTaskValidationAndBillingShareCapturedPricing(t *testing.T) {
	require.NoError(t, i18n.Init())
	setupRelayServiceTierTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.HubProvider{}, &model.HubSupplyGroup{}, &model.HubSupplyGroupProbeTarget{}))
	provider := model.HubProvider{OwnerUserId: 91001, Name: "Locked task provider", Slug: "locked-task-provider"}
	require.NoError(t, model.DB.Create(&provider).Error)
	channels := []model.Channel{
		{Name: "locked-selected", Type: constant.ChannelTypeOpenAI, Key: "test-key", Status: common.ChannelStatusEnabled, Models: "sora-2", Group: model.HubTokenRoutingAbilityGroup},
		{Name: "locked-fallback", Type: constant.ChannelTypeOpenAI, Key: "test-key", Status: common.ChannelStatusEnabled, Models: "sora-2", Group: model.HubTokenRoutingAbilityGroup},
	}
	require.NoError(t, model.DB.Create(&channels).Error)
	for index, multiplier := range []float64{0.3, 0.2} {
		group := model.HubSupplyGroup{
			ProviderId: provider.Id, NewAPIChannelId: channels[index].Id,
			PriceMultiplier: multiplier, PublishedModels: "sora-2", ConfigVersion: 1, TenantPublished: true,
		}
		require.NoError(t, model.DB.Create(&group).Error)
		require.NoError(t, model.DB.Create(&model.Ability{Group: model.HubTokenRoutingAbilityGroup, Model: "sora-2", ChannelId: channels[index].Id, Enabled: true}).Error)
		require.NoError(t, model.DB.Create(&model.HubSupplyGroupProbeTarget{
			GroupId: group.Id, ConfigVersion: 1, ModelName: "sora-2", EndpointType: "openai",
			ProbeKind: model.HubSupplyProbeKindText, Status: model.HubSupplyProbeStatusAvailable,
		}).Error)
	}
	model.InitChannelCache()
	policy, err := model.ResolveHubTokenRoutingPolicy(&model.HubTokenRoutingPolicy{
		Mode: model.HubTokenRoutingModeChannels, ProviderID: provider.Id, ChannelIDs: []int{channels[0].Id},
	})
	require.NoError(t, err)
	snapshots := []model.HubSupplyPricingSnapshot{
		model.CaptureHubSupplyPricingSnapshot(channels[0].Id),
		model.CaptureHubSupplyPricingSnapshot(channels[1].Id),
	}
	// Reprice after this request has captured its authorized generation but
	// before the locked-channel setup runs. New requests observe 0.8.
	require.NoError(t, model.DB.Model(&model.HubSupplyGroup{}).Where("provider_id = ?", provider.Id).Update("price_multiplier", 0.8).Error)
	model.InitChannelCache()
	for index, channel := range channels {
		t.Run(channel.Name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/origin/remix", nil)
			common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, policy)
			common.SetContextKey(ctx, constant.ContextKeyHubSupplyPricingSnapshot, model.CaptureHubSupplyPricingSnapshot(channel.Id))
			info := &relaycommon.RelayInfo{OriginModelName: "sora-2", TokenGroup: "default"}
			require.Nil(t, setupLockedTaskChannel(ctx, info, &channel, snapshots[index]))
			captured, ok := common.GetContextKeyType[model.HubSupplyPricingSnapshot](ctx, constant.ContextKeyHubSupplyPricingSnapshot)
			require.True(t, ok)
			assert.Equal(t, snapshots[index], captured)
			assert.Equal(t, index == 1, common.GetContextKeyBool(ctx, constant.ContextKeyHubRoutingFallback))
			priced, err := helper.ApplyHubSupplyPricingFromRequest(ctx, hosttypes.GroupRatioInfo{GroupRatio: 1}, channel.Id)
			require.NoError(t, err)
			assert.Equal(t, snapshots[index].Pricing.PriceMultiplier, priced.SupplyMultiplier)
			assert.Equal(t, 0.3, priced.GroupRatio)
			assert.Equal(t, index == 1, priced.FallbackPriceProtection)
		})
	}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/origin/remix", nil)
	common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, policy)
	info := &relaycommon.RelayInfo{OriginModelName: "sora-2", TokenGroup: "default"}
	assert.NotNil(t, setupLockedTaskChannel(ctx, info, &channels[1], model.CaptureHubSupplyPricingSnapshot(channels[1].Id)), "a newly captured fallback price above this request's ceiling is rejected")
}
