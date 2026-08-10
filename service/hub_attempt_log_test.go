package service

import (
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

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
	require.NotNil(t, attempts[0].FirstEventMS)
	require.NotNil(t, attempts[0].FirstTokenMS)
	require.Equal(t, int64(10), *attempts[0].FirstEventMS)
	require.Equal(t, int64(20), *attempts[0].FirstTokenMS)
	require.Equal(t, "success", attempts[1].Result)
	require.Equal(t, 202, attempts[1].ChannelID)
	require.Equal(t, "gpt-5", attempts[1].Model)
	require.Equal(t, string(constant.EndpointTypeOpenAI), attempts[1].EndpointType)
	require.Equal(t, HubSampleSourceRealRequest, attempts[1].SampleSource)
	require.NotNil(t, attempts[1].FirstEventMS)
	require.NotNil(t, attempts[1].FirstTokenMS)
	require.Equal(t, int64(15), *attempts[1].FirstEventMS)
	require.Equal(t, int64(25), *attempts[1].FirstTokenMS)
}
