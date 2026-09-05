package helper

import (
	"errors"
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/hub_provider_settlement_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	hosttypes "github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

type ModelPriceNotConfiguredError struct {
	ModelName string
	UserID    int
}

func (err *ModelPriceNotConfiguredError) Error() string {
	modelName := err.ModelName
	if model.IsAdmin(err.UserID) {
		return fmt.Sprintf(
			"模型 %s 的价格未配置。请前往「系统设置 → 运营设置」开启自用模式，或在「系统设置 → 分组与模型定价设置」中为该模型配置价格；"+
				"Model %s price not configured. Go to System Settings → Operation Settings to enable self-use mode, or configure the model price in System Settings → Group & Model Pricing.",
			modelName, modelName,
		)
	}
	return fmt.Sprintf(
		"模型 %s 的价格尚未由管理员配置，暂时无法使用，请联系站点管理员开启该模型；"+
			"Model %s has not been priced by the administrator yet. Please contact the site administrator to enable this model.",
		modelName, modelName,
	)
}

func IsModelPriceNotConfiguredError(err error) bool {
	var target *ModelPriceNotConfiguredError
	return errors.As(err, &target)
}

func modelPriceNotConfiguredError(modelName string, userId int) error {
	return &ModelPriceNotConfiguredError{ModelName: modelName, UserID: userId}
}

// https://docs.claude.com/en/docs/build-with-claude/prompt-caching#1-hour-cache-duration
const claudeCacheCreation1hMultiplier = 6 / 3.75

// defaultTieredPreConsumeMaxTokens is the fallback completion-token estimate
// used for tiered expression pre-consume when the client omits max_tokens, so
// the pre-consumed quota still reflects a plausible output cost in paid groups.
const defaultTieredPreConsumeMaxTokens = 8192

// HandleGroupRatio checks for "auto_group" in the context and updates the group ratio and relayInfo.UsingGroup if present
func HandleGroupRatio(ctx *gin.Context, relayInfo *relaycommon.RelayInfo) hosttypes.GroupRatioInfo {
	groupRatioInfo := hosttypes.GroupRatioInfo{
		GroupRatio:        1.0, // default ratio
		GroupSpecialRatio: -1,
		BaseGroupRatio:    1.0,
		SupplyMultiplier:  1.0,
	}
	if _, exists := common.GetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy); exists {
		return groupRatioInfo
	}

	// check auto group
	autoGroup, exists := ctx.Get("auto_group")
	if exists {
		logger.LogDebug(ctx, "final group: %s", autoGroup)
		relayInfo.UsingGroup = autoGroup.(string)
	}

	// check user group special ratio
	userGroupRatio, ok := ratio_setting.GetGroupGroupRatio(relayInfo.UserGroup, relayInfo.UsingGroup)
	if ok {
		// user group special ratio
		groupRatioInfo.GroupSpecialRatio = userGroupRatio
		groupRatioInfo.GroupRatio = userGroupRatio
		groupRatioInfo.HasSpecialRatio = true
	} else {
		// normal group ratio
		groupRatioInfo.GroupRatio = ratio_setting.GetGroupRatio(relayInfo.UsingGroup)
	}
	groupRatioInfo.BaseGroupRatio = groupRatioInfo.GroupRatio

	return groupRatioInfo
}

func ApplyHubSupplyPricing(groupRatioInfo hosttypes.GroupRatioInfo, channelID int) (hosttypes.GroupRatioInfo, error) {
	groupRatioInfo = resetHubSupplyPricing(groupRatioInfo)

	pricing, ok := model.GetHubSupplyPricingByChannelID(channelID)
	if !ok {
		configured, err := model.IsHubSupplyChannelConfigured(channelID)
		if err != nil {
			return hosttypes.GroupRatioInfo{}, fmt.Errorf(
				"failed to verify hub supply ownership for channel %d: %w",
				channelID,
				err,
			)
		}
		if configured {
			return hosttypes.GroupRatioInfo{}, fmt.Errorf(
				"hub supply pricing snapshot is missing for channel %d",
				channelID,
			)
		}
		return groupRatioInfo, nil
	}
	return applyHubSupplyPricingSnapshot(groupRatioInfo, channelID, pricing, true)
}

// ApplyHubSupplyPricingFromRequest uses the snapshot captured when the
// current channel was selected. The legacy function above remains available
// for callers that do not run inside a routed request.
func ApplyHubSupplyPricingFromRequest(c *gin.Context, groupRatioInfo hosttypes.GroupRatioInfo, channelID int) (hosttypes.GroupRatioInfo, error) {
	groupRatioInfo = resetHubSupplyPricing(groupRatioInfo)
	if c != nil {
		if snapshot, ok := common.GetContextKeyType[model.HubSupplyPricingSnapshot](c, constant.ContextKeyHubSupplyPricingSnapshot); ok && snapshot.ChannelID == channelID {
			if !snapshot.Found && !snapshot.Configured {
				return applyHubFallbackPriceProtection(c, groupRatioInfo), nil
			}
			priced, err := applyHubSupplyPricingSnapshot(groupRatioInfo, channelID, snapshot.Pricing, snapshot.Found)
			if err != nil {
				return priced, err
			}
			return applyHubFallbackPriceProtection(c, priced), nil
		}
	}
	priced, err := ApplyHubSupplyPricing(groupRatioInfo, channelID)
	if err != nil {
		return priced, err
	}
	return applyHubFallbackPriceProtection(c, priced), nil
}

func applyHubFallbackPriceProtection(c *gin.Context, groupRatioInfo hosttypes.GroupRatioInfo) hosttypes.GroupRatioInfo {
	if c == nil || (groupRatioInfo.HasSupplyPricing && groupRatioInfo.SupplyGroupRatio <= 0) {
		return groupRatioInfo
	}
	if !common.GetContextKeyBool(c, constant.ContextKeyHubRoutingFallback) {
		return groupRatioInfo
	}
	policy := serviceHubTokenRoutingPolicy(c)
	if policy == nil {
		return groupRatioInfo
	}
	modelName := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)
	if modelName == "" {
		modelName = c.GetString("model")
	}
	protectedMultiplier, ok := policy.ProviderFallbackProtectionMultiplier(modelName)
	currentMultiplier := groupRatioInfo.SupplyMultiplier
	if !groupRatioInfo.HasSupplyPricing {
		currentMultiplier = 1
	}
	if !ok || currentMultiplier >= protectedMultiplier-0.0005 {
		return groupRatioInfo
	}
	groupRatioInfo.GroupRatio = groupRatioInfo.BaseGroupRatio * protectedMultiplier
	groupRatioInfo.FallbackPriceProtection = true
	return groupRatioInfo
}

func serviceHubTokenRoutingPolicy(c *gin.Context) *model.HubTokenRoutingPolicy {
	value, ok := common.GetContextKey(c, constant.ContextKeyHubTokenRoutingPolicy)
	if !ok {
		return nil
	}
	switch typed := value.(type) {
	case *model.HubTokenRoutingPolicy:
		return typed
	case model.HubTokenRoutingPolicy:
		return &typed
	default:
		return nil
	}
}

func resetHubSupplyPricing(groupRatioInfo hosttypes.GroupRatioInfo) hosttypes.GroupRatioInfo {
	groupRatioInfo.BaseGroupRatio = groupRatioInfo.GroupRatio
	groupRatioInfo.SupplyMultiplier = 1
	groupRatioInfo.SupplyGroupRatio = groupRatioInfo.GroupRatio
	groupRatioInfo.HasSupplyPricing = false
	groupRatioInfo.SupplyGroupId = 0
	groupRatioInfo.SupplyProviderId = 0
	groupRatioInfo.SupplyOwnerUserId = 0
	groupRatioInfo.SupplyTenantId = 0
	groupRatioInfo.ProviderServiceFeeBasisPoints = 0
	groupRatioInfo.HasProviderServiceFeeBasisPoints = false
	groupRatioInfo.PlatformFeeBasisPoints = 0
	groupRatioInfo.HasPlatformFeeBasisPoints = false
	groupRatioInfo.FallbackPriceProtection = false
	return groupRatioInfo
}

func applyHubSupplyPricingSnapshot(groupRatioInfo hosttypes.GroupRatioInfo, channelID int, pricing model.HubSupplyPricing, found bool) (hosttypes.GroupRatioInfo, error) {
	if !found {
		return hosttypes.GroupRatioInfo{}, fmt.Errorf(
			"hub supply pricing snapshot is missing for channel %d",
			channelID,
		)
	}
	if pricing.SupplyGroupId <= 0 || pricing.SupplyProviderId <= 0 || pricing.SupplyProviderStatus == "" {
		return hosttypes.GroupRatioInfo{}, fmt.Errorf(
			"incomplete hub supply pricing snapshot for channel %d",
			channelID,
		)
	}
	if math.IsNaN(pricing.PriceMultiplier) || math.IsInf(pricing.PriceMultiplier, 0) ||
		pricing.PriceMultiplier < 0.01 || pricing.PriceMultiplier > 100 {
		return hosttypes.GroupRatioInfo{}, fmt.Errorf(
			"invalid hub supply price multiplier %.4f for channel %d",
			pricing.PriceMultiplier,
			channelID,
		)
	}

	groupRatioInfo.SupplyMultiplier = pricing.PriceMultiplier
	groupRatioInfo.SupplyGroupRatio = groupRatioInfo.BaseGroupRatio * pricing.PriceMultiplier
	groupRatioInfo.HasSupplyPricing = true
	groupRatioInfo.SupplyGroupId = pricing.SupplyGroupId
	groupRatioInfo.SupplyProviderId = pricing.SupplyProviderId
	groupRatioInfo.SupplyOwnerUserId = pricing.SupplyOwnerUserId
	if pricing.TenantId != nil {
		groupRatioInfo.SupplyTenantId = *pricing.TenantId
	}
	if pricing.TenantId != nil && *pricing.TenantId > 0 {
		providerServiceFeeBasisPoints := hub_provider_settlement_setting.ProviderServiceFeeBasisPoints()
		if pricing.ProviderServiceFeeBasisPoints != nil && *pricing.ProviderServiceFeeBasisPoints >= 0 && *pricing.ProviderServiceFeeBasisPoints <= 10000 {
			providerServiceFeeBasisPoints = *pricing.ProviderServiceFeeBasisPoints
		}
		groupRatioInfo.ProviderServiceFeeBasisPoints = providerServiceFeeBasisPoints
		groupRatioInfo.HasProviderServiceFeeBasisPoints = true
		groupRatioInfo.PlatformFeeBasisPoints = hub_provider_settlement_setting.PlatformFeeBasisPoints()
		if pricing.TenantPlatformFeeBasisPoints != nil && *pricing.TenantPlatformFeeBasisPoints >= 0 && *pricing.TenantPlatformFeeBasisPoints <= 10000 {
			groupRatioInfo.PlatformFeeBasisPoints = *pricing.TenantPlatformFeeBasisPoints
		}
	} else {
		// A nil tenant is a migration-compatibility state. Keep interpreting
		// the legacy provider column as the old platform fee until ownership is
		// explicitly backfilled.
		legacyFeeBasisPoints := hub_provider_settlement_setting.PlatformFeeBasisPoints()
		if pricing.ProviderServiceFeeBasisPoints != nil && *pricing.ProviderServiceFeeBasisPoints >= 0 && *pricing.ProviderServiceFeeBasisPoints <= 10000 {
			legacyFeeBasisPoints = *pricing.ProviderServiceFeeBasisPoints
		}
		groupRatioInfo.PlatformFeeBasisPoints = legacyFeeBasisPoints
	}
	groupRatioInfo.HasPlatformFeeBasisPoints = true
	groupRatioInfo.GroupRatio = groupRatioInfo.SupplyGroupRatio
	return groupRatioInfo, nil
}

func ModelPriceHelper(c *gin.Context, info *relaycommon.RelayInfo, promptTokens int, meta *types.TokenCountMeta) (hosttypes.PriceData, error) {
	modelPrice, usePrice := ratio_setting.GetModelPrice(info.OriginModelName, false)

	groupRatioInfo := HandleGroupRatio(c, info)
	groupRatioInfo, err := ApplyHubSupplyPricingFromRequest(c,
		groupRatioInfo,
		common.GetContextKeyInt(c, constant.ContextKeyChannelId),
	)
	if err != nil {
		return hosttypes.PriceData{}, err
	}

	// Check if this model uses tiered_expr billing
	if billing_setting.GetBillingMode(info.OriginModelName) == billing_setting.BillingModeTieredExpr {
		return modelPriceHelperTiered(c, info, promptTokens, meta, groupRatioInfo)
	}

	var preConsumedQuota int
	var modelRatio float64
	var completionRatio float64
	var cacheRatio float64
	var imageRatio float64
	var cacheCreationRatio float64
	var cacheCreationRatio5m float64
	var cacheCreationRatio1h float64
	var audioRatio float64
	var audioCompletionRatio float64
	var freeModel bool
	var quotaBeforeGroup float64
	if !usePrice {
		preConsumedTokens := common.Max(promptTokens, common.PreConsumedQuota)
		if meta.MaxTokens != 0 {
			preConsumedTokens += meta.MaxTokens
		}
		var success bool
		var matchName string
		modelRatio, success, matchName = ratio_setting.GetModelRatio(info.OriginModelName)
		if !success {
			acceptUnsetRatio := false
			if info.UserSetting.AcceptUnsetRatioModel {
				acceptUnsetRatio = true
			}
			if !acceptUnsetRatio {
				return hosttypes.PriceData{}, modelPriceNotConfiguredError(matchName, info.UserId)
			}
		}
		completionRatio = ratio_setting.GetCompletionRatio(info.OriginModelName)
		cacheRatio, _ = ratio_setting.GetCacheRatio(info.OriginModelName)
		cacheCreationRatio, _ = ratio_setting.GetCreateCacheRatio(info.OriginModelName)
		cacheCreationRatio5m = cacheCreationRatio
		// 固定1h和5min缓存写入价格的比例
		cacheCreationRatio1h = cacheCreationRatio * claudeCacheCreation1hMultiplier
		imageRatio, _ = ratio_setting.GetImageRatio(info.OriginModelName)
		audioRatio = ratio_setting.GetAudioRatio(info.OriginModelName)
		audioCompletionRatio = ratio_setting.GetAudioCompletionRatio(info.OriginModelName)
		quotaBeforeGroup = float64(preConsumedTokens) * modelRatio
		quota, err := common.QuotaFromFloatStrict(quotaBeforeGroup * groupRatioInfo.GroupRatio)
		if err != nil {
			return hosttypes.PriceData{}, err
		}
		preConsumedQuota = quota
	} else {
		if meta.ImagePriceRatio != 0 {
			modelPrice = modelPrice * meta.ImagePriceRatio
		}
	}

	// check if free model pre-consume is disabled
	if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
		// if model price or ratio is 0, do not pre-consume quota
		if groupRatioInfo.GroupRatio == 0 {
			preConsumedQuota = 0
			freeModel = true
		} else if usePrice {
			if modelPrice == 0 {
				preConsumedQuota = 0
				freeModel = true
			}
		} else {
			if modelRatio == 0 {
				preConsumedQuota = 0
				freeModel = true
			}
		}
	}

	priceData := hosttypes.PriceData{
		FreeModel:            freeModel,
		ModelPrice:           modelPrice,
		ModelRatio:           modelRatio,
		CompletionRatio:      completionRatio,
		GroupRatioInfo:       groupRatioInfo,
		UsePrice:             usePrice,
		CacheRatio:           cacheRatio,
		ImageRatio:           imageRatio,
		AudioRatio:           audioRatio,
		AudioCompletionRatio: audioCompletionRatio,
		CacheCreationRatio:   cacheCreationRatio,
		CacheCreation5mRatio: cacheCreationRatio5m,
		CacheCreation1hRatio: cacheCreationRatio1h,
		QuotaToPreConsume:    preConsumedQuota,
		QuotaBeforeGroup:     quotaBeforeGroup,
	}
	if usePrice {
		for name, ratio := range meta.BillingRatios {
			priceData.AddOtherRatio(name, ratio)
		}
		quotaBeforeGroup = priceData.ApplyOtherRatiosToFloat(modelPrice * common.QuotaPerUnit)
		priceData.QuotaBeforeGroup = quotaBeforeGroup
		quotaToPreConsume := quotaBeforeGroup * groupRatioInfo.GroupRatio
		quota, err := common.QuotaFromFloatStrict(quotaToPreConsume)
		if err != nil {
			return hosttypes.PriceData{}, err
		}
		priceData.QuotaToPreConsume = quota
	}

	if common.DebugEnabled {
		logger.LogDebug(c, "model_price_helper result: %s", priceData.ToSetting())
	}
	info.PriceData = priceData
	return priceData, nil
}

// ModelPriceHelperPerCall 按次/按量计费的 PriceHelper (MJ、Task)
func ModelPriceHelperPerCall(c *gin.Context, info *relaycommon.RelayInfo) (hosttypes.PriceData, error) {
	groupRatioInfo := HandleGroupRatio(c, info)
	groupRatioInfo, err := ApplyHubSupplyPricingFromRequest(c,
		groupRatioInfo,
		common.GetContextKeyInt(c, constant.ContextKeyChannelId),
	)
	if err != nil {
		return hosttypes.PriceData{}, err
	}

	modelPrice, success := ratio_setting.GetModelPrice(info.OriginModelName, true)
	usePrice := success
	var modelRatio float64

	if !success {
		defaultPrice, ok := ratio_setting.GetDefaultModelPriceMap()[info.OriginModelName]
		if ok {
			modelPrice = defaultPrice
			usePrice = true
		} else {
			var ratioSuccess bool
			var matchName string
			modelRatio, ratioSuccess, matchName = ratio_setting.GetModelRatio(info.OriginModelName)
			acceptUnsetRatio := false
			if info.UserSetting.AcceptUnsetRatioModel {
				acceptUnsetRatio = true
			}
			if !ratioSuccess && !acceptUnsetRatio {
				return hosttypes.PriceData{}, modelPriceNotConfiguredError(matchName, info.UserId)
			}
		}
	}

	var quota int
	freeModel := false
	var quotaBeforeGroup float64

	if usePrice {
		quotaBeforeGroup = modelPrice * common.QuotaPerUnit
		quota, err = common.QuotaFromFloatStrict(quotaBeforeGroup * groupRatioInfo.GroupRatio)
		if err != nil {
			return hosttypes.PriceData{}, err
		}
		if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
			if groupRatioInfo.GroupRatio == 0 || modelPrice == 0 {
				quota = 0
				freeModel = true
			}
		}
	} else {
		// 按量计费：以模型倍率的一半作为预扣额度
		quotaBeforeGroup = modelRatio / 2 * common.QuotaPerUnit
		quota, err = common.QuotaFromFloatStrict(quotaBeforeGroup * groupRatioInfo.GroupRatio)
		if err != nil {
			return hosttypes.PriceData{}, err
		}
		modelPrice = -1
		if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
			if groupRatioInfo.GroupRatio == 0 || modelRatio == 0 {
				quota = 0
				freeModel = true
			}
		}
	}

	priceData := hosttypes.PriceData{
		FreeModel:        freeModel,
		ModelPrice:       modelPrice,
		ModelRatio:       modelRatio,
		UsePrice:         usePrice,
		Quota:            quota,
		GroupRatioInfo:   groupRatioInfo,
		QuotaBeforeGroup: quotaBeforeGroup,
	}
	return priceData, nil
}

func HasModelBillingConfig(modelName string) bool {
	return model.HasModelBillingConfig(modelName)
}

func modelPriceHelperTiered(c *gin.Context, info *relaycommon.RelayInfo, promptTokens int, meta *types.TokenCountMeta, groupRatioInfo hosttypes.GroupRatioInfo) (hosttypes.PriceData, error) {
	exprStr, ok := billing_setting.GetBillingExpr(info.OriginModelName)
	if !ok {
		return hosttypes.PriceData{}, fmt.Errorf("model %s is configured as tiered_expr but has no billing expression", info.OriginModelName)
	}

	estimatedCompletionTokens := meta.MaxTokens
	if estimatedCompletionTokens == 0 && groupRatioInfo.GroupRatio != 0 {
		estimatedCompletionTokens = defaultTieredPreConsumeMaxTokens
	}

	requestInput, err := ResolveIncomingBillingExprRequestInput(c, info)
	if err != nil {
		return hosttypes.PriceData{}, err
	}

	rawCost, trace, err := billingexpr.RunExprWithRequest(exprStr, billingexpr.TokenParams{
		P:   float64(promptTokens),
		C:   float64(estimatedCompletionTokens),
		Len: float64(promptTokens),
	}, requestInput)
	if err != nil {
		return hosttypes.PriceData{}, fmt.Errorf("model %s tiered expr run failed: %w", info.OriginModelName, err)
	}

	// Expression coefficients are $/1M tokens prices; convert to quota the same way per-call billing does.
	quotaBeforeGroup := rawCost / 1_000_000 * common.QuotaPerUnit
	preConsumedQuota, err := billingexpr.QuotaRoundStrict(quotaBeforeGroup * groupRatioInfo.GroupRatio)
	if err != nil {
		return hosttypes.PriceData{}, err
	}

	freeModel := false
	if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
		if groupRatioInfo.GroupRatio == 0 {
			preConsumedQuota = 0
			freeModel = true
		}
	}

	exprHash := billingexpr.ExprHashString(exprStr)
	snapshot := &billingexpr.BillingSnapshot{
		BillingMode:               billing_setting.BillingModeTieredExpr,
		ModelName:                 info.OriginModelName,
		ExprString:                exprStr,
		ExprHash:                  exprHash,
		GroupRatio:                groupRatioInfo.GroupRatio,
		EstimatedPromptTokens:     promptTokens,
		EstimatedCompletionTokens: estimatedCompletionTokens,
		EstimatedQuotaBeforeGroup: quotaBeforeGroup,
		EstimatedQuotaAfterGroup:  preConsumedQuota,
		EstimatedTier:             trace.MatchedTier,
		QuotaPerUnit:              common.QuotaPerUnit,
		ExprVersion:               billingexpr.ExprVersion(exprStr),
	}
	info.TieredBillingSnapshot = snapshot
	info.BillingRequestInput = &requestInput

	priceData := hosttypes.PriceData{
		FreeModel:         freeModel,
		GroupRatioInfo:    groupRatioInfo,
		QuotaToPreConsume: preConsumedQuota,
		QuotaBeforeGroup:  quotaBeforeGroup,
	}

	logger.LogDebug(c, "model_price_helper_tiered result: model=%s preConsume=%d quotaBeforeGroup=%.2f groupRatio=%.2f tier=%s", info.OriginModelName, preConsumedQuota, quotaBeforeGroup, groupRatioInfo.GroupRatio, trace.MatchedTier)

	info.PriceData = priceData
	return priceData, nil
}
