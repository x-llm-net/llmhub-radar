package relay

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestBindMidjourneyOriginChannelRefreshesSelectedChannelContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/mj/submit/change", nil)

	initialBaseURL := "https://initial.example"
	originBaseURL := "https://origin.example"
	initialChannel := &model.Channel{
		Id:      991001,
		Name:    "initial-channel",
		Type:    constant.ChannelTypeMidjourney,
		Key:     "initial-key",
		BaseURL: &initialBaseURL,
		Status:  common.ChannelStatusEnabled,
	}
	originChannel := &model.Channel{
		Id:      991002,
		Name:    "origin-channel",
		Type:    constant.ChannelTypeMidjourney,
		Key:     "origin-key",
		BaseURL: &originBaseURL,
		Status:  common.ChannelStatusEnabled,
	}

	info := &relaycommon.RelayInfo{OriginModelName: "midjourney"}
	require.Nil(t, middleware.SetupContextForSelectedChannel(ctx, initialChannel, info.OriginModelName))
	info.InitChannelMeta(ctx)
	require.Equal(t, initialChannel.Id, info.ChannelId)

	require.Nil(t, bindMidjourneyOriginChannel(ctx, info, originChannel))

	require.Equal(t, originChannel.Id, common.GetContextKeyInt(ctx, constant.ContextKeyChannelId))
	require.Equal(t, originBaseURL, common.GetContextKeyString(ctx, constant.ContextKeyChannelBaseUrl))
	require.Equal(t, originChannel.Key, common.GetContextKeyString(ctx, constant.ContextKeyChannelKey))
	require.Equal(t, originChannel.Id, info.ChannelId)
	require.Equal(t, originChannel.Id, info.ChannelMeta.ChannelId)
	require.Equal(t, originBaseURL, info.ChannelMeta.ChannelBaseUrl)
	require.Equal(t, originChannel.Key, info.ChannelMeta.ApiKey)

	snapshot, ok := common.GetContextKeyType[model.HubSupplyPricingSnapshot](ctx, constant.ContextKeyHubSupplyPricingSnapshot)
	require.True(t, ok)
	require.Equal(t, originChannel.Id, snapshot.ChannelID)
}
