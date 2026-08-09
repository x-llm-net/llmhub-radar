package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupRelayServiceTierTestDB(t *testing.T) {
	t.Helper()

	previousDB := model.DB
	previousLogDB := model.LOG_DB
	previousMemoryCacheEnabled := common.MemoryCacheEnabled
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))

	model.DB = db
	model.LOG_DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.MemoryCacheEnabled = true
	model.InitChannelCache()

	t.Cleanup(func() {
		model.DB = previousDB
		model.LOG_DB = previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		common.MemoryCacheEnabled = previousMemoryCacheEnabled
		if previousDB != nil {
			model.InitChannelCache()
		} else {
			require.NoError(t, model.RefreshHubSupplyPricingCache())
		}
		sqlDB, sqlErr := db.DB()
		if sqlErr == nil {
			require.NoError(t, sqlDB.Close())
		}
	})
}

func newRelayChannelSelectionContext(group string) *gin.Context {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, group)
	ctx.Set(common.RequestIdKey, "relay-service-tier-request-id")
	return ctx
}

func getUnavailableTestChannel(t *testing.T, group string) (*gin.Context, *types.NewAPIError) {
	t.Helper()
	ctx := newRelayChannelSelectionContext(group)
	info := &relaycommon.RelayInfo{
		OriginModelName: "service-tier-unavailable-model",
		TokenGroup:      group,
		ChannelMeta:     &relaycommon.ChannelMeta{},
	}
	retryParam := &service.RetryParam{
		Ctx:         ctx,
		TokenGroup:  group,
		ModelName:   info.OriginModelName,
		RequestPath: ctx.Request.URL.Path,
		Retry:       common.GetPointer(0),
	}

	channel, apiErr := getChannel(ctx, info, retryParam)
	require.Nil(t, channel)
	require.NotNil(t, apiErr)
	return ctx, apiErr
}

func TestGetChannelReturnsStableServiceTierUnavailableError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	setupRelayServiceTierTestDB(t)

	ctx, apiErr := getUnavailableTestChannel(t, hub_routing_setting.ServiceTierMedium)
	assert.Equal(t, types.ErrorCodeServiceTierUnavailable, apiErr.GetErrorCode())
	assert.Equal(t, http.StatusServiceUnavailable, apiErr.StatusCode)
	assert.True(t, types.IsSkipRetryError(apiErr))
	assert.False(t, shouldRetry(ctx, apiErr, 3))

	taskErr := taskErrorFromChannelSelection(ctx, apiErr)
	assert.Equal(t, string(types.ErrorCodeServiceTierUnavailable), taskErr.Code)
	assert.Equal(t, http.StatusServiceUnavailable, taskErr.StatusCode)
	assert.True(t, taskErr.LocalError)
	assert.Contains(t, taskErr.Message, "request id: relay-service-tier-request-id")
	assert.Contains(t, taskErr.Message, "standard service tier")
	assert.NotContains(t, taskErr.Message, "distributor")
	assert.NotContains(t, taskErr.Message, "under group")
}

func TestGetChannelPreservesLegacyGroupErrorContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupRelayServiceTierTestDB(t)

	ctx, apiErr := getUnavailableTestChannel(t, "default")
	assert.Equal(t, types.ErrorCodeGetChannelFailed, apiErr.GetErrorCode())
	assert.Equal(t, http.StatusInternalServerError, apiErr.StatusCode)
	assert.True(t, types.IsSkipRetryError(apiErr))

	taskErr := taskErrorFromChannelSelection(ctx, apiErr)
	assert.Equal(t, "get_channel_failed", taskErr.Code)
	assert.Equal(t, http.StatusInternalServerError, taskErr.StatusCode)
}
