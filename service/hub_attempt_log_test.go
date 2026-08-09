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
	t.Cleanup(func() { *hub_routing_setting.Get() = original })

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, 7)
	common.SetContextKey(ctx, constant.ContextKeyHubRoutingPhase, "preferred")
	common.SetContextKey(ctx, constant.ContextKeyChannelId, 101)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptStartedAt, time.Now().Add(-50*time.Millisecond))
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptRetry, 0)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptProvider, 7)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptSupply, 8)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptMultiplier, 0.4)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptBillingRatio, 0.4)

	failure := types.NewErrorWithStatusCode(errors.New("upstream timeout"), types.ErrorCodeBadResponseStatusCode, 504)
	AppendHubRelayAttemptFailure(ctx, &relaycommon.RelayInfo{}, failure)

	common.SetContextKey(ctx, constant.ContextKeyHubRoutingPhase, "platform_fallback")
	common.SetContextKey(ctx, constant.ContextKeyChannelId, 202)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptRetry, 1)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptProvider, 9)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptSupply, 10)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptMultiplier, 0.5)
	common.SetContextKey(ctx, constant.ContextKeyHubRelayAttemptBillingRatio, 0.5)

	other := map[string]interface{}{}
	AttachHubRelayLogInfo(ctx, &relaycommon.RelayInfo{}, other, true)
	attempts, ok := other["hub_attempts"].([]HubRelayAttempt)
	require.True(t, ok)
	require.Len(t, attempts, 2)
	require.Equal(t, "failed", attempts[0].Result)
	require.Equal(t, 101, attempts[0].ChannelID)
	require.Equal(t, "success", attempts[1].Result)
	require.Equal(t, 202, attempts[1].ChannelID)
}
