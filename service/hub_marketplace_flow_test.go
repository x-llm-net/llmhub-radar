package service_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayhelper "github.com/QuantumNous/new-api/relay/helper"
	relaytypes "github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/hub_provider_settlement_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const hubMarketplaceFlowModel = "gpt-5"

func createProbedHubMarketplaceSupply(
	t *testing.T,
	providerID int,
	name string,
	multiplier float64,
) (*model.HubSupplyGroup, *model.Channel) {
	t.Helper()
	baseURL := "https://" + name + ".example"
	priority := int64(0)
	group := &model.HubSupplyGroup{
		ProviderId:        providerID,
		PriceMultiplier:   multiplier,
		PublishedModels:   hubMarketplaceFlowModel,
		TextProbeMinutes:  10,
		ImageProbeMinutes: 30,
	}
	channel := &model.Channel{
		Name:     name,
		Type:     constant.ChannelTypeOpenAI,
		Key:      "test-key",
		BaseURL:  &baseURL,
		Models:   hubMarketplaceFlowModel,
		Group:    "default",
		Status:   common.ChannelStatusAutoDisabled,
		Priority: &priority,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))

	var targets []model.HubSupplyGroupProbeTarget
	require.NoError(t, model.DB.Where(
		"group_id = ? AND config_version = ? AND model_name = ?",
		group.Id,
		group.ConfigVersion,
		hubMarketplaceFlowModel,
	).Find(&targets).Error)
	require.NotEmpty(t, targets)
	for _, target := range targets {
		_, current, err := model.RecordHubSupplyProbeResult(target.Id, true, 350, "", "", "")
		require.NoError(t, err)
		require.True(t, current)
	}
	require.NoError(t, model.ReconcileHubSupplyGroupRouteState(group.Id))

	storedChannel, err := model.GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusEnabled, storedChannel.Status)
	var ability model.Ability
	require.NoError(t, model.DB.Where(&model.Ability{
		ChannelId: channel.Id,
		Model:     hubMarketplaceFlowModel,
		Group:     model.HubTokenRoutingAbilityGroup,
		Enabled:   true,
	}).First(&ability).Error)
	return group, storedChannel
}

func TestHubMarketplacePolicyFlowFallsBackAtExactMultiplierAndSettlesFinalProviderFee(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, model.DB.AutoMigrate(
		&model.HubSupplyGroupRevision{},
		&model.HubSupplyGroupProbeTarget{},
		&model.HubSupplyGroupProbeSample{},
	))

	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	originalRetryTimes := common.RetryTimes
	originalModelRatios := ratio_setting.ModelRatio2JSONString()
	settlementSettings := hub_provider_settlement_setting.Get()
	originalSettlementSettings := *settlementSettings
	common.MemoryCacheEnabled = false
	common.RetryTimes = 1
	settlementSettings.FallbackReferralEnabled = true
	settlementSettings.FallbackReferralBasisPoints = 100
	ratio_setting.InitRatioSettings()
	t.Setenv("HUB_PROVIDER_ROOT_DOMAIN", "llm-hub.store")
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		common.RetryTimes = originalRetryTimes
		*settlementSettings = originalSettlementSettings
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalModelRatios))
		providerIDs := model.DB.Model(&model.HubProvider{}).
			Select("id").
			Where("owner_user_id IN ?", []int{96101, 96102})
		groupIDs := model.DB.Model(&model.HubSupplyGroup{}).
			Select("id").
			Where("provider_id IN (?)", providerIDs)
		channelIDs := model.DB.Model(&model.Channel{}).
			Select("id").
			Where("name IN ?", []string{"marketplace-origin", "marketplace-fallback"})
		model.DB.Where("group_id IN (?)", groupIDs).Delete(&model.HubSupplyGroupProbeSample{})
		model.DB.Where("group_id IN (?)", groupIDs).Delete(&model.HubSupplyGroupProbeTarget{})
		model.DB.Where("channel_id IN (?)", channelIDs).Delete(&model.Ability{})
		model.DB.Where("request_id = ?", "req-marketplace-flow-fallback").Delete(&model.HubProviderEarning{})
		model.DB.Where("group_id IN (?)", groupIDs).Delete(&model.HubSupplyGroupRevision{})
		model.DB.Where("provider_id IN (?)", providerIDs).Delete(&model.HubSupplyGroup{})
		model.DB.Where("name IN ?", []string{"marketplace-origin", "marketplace-fallback"}).Delete(&model.Channel{})
		model.DB.Where("owner_user_id IN ?", []int{96101, 96102}).Delete(&model.HubProvider{})
		model.DB.Where("id = ?", 96103).Delete(&model.Token{})
		model.DB.Where("id IN ?", []int{96101, 96102, 96103}).Delete(&model.User{})
		model.InitChannelCache()
	})

	for _, user := range []model.User{
		{Id: 96101, Username: "marketplace_origin_owner", Quota: 0, Status: common.UserStatusEnabled, AffCode: "market-origin"},
		{Id: 96102, Username: "marketplace_fallback_owner", Quota: 0, Status: common.UserStatusEnabled, AffCode: "market-fallback"},
		{Id: 96103, Username: "marketplace_consumer", Quota: 10_000, Status: common.UserStatusEnabled, Group: "default", AffCode: "market-consumer"},
	} {
		require.NoError(t, model.DB.Create(&user).Error)
	}
	originFee := 0
	fallbackFee := 2500
	originTenantID := 96111
	fallbackTenantID := 96112
	originProvider := &model.HubProvider{
		OwnerUserId:            96101,
		TenantId:               &originTenantID,
		Name:                   "Marketplace Origin",
		Slug:                   "marketplace-origin",
		PlatformFeeBasisPoints: &originFee,
	}
	fallbackProvider := &model.HubProvider{
		OwnerUserId:            96102,
		TenantId:               &fallbackTenantID,
		Name:                   "Marketplace Fallback",
		Slug:                   "marketplace-fallback",
		PlatformFeeBasisPoints: &fallbackFee,
	}
	require.NoError(t, model.CreateHubProvider(originProvider))
	require.NoError(t, model.CreateHubProvider(fallbackProvider))

	originGroup, originChannel := createProbedHubMarketplaceSupply(
		t,
		originProvider.Id,
		"marketplace-origin",
		0.5,
	)
	fallbackGroup, fallbackChannel := createProbedHubMarketplaceSupply(
		t,
		fallbackProvider.Id,
		"marketplace-fallback",
		0.5,
	)
	model.InitChannelCache()

	resolution, err := model.ResolveHubProviderHost("marketplace-origin.llm-hub.store")
	require.NoError(t, err)
	require.True(t, resolution.IsProviderHost)
	assert.Equal(t, originProvider.Id, resolution.Provider.Id)

	token := &model.Token{
		Id:            96103,
		UserId:        96103,
		Key:           "marketplace-policy-token",
		Name:          "marketplace exact multiplier",
		Status:        common.TokenStatusEnabled,
		RemainQuota:   10_000,
		Group:         "default",
		HubTenantId:   originTenantID,
		HubProviderId: originProvider.Id,
	}
	policy, err := model.NormalizeHubTokenRoutingPolicy(&model.HubTokenRoutingPolicy{
		Mode:       model.HubTokenRoutingModeChannels,
		ChannelIDs: []int{originChannel.Id},
	}, originProvider.Id)
	require.NoError(t, err)
	require.NoError(t, token.SetHubRoutingPolicy(policy))
	require.NoError(t, model.DB.Create(token).Error)
	assert.Equal(t, 1.0, ratio_setting.GetGroupRatio(token.Group))

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, resolution.Provider.Id)
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderSlug, resolution.Provider.Slug)
	require.NoError(t, middleware.SetupContextForToken(ctx, token))
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, token.Group)
	common.SetContextKey(ctx, constant.ContextKeyHubRoutingFallback, false)
	require.True(t, service.IsHubTokenRoutingRequest(ctx))

	retry := &service.RetryParam{
		Ctx:        ctx,
		TokenGroup: token.Group,
		ModelName:  hubMarketplaceFlowModel,
		Retry:      common.GetPointer(0),
	}
	preferred, selectedGroup, err := service.CacheGetRandomSatisfiedChannel(retry)
	require.NoError(t, err)
	require.NotNil(t, preferred)
	assert.Equal(t, token.Group, selectedGroup)
	assert.Equal(t, originChannel.Id, preferred.Id)
	assert.Equal(t, "preferred", common.GetContextKeyString(ctx, constant.ContextKeyHubRoutingPhase))
	require.Nil(t, middleware.SetupContextForSelectedChannel(ctx, preferred, hubMarketplaceFlowModel))
	preferredPricing, err := relayhelper.ApplyHubSupplyPricingFromRequest(
		ctx,
		hosttypes.GroupRatioInfo{GroupRatio: ratio_setting.GetGroupRatio(token.Group)},
		preferred.Id,
	)
	require.NoError(t, err)
	assert.Equal(t, 0.5, preferredPricing.GroupRatio)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptStartedAt, time.Now().Add(-40*time.Millisecond))
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptRetry, retry.GetRetry())
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptProvider, preferredPricing.SupplyProviderId)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptSupply, preferredPricing.SupplyGroupId)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptMultiplier, preferredPricing.SupplyMultiplier)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptBillingRatio, preferredPricing.GroupRatio)
	service.AppendHubRelayAttemptFailure(
		ctx,
		&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelId: preferred.Id}},
		relaytypes.NewErrorWithStatusCode(
			errors.New("origin upstream unavailable"),
			relaytypes.ErrorCodeBadResponseStatusCode,
			http.StatusBadGateway,
		),
	)

	retry.ExcludeChannel(preferred.Id)
	retry.IncreaseRetry()
	fallback, selectedGroup, err := service.CacheGetRandomSatisfiedChannel(retry)
	require.NoError(t, err)
	require.NotNil(t, fallback)
	assert.Equal(t, token.Group, selectedGroup)
	assert.Equal(t, fallbackChannel.Id, fallback.Id)
	assert.Equal(t, "platform_fallback", common.GetContextKeyString(ctx, constant.ContextKeyHubRoutingPhase))
	assert.True(t, common.GetContextKeyBool(ctx, constant.ContextKeyHubRoutingFallback))
	require.Nil(t, middleware.SetupContextForSelectedChannel(ctx, fallback, hubMarketplaceFlowModel))
	fallbackPricing, err := relayhelper.ApplyHubSupplyPricingFromRequest(
		ctx,
		hosttypes.GroupRatioInfo{GroupRatio: ratio_setting.GetGroupRatio(token.Group)},
		fallback.Id,
	)
	require.NoError(t, err)
	assert.Equal(t, 0.5, fallbackPricing.GroupRatio)
	assert.Equal(t, fallbackGroup.Id, fallbackPricing.SupplyGroupId)
	assert.Equal(t, fallbackProvider.Id, fallbackPricing.SupplyProviderId)
	successStartedAt := time.Now().Add(-30 * time.Millisecond)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptStartedAt, successStartedAt)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptRetry, retry.GetRetry())
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptProvider, fallbackPricing.SupplyProviderId)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptSupply, fallbackPricing.SupplyGroupId)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptMultiplier, fallbackPricing.SupplyMultiplier)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptBillingRatio, fallbackPricing.GroupRatio)

	const quotaBeforeGroup = 1000
	actualQuota, err := common.QuotaFromFloatStrict(quotaBeforeGroup * fallbackPricing.GroupRatio)
	require.NoError(t, err)
	finalInfo := &relaycommon.RelayInfo{
		RequestId:       "req-marketplace-flow-fallback",
		UserId:          token.UserId,
		TokenId:         token.Id,
		TokenKey:        token.Key,
		TokenGroup:      token.Group,
		UsingGroup:      token.Group,
		OriginModelName: hubMarketplaceFlowModel,
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: fallback.Id},
		PriceData: hosttypes.PriceData{
			QuotaBeforeGroup: quotaBeforeGroup,
			GroupRatioInfo:   fallbackPricing,
		},
	}
	finalInfo.UserSetting.QuotaWarningThreshold = 1
	require.NoError(t, service.SettleBillingAndProviderEarning(ctx, finalInfo, actualQuota))

	consumerQuota, err := model.GetUserQuota(token.UserId, true)
	require.NoError(t, err)
	assert.Equal(t, 10_000-actualQuota, consumerQuota)
	var storedToken model.Token
	require.NoError(t, model.DB.First(&storedToken, token.Id).Error)
	assert.Equal(t, 10_000-actualQuota, storedToken.RemainQuota)
	assert.Equal(t, actualQuota, storedToken.UsedQuota)

	var earning model.HubProviderEarning
	require.NoError(t, model.DB.Where("request_id = ?", finalInfo.RequestId).First(&earning).Error)
	assert.Equal(t, model.HubProviderEarningStatusSettled, earning.Status)
	assert.Equal(t, fallbackProvider.Id, earning.ProviderId)
	assert.Equal(t, fallbackProvider.OwnerUserId, earning.OwnerUserId)
	assert.Equal(t, fallbackGroup.Id, earning.SupplyGroupId)
	assert.Equal(t, fallback.Id, earning.ChannelId)
	assert.Equal(t, actualQuota, earning.GrossQuota)
	assert.Equal(t, fallbackFee, earning.ProviderServiceFeeBasisPoints)
	assert.Equal(t, model.HubProviderPlatformFeeBasisPoints, earning.PlatformFeeBasisPoints)
	assert.Equal(t, 38, earning.PlatformFeeQuota)
	assert.Equal(t, 370, earning.ProviderIncomeQuota)
	assert.Equal(t, 125, earning.ResellerGrossQuota)
	assert.Equal(t, 87, earning.ResellerNetIncomeQuota)
	assert.Equal(t, originProvider.Id, earning.ReferralProviderId)
	assert.Equal(t, originProvider.OwnerUserId, earning.ReferralOwnerUserId)
	assert.Equal(t, 100, earning.ReferralBasisPoints)
	assert.Equal(t, 5, earning.ReferralIncomeQuota)
	assert.Equal(t, earning.GrossQuota, earning.PlatformFeeQuota+earning.ProviderIncomeQuota+earning.ReferralIncomeQuota+earning.ResellerNetIncomeQuota)
	assert.Equal(t, 0.5, earning.SupplyMultiplier)
	assert.True(t, finalInfo.PriceData.GroupRatioInfo.HasPlatformFeeBasisPoints)
	assert.Equal(t, fallbackFee, finalInfo.PriceData.GroupRatioInfo.ProviderServiceFeeBasisPoints)
	assert.Equal(t, model.HubProviderPlatformFeeBasisPoints, finalInfo.PriceData.GroupRatioInfo.PlatformFeeBasisPoints)
	var originEarningCount int64
	require.NoError(t, model.DB.Model(&model.HubProviderEarning{}).
		Where("provider_id = ? AND request_id = ?", originProvider.Id, finalInfo.RequestId).
		Count(&originEarningCount).Error)
	assert.Zero(t, originEarningCount)
	originSummary, err := model.GetHubProviderSettlementSummary(originProvider.Id)
	require.NoError(t, err)
	assert.Equal(t, 5, originSummary.SettledIncomeQuota)
	assert.Equal(t, 5, originSummary.ReferralIncomeQuota)
	assert.Equal(t, 5, originSummary.WithdrawableQuota)
	fallbackSummary, err := model.GetHubProviderSettlementSummary(fallbackProvider.Id)
	require.NoError(t, err)
	assert.Equal(t, 370, fallbackSummary.SettledIncomeQuota)
	assert.Zero(t, fallbackSummary.ReferralIncomeQuota)

	finalInfo.FirstResponseTime = successStartedAt.Add(20 * time.Millisecond)
	other := map[string]interface{}{}
	service.AttachHubRelayLogInfo(ctx, finalInfo, other, true)
	assert.NotContains(t, other, "service_tier")
	assert.Equal(t, model.HubTokenRoutingModeChannels, other["routing_policy_mode"])
	assert.Equal(t, originProvider.Id, other["origin_provider_id"])
	assert.Equal(t, fallbackProvider.Id, other["served_provider_id"])
	attempts, ok := other["hub_attempts"].([]service.HubRelayAttempt)
	require.True(t, ok)
	require.Len(t, attempts, 2)
	assert.Equal(t, "failed", attempts[0].Result)
	assert.Equal(t, "preferred", attempts[0].RoutingPhase)
	assert.Equal(t, originProvider.Id, attempts[0].ProviderID)
	assert.Equal(t, originGroup.Id, attempts[0].SupplyGroupID)
	assert.Equal(t, originChannel.Id, attempts[0].ChannelID)
	assert.Equal(t, model.HubTokenRoutingModeChannels, attempts[0].RoutingPolicyMode)
	assert.Empty(t, attempts[0].ServiceTier)
	assert.Equal(t, "success", attempts[1].Result)
	assert.Equal(t, "platform_fallback", attempts[1].RoutingPhase)
	assert.Equal(t, fallbackProvider.Id, attempts[1].ProviderID)
	assert.Equal(t, fallbackGroup.Id, attempts[1].SupplyGroupID)
	assert.Equal(t, fallbackChannel.Id, attempts[1].ChannelID)
	assert.Equal(t, model.HubTokenRoutingModeChannels, attempts[1].RoutingPolicyMode)
	assert.Empty(t, attempts[1].ServiceTier)
}
