package service

import (
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/gin-gonic/gin"
)

const (
	HubSampleSourceRealRequest     = "real_request"
	HubAttemptSkipReasonFailed     = "failed_attempt"
	HubAttemptResultSuccess        = "success"
	HubAttemptResultPartialSuccess = "partial_success"
	HubAttemptResultFailed         = "failed"
	HubConsumerChargeCharged       = "charged"
	HubConsumerChargeNotCharged    = "not_charged"
	HubFailureClassUpstream        = "upstream"
	HubFailureClassConfiguration   = "configuration"
	HubFailureClassClient          = "client"
	HubFailureClassLoop            = "loop"
	HubFailureClassResponseStarted = "response_started"
	HubFailureClassUnknown         = "unknown"
	hubEndpointTypeOpenAIAudio     = "openai-audio"
	hubEndpointTypeOpenAIRealtime  = "openai-realtime"
	hubEndpointTypeMidjourneyProxy = "midjourney-proxy"
	hubEndpointTypeUnknown         = "unknown"
	hubRoutingMetricsRecordedKey   = "hub_routing_metrics_recorded"
	hubFinalAttemptBillingKey      = "hub_final_attempt_billing"
)

type hubFinalAttemptBilling struct {
	Result       string
	ChargedQuota int
}

type HubRelayAttempt struct {
	AttemptIndex int    `json:"attempt_index"`
	Model        string `json:"model"`
	EndpointType string `json:"endpoint_type"`
	SampleSource string `json:"sample_source"`
	SkipReason   string `json:"skip_reason,omitempty"`
	// ServiceTier is retained for legacy service-tier requests. New routing
	// policy tokens use RoutingPolicyMode instead, so their internal default
	// group is not exposed as a user-facing service tier.
	ServiceTier          string  `json:"service_tier,omitempty"`
	RoutingPolicyMode    string  `json:"routing_policy_mode,omitempty"`
	RoutingPhase         string  `json:"routing_phase"`
	OriginProviderID     int     `json:"origin_provider_id,omitempty"`
	ProviderID           int     `json:"provider_id,omitempty"`
	SupplyGroupID        int     `json:"supply_group_id,omitempty"`
	ChannelID            int     `json:"channel_id"`
	Result               string  `json:"result"`
	FailureClass         string  `json:"failure_class,omitempty"`
	HealthEligible       bool    `json:"health_eligible"`
	ErrorCategory        string  `json:"error_category,omitempty"`
	StatusCode           int     `json:"status_code,omitempty"`
	StartedAt            int64   `json:"started_at"`
	LatencyMS            int64   `json:"latency_ms"`
	RequestReadyMS       *int64  `json:"request_ready_ms,omitempty"`
	ConnectionReadyMS    *int64  `json:"connection_ready_ms,omitempty"`
	RequestWrittenMS     *int64  `json:"request_written_ms,omitempty"`
	ResponseHeadersMS    *int64  `json:"response_headers_ms,omitempty"`
	FirstBodyByteMS      *int64  `json:"first_body_byte_ms,omitempty"`
	FirstEventMS         *int64  `json:"first_event_ms,omitempty"`
	FirstTokenMS         *int64  `json:"first_token_ms,omitempty"`
	UpstreamProtocol     string  `json:"upstream_protocol,omitempty"`
	ContentEncoding      string  `json:"content_encoding,omitempty"`
	TransferEncoding     string  `json:"transfer_encoding,omitempty"`
	UpstreamUncompressed bool    `json:"upstream_uncompressed,omitempty"`
	ConnectionReused     bool    `json:"connection_reused,omitempty"`
	UpstreamRequestBytes int64   `json:"upstream_request_bytes,omitempty"`
	UpstreamRequestID    string  `json:"upstream_request_id,omitempty"`
	SupplyMultiplier     float64 `json:"supply_multiplier,omitempty"`
	BillingRatio         float64 `json:"billing_ratio,omitempty"`
	UpstreamChargeStatus string  `json:"upstream_charge_status"`
	ConsumerChargeStatus string  `json:"consumer_charge_status,omitempty"`
	ChargedQuota         *int    `json:"charged_quota,omitempty"`
}

// IsHubTokenRoutingRequest identifies the new multiplier-policy token path.
// Keep this separate from legacy service-tier detection so logs and future
// routing behavior do not depend on the token's compatibility group value.
func IsHubTokenRoutingRequest(ctx *gin.Context) bool {
	if ctx == nil {
		return false
	}
	if _, exists := common.GetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy); exists {
		return true
	}
	return false
}

// IsHubServiceTierRequest is the compatibility predicate used by the shared
// retry, billing, and observability paths. It includes both legacy service
// tiers and the new multiplier-policy token path.
func IsHubServiceTierRequest(ctx *gin.Context) bool {
	if IsHubTokenRoutingRequest(ctx) {
		return true
	}
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
	appendHubRelayAttemptFailure(ctx, relayInfo, relayErr, "")
}

// AppendHubRelayAttemptNonChannelFailure records an attempt that ended after a
// channel was selected but must not affect channel health or auto-disable.
func AppendHubRelayAttemptNonChannelFailure(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, relayErr *types.NewAPIError) {
	appendHubRelayAttemptFailure(ctx, relayInfo, relayErr, HubFailureClassClient)
}

func appendHubRelayAttemptFailure(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, relayErr *types.NewAPIError, failureClass string) {
	if !IsHubServiceTierRequest(ctx) || relayErr == nil {
		return
	}
	attempt := buildHubRelayAttempt(ctx, relayInfo)
	attempt.Result = HubAttemptResultFailed
	attempt.StatusCode = relayErr.StatusCode
	attempt.SkipReason = HubAttemptSkipReasonFailed
	if failureClass == "" {
		failureClass = ClassifyHubAttemptFailure(ctx, relayErr)
	}
	attempt.FailureClass = failureClass
	attempt.HealthEligible = IsHubFailureHealthEligible(attempt.FailureClass)
	attempt.ErrorCategory = string(relayErr.GetErrorCode())
	if attempt.ErrorCategory == "" {
		attempt.ErrorCategory = string(relayErr.GetErrorType())
	}
	attempt.UpstreamChargeStatus = "unknown"
	attempt.ConsumerChargeStatus = HubConsumerChargeNotCharged
	chargedQuota := 0
	attempt.ChargedQuota = &chargedQuota
	attempts := GetHubRelayAttempts(ctx)
	attempts = append(attempts, attempt)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttempts, attempts)
}

// ApplyHubStreamBillingPolicy keeps legacy groups unchanged while making the
// service-tier contract deterministic for abnormal streamed responses.
func ApplyHubStreamBillingPolicy(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, usage *dto.Usage, calculatedQuota int) (int, string) {
	result := ClassifyHubFinalStreamResult(relayInfo, usage)
	if !IsHubServiceTierRequest(ctx) {
		return calculatedQuota, HubAttemptResultSuccess
	}
	chargedQuota := calculatedQuota
	if result == HubAttemptResultFailed {
		chargedQuota = 0
	}
	ctx.Set(hubFinalAttemptBillingKey, hubFinalAttemptBilling{
		Result:       result,
		ChargedQuota: chargedQuota,
	})
	return chargedQuota, result
}

func IsHubPartialStreamResponse(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, usage *dto.Usage) bool {
	return IsHubServiceTierRequest(ctx) &&
		ClassifyHubFinalStreamResult(relayInfo, effectiveBillingUsage(usage)) == HubAttemptResultPartialSuccess
}

func ShouldRecordHubRelaySample(ctx *gin.Context, relayInfo *relaycommon.RelayInfo) bool {
	return !IsHubServiceTierRequest(ctx) || relayInfo == nil || relayInfo.StreamStatus == nil ||
		relayInfo.StreamStatus.EndReason != relaycommon.StreamEndReasonClientGone
}

func ClassifyHubFinalStreamResult(relayInfo *relaycommon.RelayInfo, usage *dto.Usage) string {
	if relayInfo == nil || !relayInfo.IsStream || relayInfo.StreamStatus == nil {
		return HubAttemptResultSuccess
	}
	if relayInfo.StreamStatus.IsNormalEnd() && !relayInfo.StreamStatus.HasErrors() {
		return HubAttemptResultSuccess
	}
	if hasUsableHubStreamOutput(relayInfo, usage) {
		return HubAttemptResultPartialSuccess
	}
	return HubAttemptResultFailed
}

func hasUsableHubStreamOutput(relayInfo *relaycommon.RelayInfo, usage *dto.Usage) bool {
	if relayInfo != nil && relayInfo.HasFirstToken() {
		return true
	}
	if usage == nil {
		return false
	}
	return usage.CompletionTokens > 0 ||
		usage.OutputTokens > 0 ||
		usage.CompletionTokenDetails.TextTokens > 0 ||
		usage.CompletionTokenDetails.ReasoningTokens > 0 ||
		usage.CompletionTokenDetails.ImageTokens > 0 ||
		usage.CompletionTokenDetails.AudioTokens > 0
}

// IsHubFailureHealthEligible marks failures that may be recovered by trying
// another channel. It does not decide whether the request will retry.
func IsHubFailureHealthEligible(failureClass string) bool {
	switch failureClass {
	case HubFailureClassClient, HubFailureClassLoop:
		return false
	default:
		return true
	}
}

// ClassifyHubAttemptFailure provides a stable observation label for a failed
// upstream attempt. It deliberately does not decide whether the request will
// retry; controller.shouldRetry remains the sole retry policy.
func ClassifyHubAttemptFailure(ctx *gin.Context, err *types.NewAPIError) string {
	if err == nil {
		return ""
	}
	if ctx != nil && ctx.Request != nil && ctx.Request.Context().Err() != nil {
		return HubFailureClassClient
	}
	if ctx != nil && ctx.Writer.Written() {
		return HubFailureClassResponseStarted
	}
	code := err.GetErrorCode()
	if code == types.ErrorCodeBadResponseStatusCode && err.GetOriginalStatusCode() == http.StatusBadRequest {
		return HubFailureClassClient
	}
	switch code {
	case types.ErrorCodeRequestLoopDetected:
		return HubFailureClassLoop
	case types.ErrorCodeInvalidRequest,
		types.ErrorCodeReadRequestBodyFailed,
		types.ErrorCodeConvertRequestFailed,
		types.ErrorCodeBadRequestBody,
		types.ErrorCodeAccessDenied,
		types.ErrorCodeSensitiveWordsDetected,
		types.ErrorCodeViolationFeeGrokCSAM:
		return HubFailureClassClient
	case types.ErrorCodeModelPriceError,
		types.ErrorCodeModelNotFound,
		types.ErrorCodeInvalidApiType,
		types.ErrorCodeChannelModelMappedError,
		types.ErrorCodeChannelInvalidKey,
		types.ErrorCodeChannelNoAvailableKey,
		types.ErrorCodeChannelParamOverrideInvalid,
		types.ErrorCodeChannelHeaderOverrideInvalid,
		types.ErrorCodeChannelAwsClientError:
		return HubFailureClassConfiguration
	case types.ErrorCodePromptBlocked:
		return HubFailureClassClient
	case types.ErrorCodeDoRequestFailed,
		types.ErrorCodeReadResponseBodyFailed,
		types.ErrorCodeBadResponseStatusCode,
		types.ErrorCodeBadResponse,
		types.ErrorCodeBadResponseBody,
		types.ErrorCodeEmptyResponse,
		types.ErrorCodeAwsInvokeError:
		return HubFailureClassUpstream
	}
	if err.GetOriginalStatusCode() == http.StatusBadRequest {
		return HubFailureClassClient
	}
	if types.IsChannelError(err) {
		return HubFailureClassConfiguration
	}
	switch err.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
		return HubFailureClassConfiguration
	case http.StatusBadRequest, http.StatusRequestTimeout, http.StatusTooManyRequests:
		if err.StatusCode == http.StatusBadRequest {
			return HubFailureClassClient
		}
		return HubFailureClassUpstream
	}
	if err.StatusCode >= 500 || err.StatusCode < 100 {
		return HubFailureClassUpstream
	}
	if types.IsSkipRetryError(err) {
		return HubFailureClassUnknown
	}
	return HubFailureClassUnknown
}

func AttachHubRelayLogInfo(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, other map[string]interface{}, includeCurrentSuccess bool) {
	if !IsHubServiceTierRequest(ctx) || other == nil {
		return
	}
	if policy := GetHubTokenRoutingPolicy(ctx); policy != nil {
		other["routing_policy_mode"] = policy.Mode
	} else {
		other["service_tier"] = common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup)
	}
	other["origin_provider_id"] = common.GetContextKeyInt(ctx, constant.ContextKeyHubRequestedProviderId)
	other["routing_phase"] = common.GetContextKeyString(ctx, constant.ContextKeyHubRoutingPhase)
	other["served_provider_id"] = common.GetContextKeyInt(ctx, constant.ContextKeyHubRelayAttemptProvider)

	attempts := GetHubRelayAttempts(ctx)
	if includeCurrentSuccess {
		attempt := buildHubFinalRelayAttempt(ctx, relayInfo)
		attempts = append(attempts, attempt)
		RecordHubRelayAttemptMetrics(ctx, relayInfo, true)
	}
	if len(attempts) > 0 {
		other["hub_attempts"] = attempts
	}
}

// RecordHubRelayAttemptMetrics persists one request's complete attempt chain
// into the read-only routing observer. The context guard matters because a
// successful request may pass through more than one log decoration helper.
func RecordHubRelayAttemptMetrics(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, includeCurrentSuccess bool) {
	if !IsHubServiceTierRequest(ctx) || ctx == nil || ctx.GetBool(hubRoutingMetricsRecordedKey) {
		return
	}
	attempts := GetHubRelayAttempts(ctx)
	if includeCurrentSuccess {
		attempt := buildHubFinalRelayAttempt(ctx, relayInfo)
		attempts = append(attempts, attempt)
	}
	if len(attempts) == 0 {
		return
	}
	samples := make([]perfmetrics.HubRoutingAttempt, 0, len(attempts))
	for _, attempt := range attempts {
		samples = append(samples, perfmetrics.HubRoutingAttempt{
			Model:          attempt.Model,
			EndpointType:   attempt.EndpointType,
			ProviderID:     attempt.ProviderID,
			ChannelID:      attempt.ChannelID,
			Success:        attempt.Result == HubAttemptResultSuccess,
			FailureClass:   attempt.FailureClass,
			HealthEligible: attempt.HealthEligible,
			LatencyMS:      attempt.LatencyMS,
			FirstTokenMS:   attempt.FirstTokenMS,
		})
	}
	perfmetrics.RecordHubRoutingAttempts(samples)
	ctx.Set(hubRoutingMetricsRecordedKey, true)
}

func buildHubFinalRelayAttempt(ctx *gin.Context, relayInfo *relaycommon.RelayInfo) HubRelayAttempt {
	attempt := buildHubRelayAttempt(ctx, relayInfo)
	attempt.Result = ClassifyHubFinalStreamResult(relayInfo, nil)
	if value, exists := ctx.Get(hubFinalAttemptBillingKey); exists {
		if billing, ok := value.(hubFinalAttemptBilling); ok {
			attempt.Result = billing.Result
			chargedQuota := billing.ChargedQuota
			attempt.ChargedQuota = &chargedQuota
			attempt.ConsumerChargeStatus = HubConsumerChargeNotCharged
			if chargedQuota > 0 {
				attempt.ConsumerChargeStatus = HubConsumerChargeCharged
			}
		}
	}
	attempt.StatusCode = http.StatusOK
	attempt.HealthEligible = true
	attempt.UpstreamChargeStatus = "charged"
	if attempt.Result == HubAttemptResultSuccess {
		return attempt
	}

	attempt.FailureClass = HubFailureClassResponseStarted
	if relayInfo != nil && relayInfo.StreamStatus != nil {
		attempt.ErrorCategory = string(relayInfo.StreamStatus.EndReason)
		if relayInfo.StreamStatus.EndReason == relaycommon.StreamEndReasonClientGone {
			attempt.FailureClass = HubFailureClassClient
		}
	}
	attempt.HealthEligible = IsHubFailureHealthEligible(attempt.FailureClass)
	if attempt.Result == HubAttemptResultFailed {
		attempt.SkipReason = HubAttemptSkipReasonFailed
		attempt.UpstreamChargeStatus = "unknown"
	}
	return attempt
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
		Model:             hubAttemptModel(ctx, relayInfo),
		EndpointType:      hubAttemptEndpointType(relayInfo),
		SampleSource:      HubSampleSourceRealRequest,
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
	if policy := GetHubTokenRoutingPolicy(ctx); policy != nil {
		attempt.RoutingPolicyMode = policy.Mode
	} else {
		attempt.ServiceTier = common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup)
	}
	if relayInfo != nil {
		attempt.RequestReadyMS = elapsedMilliseconds(startedAt, relayInfo.OutboundRequestReadyTime)
		attempt.ConnectionReadyMS = elapsedMilliseconds(startedAt, relayInfo.UpstreamConnectionReadyTime)
		attempt.RequestWrittenMS = elapsedMilliseconds(startedAt, relayInfo.UpstreamRequestWrittenTime)
		attempt.ResponseHeadersMS = elapsedMilliseconds(startedAt, relayInfo.ResponseHeadersTime)
		attempt.FirstBodyByteMS = elapsedMilliseconds(startedAt, relayInfo.FirstBodyByteTime)
		attempt.FirstEventMS = elapsedMilliseconds(startedAt, relayInfo.FirstResponseTime)
		if relayInfo.IsStream {
			attempt.FirstTokenMS = elapsedMilliseconds(startedAt, relayInfo.FirstTokenTime)
		}
		attempt.UpstreamProtocol = relayInfo.UpstreamProtocol
		attempt.ContentEncoding = relayInfo.UpstreamContentEncoding
		attempt.TransferEncoding = relayInfo.UpstreamTransferEncoding
		attempt.UpstreamUncompressed = relayInfo.UpstreamUncompressed
		attempt.ConnectionReused = relayInfo.UpstreamConnectionReused
		attempt.UpstreamRequestBytes = relayInfo.UpstreamRequestBodySize
	}
	return attempt
}

func hubAttemptModel(ctx *gin.Context, relayInfo *relaycommon.RelayInfo) string {
	if relayInfo != nil && relayInfo.OriginModelName != "" {
		return relayInfo.OriginModelName
	}
	return common.GetContextKeyString(ctx, constant.ContextKeyOriginalModel)
}

func hubAttemptEndpointType(relayInfo *relaycommon.RelayInfo) string {
	if relayInfo == nil {
		return hubEndpointTypeUnknown
	}
	switch relayInfo.GetFinalRequestRelayFormat() {
	case types.RelayFormatClaude:
		return string(constant.EndpointTypeAnthropic)
	case types.RelayFormatGemini:
		return string(constant.EndpointTypeGemini)
	case types.RelayFormatOpenAIResponses:
		return string(constant.EndpointTypeOpenAIResponse)
	case types.RelayFormatOpenAIResponsesCompaction:
		return string(constant.EndpointTypeOpenAIResponseCompact)
	case types.RelayFormatOpenAIAlphaSearch:
		return string(constant.EndpointTypeOpenAIAlphaSearch)
	case types.RelayFormatOpenAIImage:
		return string(constant.EndpointTypeImageGeneration)
	case types.RelayFormatEmbedding:
		return string(constant.EndpointTypeEmbeddings)
	case types.RelayFormatRerank:
		return string(constant.EndpointTypeJinaRerank)
	case types.RelayFormatOpenAIAudio:
		return hubEndpointTypeOpenAIAudio
	case types.RelayFormatOpenAIRealtime:
		return hubEndpointTypeOpenAIRealtime
	case types.RelayFormatTask:
		return string(constant.EndpointTypeOpenAIVideo)
	case types.RelayFormatMjProxy:
		return hubEndpointTypeMidjourneyProxy
	case types.RelayFormatOpenAI:
		return hubOpenAIEndpointType(relayInfo.RelayMode)
	default:
		return hubEndpointTypeUnknown
	}
}

func hubOpenAIEndpointType(relayMode int) string {
	switch relayMode {
	case relayconstant.RelayModeResponses:
		return string(constant.EndpointTypeOpenAIResponse)
	case relayconstant.RelayModeResponsesCompact:
		return string(constant.EndpointTypeOpenAIResponseCompact)
	case relayconstant.RelayModeAlphaSearch:
		return string(constant.EndpointTypeOpenAIAlphaSearch)
	case relayconstant.RelayModeEmbeddings:
		return string(constant.EndpointTypeEmbeddings)
	case relayconstant.RelayModeRerank:
		return string(constant.EndpointTypeJinaRerank)
	case relayconstant.RelayModeImagesGenerations, relayconstant.RelayModeImagesEdits:
		return string(constant.EndpointTypeImageGeneration)
	case relayconstant.RelayModeRealtime:
		return hubEndpointTypeOpenAIRealtime
	case relayconstant.RelayModeAudioSpeech, relayconstant.RelayModeAudioTranscription, relayconstant.RelayModeAudioTranslation:
		return hubEndpointTypeOpenAIAudio
	default:
		return string(constant.EndpointTypeOpenAI)
	}
}

func elapsedMilliseconds(startedAt, observedAt time.Time) *int64 {
	if observedAt.IsZero() || observedAt.Before(startedAt) {
		return nil
	}
	value := observedAt.Sub(startedAt).Milliseconds()
	return &value
}
