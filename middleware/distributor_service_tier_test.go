package middleware

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type distributorErrorResponse struct {
	Error struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error"`
}

func setupDistributorServiceTierTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	previousDB := model.DB
	previousLogDB := model.LOG_DB
	previousMemoryCacheEnabled := common.MemoryCacheEnabled
	previousRetryTimes := common.RetryTimes
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
	common.RetryTimes = 2
	model.InitChannelCache()

	t.Cleanup(func() {
		model.DB = previousDB
		model.LOG_DB = previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		common.MemoryCacheEnabled = previousMemoryCacheEnabled
		common.RetryTimes = previousRetryTimes
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

	return db
}

func newDistributorServiceTierContext(providerID int) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/v1/chat/completions",
		bytes.NewBufferString(`{"model":"service-tier-recovery-model","messages":[]}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	ctx.Set(common.RequestIdKey, "service-tier-request-id")
	if providerID > 0 {
		common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, providerID)
	}
	return ctx, recorder
}

func TestDistributeServiceTierUnavailableRecoversWithoutChangingToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())

	tests := []struct {
		name          string
		providerID    int
		expectedPhase string
	}{
		{name: "public pool", expectedPhase: "public_pool"},
		{name: "provider fallback", providerID: 42, expectedPhase: "platform_fallback"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := setupDistributorServiceTierTestDB(t)

			ctx, recorder := newDistributorServiceTierContext(test.providerID)
			Distribute()(ctx)

			require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
			require.True(t, ctx.IsAborted())
			var response distributorErrorResponse
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.Equal(t, "service_tier_unavailable", response.Error.Code)
			assert.Contains(t, response.Error.Message, "request id: service-tier-request-id")

			priority := int64(0)
			channel := &model.Channel{
				Name:     "service-tier-recovery-channel",
				Type:     constant.ChannelTypeOpenAI,
				Key:      "test-key",
				Models:   "service-tier-recovery-model",
				Group:    hub_routing_setting.ServiceTierMedium,
				Status:   common.ChannelStatusEnabled,
				Priority: &priority,
			}
			require.NoError(t, db.Create(channel).Error)
			require.NoError(t, db.Create(&model.Ability{
				Group:     hub_routing_setting.ServiceTierMedium,
				Model:     "service-tier-recovery-model",
				ChannelId: channel.Id,
				Enabled:   true,
				Priority:  &priority,
			}).Error)
			model.InitChannelCache()

			recoveredCtx, recoveredRecorder := newDistributorServiceTierContext(test.providerID)
			Distribute()(recoveredCtx)

			assert.False(t, recoveredCtx.IsAborted())
			assert.Equal(t, http.StatusOK, recoveredRecorder.Code)
			assert.Equal(t, channel.Id, common.GetContextKeyInt(recoveredCtx, constant.ContextKeyChannelId))
			assert.Equal(t, test.expectedPhase, common.GetContextKeyString(recoveredCtx, constant.ContextKeyHubRoutingPhase))
		})
	}
}

func TestUnavailableChannelErrorCodePreservesLegacyGroups(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "default")
	assert.Equal(t, "model_not_found", string(unavailableChannelErrorCode(ctx)))
}
