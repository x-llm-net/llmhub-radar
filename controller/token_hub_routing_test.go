package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func publicHubRoutingTokenRequest(name string) map[string]any {
	return map[string]any{
		"name":              name,
		"expired_time":      -1,
		"remain_quota":      0,
		"unlimited_quota":   true,
		"group":             "vip",
		"cross_group_retry": true,
		"hub_routing_policy": map[string]any{
			"mode": "public_pool",
			"selections": []map[string]any{{
				"family":         "openai",
				"min_multiplier": 0.01,
				"max_multiplier": 0.05,
			}},
		},
	}
}

func TestAddTokenPersistsPublicHubRoutingPolicyWithoutLegacyGroupBehavior(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	ctx, recorder := newAuthenticatedContext(
		t,
		http.MethodPost,
		"/api/token/",
		publicHubRoutingTokenRequest("ranged-token"),
		1,
	)

	AddToken(ctx)

	require.True(t, decodeAPIResponse(t, recorder).Success)
	var token model.Token
	require.NoError(t, db.First(&token).Error)
	assert.Equal(t, "default", token.Group)
	assert.False(t, token.CrossGroupRetry)
	assert.Empty(t, token.AutoGroups)
	policy, err := token.GetHubRoutingPolicy()
	require.NoError(t, err)
	require.NotNil(t, policy)
	assert.Equal(t, model.HubTokenRoutingModePublic, policy.Mode)
	assert.Equal(t, 0.01, policy.Selections[0].MinMultiplier)
	assert.Equal(t, 0.05, policy.Selections[0].MaxMultiplier)
}

func TestUpdateTokenPersistsHubRoutingPolicyAndClearsAutoRouting(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	token := seedToken(t, db, 1, "legacy-token", "hub-routing-update-key")
	token.Group = "auto"
	token.CrossGroupRetry = true
	require.NoError(t, token.SetAutoGroups([]string{"vip", "default"}))
	require.NoError(t, token.Update())

	request := publicHubRoutingTokenRequest("ranged-update")
	request["id"] = token.Id
	request["status"] = common.TokenStatusEnabled
	request["group"] = "auto"
	request["auto_groups"] = []string{"vip"}
	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", request, 1)

	UpdateToken(ctx)

	require.True(t, decodeAPIResponse(t, recorder).Success)
	var updated model.Token
	require.NoError(t, db.First(&updated, token.Id).Error)
	assert.Equal(t, "default", updated.Group)
	assert.False(t, updated.CrossGroupRetry)
	assert.Empty(t, updated.AutoGroups)
	policy, err := updated.GetHubRoutingPolicy()
	require.NoError(t, err)
	require.NotNil(t, policy)
	assert.Equal(t, model.HubTokenRoutingModePublic, policy.Mode)
}

func TestAddTokenCannotChooseProviderScopeFromRootDomain(t *testing.T) {
	setupTokenControllerTestDB(t)
	request := publicHubRoutingTokenRequest("forged-provider-token")
	request["hub_routing_policy"] = map[string]any{
		"mode":        "provider",
		"provider_id": 99,
		"selections": []map[string]any{{
			"family":            "openai",
			"exact_multipliers": []float64{0.2},
		}},
	}
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/", request, 1)

	AddToken(ctx)

	assert.False(t, decodeAPIResponse(t, recorder).Success)
	var count int64
	require.NoError(t, model.DB.Model(&model.Token{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestUpdateTokenCannotRebindProviderPolicyFromAnotherSubdomain(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	token := seedToken(t, db, 1, "provider-a-token", "provider-a-key")
	require.NoError(t, token.SetHubRoutingPolicy(&model.HubTokenRoutingPolicy{
		Mode: model.HubTokenRoutingModeProvider, ProviderID: 7,
		Selections: []model.HubTokenRoutingSelection{{
			Family: "openai", ExactMultipliers: []float64{0.2},
		}},
	}))
	require.NoError(t, token.Update())

	request := publicHubRoutingTokenRequest("rebound-token")
	request["id"] = token.Id
	request["status"] = common.TokenStatusEnabled
	request["hub_routing_policy"] = map[string]any{
		"mode": "provider", "provider_id": 8,
		"selections": []map[string]any{{
			"family": "openai", "exact_multipliers": []float64{0.2},
		}},
	}
	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", request, 1)
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, 8)

	UpdateToken(ctx)

	assert.False(t, decodeAPIResponse(t, recorder).Success)
	var unchanged model.Token
	require.NoError(t, db.First(&unchanged, token.Id).Error)
	policy, err := unchanged.GetHubRoutingPolicy()
	require.NoError(t, err)
	require.NotNil(t, policy)
	assert.Equal(t, 7, policy.ProviderID)
	assert.Equal(t, "provider-a-token", unchanged.Name)
}

func TestUpdateTokenCannotConvertPublicPolicyFromProviderSubdomain(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	token := seedToken(t, db, 1, "public-token", "public-key")
	require.NoError(t, token.SetHubRoutingPolicy(&model.HubTokenRoutingPolicy{
		Mode: model.HubTokenRoutingModePublic,
		Selections: []model.HubTokenRoutingSelection{{
			Family: "openai", MinMultiplier: 0.01, MaxMultiplier: 0.05,
		}},
	}))
	require.NoError(t, token.Update())

	request := publicHubRoutingTokenRequest("converted-token")
	request["id"] = token.Id
	request["status"] = common.TokenStatusEnabled
	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", request, 1)
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, 8)

	UpdateToken(ctx)

	assert.False(t, decodeAPIResponse(t, recorder).Success)
	var unchanged model.Token
	require.NoError(t, db.First(&unchanged, token.Id).Error)
	policy, err := unchanged.GetHubRoutingPolicy()
	require.NoError(t, err)
	require.NotNil(t, policy)
	assert.Equal(t, model.HubTokenRoutingModePublic, policy.Mode)
	assert.Equal(t, "public-token", unchanged.Name)
}
