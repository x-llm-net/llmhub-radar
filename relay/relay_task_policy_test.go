package relay

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestValidateOriginTaskHubPolicyPreservesOriginProviderAcrossFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
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
}

func TestValidateOriginTaskHubPolicyKeepsLegacyContinuationCompatible(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	require.Nil(t, validateOriginTaskHubPolicy(ctx, &model.Task{}))
}
