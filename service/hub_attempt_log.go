package service

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/gin-gonic/gin"
)

type HubRelayAttempt struct {
	AttemptIndex         int     `json:"attempt_index"`
	ServiceTier          string  `json:"service_tier"`
	RoutingPhase         string  `json:"routing_phase"`
	OriginProviderID     int     `json:"origin_provider_id,omitempty"`
	ProviderID           int     `json:"provider_id,omitempty"`
	SupplyGroupID        int     `json:"supply_group_id,omitempty"`
	ChannelID            int     `json:"channel_id"`
	Result               string  `json:"result"`
	ErrorCategory        string  `json:"error_category,omitempty"`
	StatusCode           int     `json:"status_code,omitempty"`
	StartedAt            int64   `json:"started_at"`
	LatencyMS            int64   `json:"latency_ms"`
	FirstTokenMS         int64   `json:"first_token_ms,omitempty"`
	UpstreamRequestID    string  `json:"upstream_request_id,omitempty"`
	SupplyMultiplier     float64 `json:"supply_multiplier,omitempty"`
	BillingRatio         float64 `json:"billing_ratio,omitempty"`
	UpstreamChargeStatus string  `json:"upstream_charge_status"`
}

func IsHubServiceTierRequest(ctx *gin.Context) bool {
	if ctx == nil {
		return false
	}
	return hub_routing_setting.IsServiceTier(
		common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup),
	)
}

func GetHubRelayAttempts(ctx *gin.Context) []HubRelayAttempt {
	if ctx == nil {
		return nil
	}
	value, exists := common.GetContextKey(ctx, constant.ContextKeyHubRelayAttempts)
	if !exists {
		return nil
	}
	attempts, ok := value.([]HubRelayAttempt)
	if !ok {
		return nil
	}
	return append([]HubRelayAttempt(nil), attempts...)
}

func AppendHubRelayAttemptFailure(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, relayErr *types.NewAPIError) {
	if !IsHubServiceTierRequest(ctx) || relayErr == nil {
		return
	}
	attempt := buildHubRelayAttempt(ctx, relayInfo)
	attempt.Result = "failed"
	attempt.StatusCode = relayErr.StatusCode
	attempt.ErrorCategory = string(relayErr.GetErrorType())
	if attempt.ErrorCategory == "" {
		attempt.ErrorCategory = string(relayErr.GetErrorCode())
	}
	attempt.UpstreamChargeStatus = "unknown"
	attempts := GetHubRelayAttempts(ctx)
	attempts = append(attempts, attempt)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttempts, attempts)
}

func AttachHubRelayLogInfo(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, other map[string]interface{}, includeCurrentSuccess bool) {
	if !IsHubServiceTierRequest(ctx) || other == nil {
		return
	}
	serviceTier := common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup)
	other["service_tier"] = serviceTier
	other["origin_provider_id"] = common.GetContextKeyInt(ctx, constant.ContextKeyHubRequestedProviderId)
	other["routing_phase"] = common.GetContextKeyString(ctx, constant.ContextKeyHubRoutingPhase)
	other["served_provider_id"] = common.GetContextKeyInt(ctx, constant.ContextKeyHubRelayAttemptProvider)

	attempts := GetHubRelayAttempts(ctx)
	if includeCurrentSuccess {
		attempt := buildHubRelayAttempt(ctx, relayInfo)
		attempt.Result = "success"
		attempt.StatusCode = 200
		attempt.UpstreamChargeStatus = "charged"
		attempts = append(attempts, attempt)
	}
	if len(attempts) > 0 {
		other["hub_attempts"] = attempts
	}
}

func buildHubRelayAttempt(ctx *gin.Context, relayInfo *relaycommon.RelayInfo) HubRelayAttempt {
	now := time.Now()
	startedAt := now
	if value, exists := common.GetContextKey(ctx, constant.ContextKeyHubRelayAttemptStartedAt); exists {
		if parsed, ok := value.(time.Time); ok && !parsed.IsZero() {
			startedAt = parsed
		}
	}
	attempt := HubRelayAttempt{
		AttemptIndex:      common.GetContextKeyInt(ctx, constant.ContextKeyHubRelayAttemptRetry),
		ServiceTier:       common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup),
		RoutingPhase:      common.GetContextKeyString(ctx, constant.ContextKeyHubRoutingPhase),
		OriginProviderID:  common.GetContextKeyInt(ctx, constant.ContextKeyHubRequestedProviderId),
		ProviderID:        common.GetContextKeyInt(ctx, constant.ContextKeyHubRelayAttemptProvider),
		SupplyGroupID:     common.GetContextKeyInt(ctx, constant.ContextKeyHubRelayAttemptSupply),
		ChannelID:         common.GetContextKeyInt(ctx, constant.ContextKeyChannelId),
		StartedAt:         startedAt.UnixMilli(),
		LatencyMS:         now.Sub(startedAt).Milliseconds(),
		UpstreamRequestID: ctx.GetString(common.UpstreamRequestIdKey),
		SupplyMultiplier:  ctx.GetFloat64(string(constant.ContextKeyHubRelayAttemptMultiplier)),
		BillingRatio:      ctx.GetFloat64(string(constant.ContextKeyHubRelayAttemptBillingRatio)),
	}
	if relayInfo != nil && !relayInfo.FirstResponseTime.IsZero() && relayInfo.FirstResponseTime.After(startedAt) {
		attempt.FirstTokenMS = relayInfo.FirstResponseTime.Sub(startedAt).Milliseconds()
	}
	return attempt
}
