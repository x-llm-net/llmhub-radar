package relay

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupRelayTaskPolicyProviderDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	previousLogDB := model.LOG_DB
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}, &model.HubSupplyGroup{}))
	model.DB = db
	model.LOG_DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.Create(&model.HubProvider{Id: 7, OwnerUserId: 7007, Name: "origin", Slug: "origin", Status: model.HubProviderStatusActive}).Error)
	require.NoError(t, db.Create(&model.HubProvider{Id: 8, OwnerUserId: 7008, Name: "other", Slug: "other", Status: model.HubProviderStatusActive}).Error)
	require.NoError(t, db.Create(&model.HubProvider{Id: 9, OwnerUserId: 7009, Name: "disabled", Slug: "disabled", Status: model.HubProviderStatusDisabled}).Error)
	require.NoError(t, model.RefreshHubSupplyPricingCache())
	t.Cleanup(func() {
		model.DB = previousDB
		model.LOG_DB = previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		require.NoError(t, model.RefreshHubSupplyPricingCache())
	})
}

func TestValidateOriginTaskHubPolicyPreservesOriginProviderAcrossFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupRelayTaskPolicyProviderDB(t)
	originTask := &model.Task{PrivateData: model.TaskPrivateData{
		BillingContext: &model.TaskBillingContext{
			OriginProviderId:  7,
			SupplyProviderId:  8,
			RoutingPolicyMode: model.HubTokenRoutingModeProvider,
			RoutingPhase:      "platform_fallback",
		},
	}}

	sameProviderCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(sameProviderCtx, constant.ContextKeyHubTokenRoutingPolicy, &model.HubTokenRoutingPolicy{
		Mode: model.HubTokenRoutingModeProvider, ProviderID: 7,
	})
	require.Nil(t, validateOriginTaskHubPolicy(sameProviderCtx, originTask))

	otherProviderCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(otherProviderCtx, constant.ContextKeyHubTokenRoutingPolicy, &model.HubTokenRoutingPolicy{
		Mode: model.HubTokenRoutingModeProvider, ProviderID: 8,
	})
	taskErr := validateOriginTaskHubPolicy(otherProviderCtx, originTask)
	require.NotNil(t, taskErr)
	require.Equal(t, http.StatusForbidden, taskErr.StatusCode)
	require.Equal(t, "task_provider_mismatch", taskErr.Code)

	publicCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(publicCtx, constant.ContextKeyHubTokenRoutingPolicy, &model.HubTokenRoutingPolicy{
		Mode: model.HubTokenRoutingModePublic,
	})
	taskErr = validateOriginTaskHubPolicy(publicCtx, originTask)
	require.NotNil(t, taskErr)
	require.Equal(t, http.StatusForbidden, taskErr.StatusCode)
	require.Equal(t, "task_provider_mismatch", taskErr.Code)

	legacyCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	taskErr = validateOriginTaskHubPolicy(legacyCtx, originTask)
	require.NotNil(t, taskErr)
	require.Equal(t, http.StatusForbidden, taskErr.StatusCode)
	require.Equal(t, "task_provider_mismatch", taskErr.Code)
}

func TestValidateOriginTaskHubPolicyRejectsDisabledOriginProvider(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupRelayTaskPolicyProviderDB(t)
	originTask := &model.Task{PrivateData: model.TaskPrivateData{
		BillingContext: &model.TaskBillingContext{
			OriginProviderId:  9,
			SupplyProviderId:  8,
			RoutingPolicyMode: model.HubTokenRoutingModeProvider,
			RoutingPhase:      "platform_fallback",
		},
	}}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, &model.HubTokenRoutingPolicy{
		Mode: model.HubTokenRoutingModeProvider, ProviderID: 9,
	})
	taskErr := validateOriginTaskHubPolicy(ctx, originTask)
	require.NotNil(t, taskErr)
	require.Equal(t, http.StatusServiceUnavailable, taskErr.StatusCode)
	require.Equal(t, "task_provider_unavailable", taskErr.Code)
}

func TestValidateOriginTaskHubPolicyKeepsLegacyContinuationCompatible(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, &model.HubTokenRoutingPolicy{
		Mode: model.HubTokenRoutingModeProvider, ProviderID: 7,
	})
	require.Nil(t, validateOriginTaskHubPolicy(ctx, &model.Task{}))
}

func TestRealtimeFetchLeavesTerminalTransitionToBillingPoller(t *testing.T) {
	require.False(t, shouldPersistRealtimeTaskSnapshot(model.TaskStatusInProgress, model.TaskStatusSuccess))
	require.False(t, shouldPersistRealtimeTaskSnapshot(model.TaskStatusQueued, model.TaskStatusFailure))
	require.True(t, shouldPersistRealtimeTaskSnapshot(model.TaskStatusQueued, model.TaskStatusInProgress))
	require.True(t, shouldPersistRealtimeTaskSnapshot(model.TaskStatusSuccess, model.TaskStatusSuccess))
}
