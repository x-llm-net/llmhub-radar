package controller

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	taskdto "github.com/QuantumNous/new-api/dto"
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
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.Log{}))

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

func TestFinalizeServiceTierRetryErrorUsesStableContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())

	ctx := newRelayChannelSelectionContext(hub_routing_setting.ServiceTierMedium)
	info := &relaycommon.RelayInfo{
		OriginModelName: "claude-opus-test",
		TokenGroup:      hub_routing_setting.ServiceTierMedium,
	}
	upstreamErr := types.NewOpenAIError(errors.New("upstream returned 503"), types.ErrorCodeBadResponseStatusCode, http.StatusServiceUnavailable)

	finalErr := finalizeServiceTierRetryError(ctx, info, upstreamErr, true)

	require.NotNil(t, finalErr)
	assert.Equal(t, types.ErrorCodeServiceTierUnavailable, finalErr.GetErrorCode())
	assert.Equal(t, http.StatusServiceUnavailable, finalErr.StatusCode)
	assert.True(t, types.IsSkipRetryError(finalErr))
	assert.Contains(t, finalErr.Error(), "standard service tier")
	assert.NotContains(t, finalErr.Error(), "upstream returned 503")
}

func TestFinalizeServiceTierRetryErrorPreservesNonExhaustedAndLegacyErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	upstreamErr := types.NewOpenAIError(errors.New("upstream returned 503"), types.ErrorCodeBadResponseStatusCode, http.StatusServiceUnavailable)

	serviceTierCtx := newRelayChannelSelectionContext(hub_routing_setting.ServiceTierMedium)
	serviceTierInfo := &relaycommon.RelayInfo{OriginModelName: "test-model", TokenGroup: hub_routing_setting.ServiceTierMedium}
	assert.Same(t, upstreamErr, finalizeServiceTierRetryError(serviceTierCtx, serviceTierInfo, upstreamErr, false))

	legacyCtx := newRelayChannelSelectionContext("default")
	legacyInfo := &relaycommon.RelayInfo{OriginModelName: "test-model", TokenGroup: "default"}
	assert.Same(t, upstreamErr, finalizeServiceTierRetryError(legacyCtx, legacyInfo, upstreamErr, true))
}

func TestServiceTierWritesOnlyFinalRequestErrorLog(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupRelayServiceTierTestDB(t)
	common.MemoryCacheEnabled = false
	previousRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() {
		common.RedisEnabled = previousRedisEnabled
	})

	previousErrorLogEnabled := constant.ErrorLogEnabled
	constant.ErrorLogEnabled = true
	t.Cleanup(func() {
		constant.ErrorLogEnabled = previousErrorLogEnabled
	})

	apiErr := types.NewOpenAIError(errors.New("upstream returned 503"), types.ErrorCodeBadResponseStatusCode, http.StatusServiceUnavailable)
	serviceTierCtx := newRelayChannelSelectionContext(hub_routing_setting.ServiceTierMedium)
	processChannelError(serviceTierCtx, *types.NewChannelError(1, constant.ChannelTypeOpenAI, "tier-channel", false, "", false), apiErr)

	var count int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("type = ?", model.LogTypeError).Count(&count).Error)
	assert.Zero(t, count)

	recordHubFinalRelayError(serviceTierCtx, &relaycommon.RelayInfo{OriginModelName: "test-model"}, apiErr)
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("type = ?", model.LogTypeError).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestLegacyGroupKeepsPerAttemptErrorLog(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupRelayServiceTierTestDB(t)
	common.MemoryCacheEnabled = false
	previousRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() {
		common.RedisEnabled = previousRedisEnabled
	})

	previousErrorLogEnabled := constant.ErrorLogEnabled
	constant.ErrorLogEnabled = true
	t.Cleanup(func() {
		constant.ErrorLogEnabled = previousErrorLogEnabled
	})

	apiErr := types.NewOpenAIError(errors.New("upstream returned 503"), types.ErrorCodeBadResponseStatusCode, http.StatusServiceUnavailable)
	legacyCtx := newRelayChannelSelectionContext("default")
	processChannelError(legacyCtx, *types.NewChannelError(1, constant.ChannelTypeOpenAI, "legacy-channel", false, "", false), apiErr)

	var count int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("type = ?", model.LogTypeError).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestServiceTierTaskErrorWritesFinalRequestLog(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupRelayServiceTierTestDB(t)
	common.MemoryCacheEnabled = false
	previousRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() {
		common.RedisEnabled = previousRedisEnabled
	})

	ctx := newRelayChannelSelectionContext(hub_routing_setting.ServiceTierMedium)
	recordHubFinalTaskError(ctx, &relaycommon.RelayInfo{OriginModelName: "task-model"}, &taskdto.TaskError{
		Code:       string(types.ErrorCodeBadResponseStatusCode),
		Message:    "task upstream returned 503",
		StatusCode: http.StatusServiceUnavailable,
		Error:      errors.New("task upstream returned 503"),
	})

	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("type = ?", model.LogTypeError).Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Equal(t, "relay-service-tier-request-id", logs[0].RequestId)
	assert.Contains(t, logs[0].Content, "task upstream returned 503")
}
