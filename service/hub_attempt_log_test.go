package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClassifyHubAttemptFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	mappedBadRequest := types.NewErrorWithStatusCode(errors.New("upstream bad request"), types.ErrorCodeBadResponseStatusCode, http.StatusBadRequest)
	ResetStatusCode(mappedBadRequest, `{"400":503}`)
	tests := []struct {
		name string
		err  *types.NewAPIError
		want string
	}{
		{name: "upstream timeout", err: types.NewErrorWithStatusCode(errors.New("timeout"), types.ErrorCodeBadResponseStatusCode, 504), want: HubFailureClassUpstream},
		{name: "channel configuration", err: types.NewError(errors.New("bad key"), types.ErrorCodeChannelInvalidKey), want: HubFailureClassConfiguration},
		{name: "client request", err: types.NewErrorWithStatusCode(errors.New("bad request"), types.ErrorCodeInvalidRequest, http.StatusBadRequest), want: HubFailureClassClient},
		{name: "prompt blocked", err: types.NewErrorWithStatusCode(errors.New("blocked"), types.ErrorCodePromptBlocked, http.StatusBadRequest), want: HubFailureClassClient},
		{name: "mapped bad request", err: mappedBadRequest, want: HubFailureClassClient},
		{name: "loop protection", err: types.NewErrorWithStatusCode(errors.New("loop"), types.ErrorCodeRequestLoopDetected, http.StatusLoopDetected), want: HubFailureClassLoop},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.want, ClassifyHubAttemptFailure(ctx, test.err))
		})
	}
	_, _ = ctx.Writer.Write([]byte("started"))
	assert.Equal(t, HubFailureClassResponseStarted, ClassifyHubAttemptFailure(ctx, tests[0].err))

	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil).WithContext(canceledCtx)
	assert.Equal(t, HubFailureClassClient, ClassifyHubAttemptFailure(ctx, tests[0].err))
}

func TestIsHubFailureHealthEligible(t *testing.T) {
	assert.True(t, IsHubFailureHealthEligible(HubFailureClassUpstream))
	assert.True(t, IsHubFailureHealthEligible(HubFailureClassConfiguration))
	assert.True(t, IsHubFailureHealthEligible(HubFailureClassResponseStarted))
	assert.True(t, IsHubFailureHealthEligible(HubFailureClassUnknown))
	assert.False(t, IsHubFailureHealthEligible(HubFailureClassClient))
	assert.False(t, IsHubFailureHealthEligible(HubFailureClassLoop))
}

func TestClassifyHubFinalStreamResult(t *testing.T) {
	start := time.Now().Add(-time.Second)

	normal := relaycommon.NewStreamStatus()
	normal.SetEndReason(relaycommon.StreamEndReasonDone, nil)
	assert.Equal(t, HubAttemptResultSuccess, ClassifyHubFinalStreamResult(&relaycommon.RelayInfo{
		IsStream:     true,
		StreamStatus: normal,
	}, nil))

	timedOut := relaycommon.NewStreamStatus()
	timedOut.SetEndReason(relaycommon.StreamEndReasonTimeout, nil)
	assert.Equal(t, HubAttemptResultFailed, ClassifyHubFinalStreamResult(&relaycommon.RelayInfo{
		IsStream:     true,
		StreamStatus: timedOut,
	}, &dto.Usage{PromptTokens: 10}))
	assert.Equal(t, HubAttemptResultPartialSuccess, ClassifyHubFinalStreamResult(&relaycommon.RelayInfo{
		IsStream:       true,
		StartTime:      start,
		FirstTokenTime: start.Add(100 * time.Millisecond),
		StreamStatus:   timedOut,
	}, nil))
	assert.Equal(t, HubAttemptResultPartialSuccess, ClassifyHubFinalStreamResult(&relaycommon.RelayInfo{
		IsStream:     true,
		StreamStatus: timedOut,
	}, &dto.Usage{OutputTokens: 3}))

	softError := relaycommon.NewStreamStatus()
	softError.SetEndReason(relaycommon.StreamEndReasonDone, nil)
	softError.RecordError("malformed chunk")
	assert.Equal(t, HubAttemptResultFailed, ClassifyHubFinalStreamResult(&relaycommon.RelayInfo{
		IsStream:     true,
		StreamStatus: softError,
	}, nil))
}

func TestApplyHubStreamBillingPolicyOnlyChangesServiceTiers(t *testing.T) {
	original := *hub_routing_setting.Get()
	t.Cleanup(func() { require.NoError(t, hub_routing_setting.Publish(original)) })

	gin.SetMode(gin.TestMode)
	failedStatus := relaycommon.NewStreamStatus()
	failedStatus.SetEndReason(relaycommon.StreamEndReasonTimeout, nil)
	failedInfo := &relaycommon.RelayInfo{IsStream: true, StreamStatus: failedStatus}

	hubCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(hubCtx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	quota, result := ApplyHubStreamBillingPolicy(hubCtx, failedInfo, &dto.Usage{PromptTokens: 10}, 123)
	assert.Equal(t, 0, quota)
	assert.Equal(t, HubAttemptResultFailed, result)
	failedOther := map[string]interface{}{}
	AttachHubRelayLogInfo(hubCtx, failedInfo, failedOther, true)
	failedAttempts, ok := failedOther["hub_attempts"].([]HubRelayAttempt)
	require.True(t, ok)
	require.Len(t, failedAttempts, 1)
	assert.Equal(t, HubConsumerChargeNotCharged, failedAttempts[0].ConsumerChargeStatus)
	require.NotNil(t, failedAttempts[0].ChargedQuota)
	assert.Zero(t, *failedAttempts[0].ChargedQuota)

	legacyCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(legacyCtx, constant.ContextKeyUsingGroup, "default")
	quota, result = ApplyHubStreamBillingPolicy(legacyCtx, failedInfo, &dto.Usage{PromptTokens: 10}, 123)
	assert.Equal(t, 123, quota)
	assert.Equal(t, HubAttemptResultSuccess, result)

	partialInfo := &relaycommon.RelayInfo{
		IsStream:       true,
		StartTime:      time.Now().Add(-time.Second),
		FirstTokenTime: time.Now(),
		StreamStatus:   failedStatus,
	}
	quota, result = ApplyHubStreamBillingPolicy(hubCtx, partialInfo, &dto.Usage{CompletionTokens: 5}, 88)
	assert.Equal(t, 88, quota)
	assert.Equal(t, HubAttemptResultPartialSuccess, result)
}

func TestHubFinalAttemptRecordsPartialChargeAndClientDisconnect(t *testing.T) {
	original := *hub_routing_setting.Get()
	t.Cleanup(func() { require.NoError(t, hub_routing_setting.Publish(original)) })

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	common.SetContextKey(ctx, constant.ContextKeyChannelId, 101)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptStartedAt, time.Now().Add(-time.Second))

	status := relaycommon.NewStreamStatus()
	status.SetEndReason(relaycommon.StreamEndReasonClientGone, context.Canceled)
	info := &relaycommon.RelayInfo{
		IsStream:       true,
		StartTime:      time.Now().Add(-time.Second),
		FirstTokenTime: time.Now(),
		StreamStatus:   status,
	}
	quota, result := ApplyHubStreamBillingPolicy(ctx, info, &dto.Usage{CompletionTokens: 5}, 88)
	require.Equal(t, 88, quota)
	require.Equal(t, HubAttemptResultPartialSuccess, result)
	assert.False(t, ShouldRecordHubRelaySample(ctx, info))

	other := map[string]interface{}{}
	AttachHubRelayLogInfo(ctx, info, other, true)
	attempts, ok := other["hub_attempts"].([]HubRelayAttempt)
	require.True(t, ok)
	require.Len(t, attempts, 1)
	assert.Equal(t, HubAttemptResultPartialSuccess, attempts[0].Result)
	assert.Equal(t, HubFailureClassClient, attempts[0].FailureClass)
	assert.False(t, attempts[0].HealthEligible)
	assert.Equal(t, HubConsumerChargeCharged, attempts[0].ConsumerChargeStatus)
	require.NotNil(t, attempts[0].ChargedQuota)
	assert.Equal(t, 88, *attempts[0].ChargedQuota)
}

func TestAppendHubRelayAttemptNonChannelFailureIsNotHealthEligible(t *testing.T) {
	original := *hub_routing_setting.Get()
	t.Cleanup(func() { require.NoError(t, hub_routing_setting.Publish(original)) })

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/videos", nil)
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	common.SetContextKey(ctx, constant.ContextKeyChannelId, 101)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptStartedAt, time.Now())
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptRetry, 0)

	relayErr := types.NewErrorWithStatusCode(errors.New("invalid task request"), types.ErrorCode("invalid_task_request"), http.StatusBadRequest)
	AppendHubRelayAttemptNonChannelFailure(ctx, &relaycommon.RelayInfo{OriginModelName: "video-model"}, relayErr)

	attempts := GetHubRelayAttempts(ctx)
	require.Len(t, attempts, 1)
	assert.Equal(t, HubFailureClassClient, attempts[0].FailureClass)
	assert.False(t, attempts[0].HealthEligible)
	assert.Equal(t, "invalid_task_request", attempts[0].ErrorCategory)
}

func TestTTFTIsOmittedForNonStreamLogs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	startedAt := time.Now().Add(-time.Second)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptStartedAt, startedAt)

	info := &relaycommon.RelayInfo{
		StartTime:                   startedAt,
		OutboundRequestReadyTime:    startedAt.Add(20 * time.Millisecond),
		UpstreamConnectionReadyTime: startedAt.Add(25 * time.Millisecond),
		UpstreamRequestWrittenTime:  startedAt.Add(30 * time.Millisecond),
		UpstreamConnectionReused:    true,
		UpstreamRequestBodySize:     65536,
		ResponseHeadersTime:         startedAt.Add(40 * time.Millisecond),
		FirstBodyByteTime:           startedAt.Add(60 * time.Millisecond),
		FirstResponseTime:           startedAt.Add(100 * time.Millisecond),
		FirstTokenTime:              startedAt.Add(200 * time.Millisecond),
		UpstreamProtocol:            "HTTP/2.0",
		UpstreamContentEncoding:     "identity",
		ChannelMeta:                 &relaycommon.ChannelMeta{},
	}
	attempt := buildHubRelayAttempt(ctx, info)
	require.NotNil(t, attempt.RequestReadyMS)
	require.NotNil(t, attempt.ConnectionReadyMS)
	require.NotNil(t, attempt.RequestWrittenMS)
	require.NotNil(t, attempt.ResponseHeadersMS)
	require.NotNil(t, attempt.FirstBodyByteMS)
	assert.Equal(t, int64(20), *attempt.RequestReadyMS)
	assert.Equal(t, int64(25), *attempt.ConnectionReadyMS)
	assert.Equal(t, int64(30), *attempt.RequestWrittenMS)
	assert.True(t, attempt.ConnectionReused)
	assert.Equal(t, int64(65536), attempt.UpstreamRequestBytes)
	assert.Equal(t, int64(40), *attempt.ResponseHeadersMS)
	assert.Equal(t, int64(60), *attempt.FirstBodyByteMS)
	assert.Equal(t, "HTTP/2.0", attempt.UpstreamProtocol)
	assert.Equal(t, "identity", attempt.ContentEncoding)
	require.NotNil(t, attempt.FirstEventMS)
	assert.Nil(t, attempt.FirstTokenMS)
	other := GenerateTextOtherInfo(ctx, info, 1, 1, 1, 0, 0, 0, 1)
	assert.NotContains(t, other, "ttft")

	info.IsStream = true
	attempt = buildHubRelayAttempt(ctx, info)
	require.NotNil(t, attempt.FirstTokenMS)
	assert.Equal(t, int64(200), *attempt.FirstTokenMS)
	other = GenerateTextOtherInfo(ctx, info, 1, 1, 1, 0, 0, 0, 1)
	assert.Equal(t, float64(200), other["ttft"])
}

func TestHubRelayAttemptLogPreservesFailureBeforeSuccess(t *testing.T) {
	original := *hub_routing_setting.Get()
	t.Cleanup(func() { require.NoError(t, hub_routing_setting.Publish(original)) })

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, 7)
	common.SetContextKey(ctx, constant.ContextKeyHubRoutingPhase, "preferred")
	common.SetContextKey(ctx, constant.ContextKeyChannelId, 101)
	failureStartedAt := time.Now().Add(-50 * time.Millisecond)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptStartedAt, failureStartedAt)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptRetry, 0)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptProvider, 7)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptSupply, 8)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptMultiplier, 0.4)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptBillingRatio, 0.4)

	failure := types.NewErrorWithStatusCode(errors.New("upstream timeout"), types.ErrorCodeBadResponseStatusCode, 504)
	AppendHubRelayAttemptFailure(ctx, &relaycommon.RelayInfo{
		OriginModelName:   "claude-opus-5",
		RelayFormat:       types.RelayFormatClaude,
		IsStream:          true,
		FirstResponseTime: failureStartedAt.Add(10 * time.Millisecond),
		FirstTokenTime:    failureStartedAt.Add(20 * time.Millisecond),
	}, failure)

	common.SetContextKey(ctx, constant.ContextKeyHubRoutingPhase, "platform_fallback")
	common.SetContextKey(ctx, constant.ContextKeyChannelId, 202)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptRetry, 1)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptProvider, 9)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptSupply, 10)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptMultiplier, 0.5)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptBillingRatio, 0.5)
	successStartedAt := time.Now().Add(-50 * time.Millisecond)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptStartedAt, successStartedAt)

	other := map[string]interface{}{}
	AttachHubRelayLogInfo(ctx, &relaycommon.RelayInfo{
		OriginModelName:   "gpt-5",
		RelayFormat:       types.RelayFormatOpenAI,
		IsStream:          true,
		FirstResponseTime: successStartedAt.Add(15 * time.Millisecond),
		FirstTokenTime:    successStartedAt.Add(25 * time.Millisecond),
	}, other, true)
	attempts, ok := other["hub_attempts"].([]HubRelayAttempt)
	require.True(t, ok)
	require.Len(t, attempts, 2)
	require.Equal(t, "failed", attempts[0].Result)
	require.Equal(t, 101, attempts[0].ChannelID)
	require.Equal(t, "claude-opus-5", attempts[0].Model)
	require.Equal(t, string(constant.EndpointTypeAnthropic), attempts[0].EndpointType)
	require.Equal(t, HubSampleSourceRealRequest, attempts[0].SampleSource)
	require.Equal(t, HubAttemptSkipReasonFailed, attempts[0].SkipReason)
	require.Equal(t, HubFailureClassUpstream, attempts[0].FailureClass)
	require.True(t, attempts[0].HealthEligible)
	require.Equal(t, HubConsumerChargeNotCharged, attempts[0].ConsumerChargeStatus)
	require.NotNil(t, attempts[0].ChargedQuota)
	require.Zero(t, *attempts[0].ChargedQuota)
	require.NotNil(t, attempts[0].FirstEventMS)
	require.NotNil(t, attempts[0].FirstTokenMS)
	require.Equal(t, int64(10), *attempts[0].FirstEventMS)
	require.Equal(t, int64(20), *attempts[0].FirstTokenMS)
	require.Equal(t, "success", attempts[1].Result)
	require.Equal(t, 202, attempts[1].ChannelID)
	require.Equal(t, "gpt-5", attempts[1].Model)
	require.Equal(t, string(constant.EndpointTypeOpenAI), attempts[1].EndpointType)
	require.Equal(t, HubSampleSourceRealRequest, attempts[1].SampleSource)
	require.True(t, attempts[1].HealthEligible)
	require.NotNil(t, attempts[1].FirstEventMS)
	require.NotNil(t, attempts[1].FirstTokenMS)
	require.Equal(t, int64(15), *attempts[1].FirstEventMS)
	require.Equal(t, int64(25), *attempts[1].FirstTokenMS)
}
