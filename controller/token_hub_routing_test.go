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

func TestTokenManagementIsScopedToCurrentHubHost(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	rootToken := seedToken(t, db, 1, "root-token", "root-scope-key")
	rootToken.HubTenantId = 11
	require.NoError(t, db.Save(rootToken).Error)
	providerToken := seedToken(t, db, 1, "provider-token", "provider-scope-key")
	providerToken.HubTenantId = 11
	providerToken.HubProviderId = 21
	require.NoError(t, db.Save(providerToken).Error)
	otherProviderToken := seedToken(t, db, 1, "other-provider-token", "other-provider-key")
	otherProviderToken.HubTenantId = 11
	otherProviderToken.HubProviderId = 22
	require.NoError(t, db.Save(otherProviderToken).Error)

	rootCtx, rootRecorder := newAuthenticatedContext(t, http.MethodGet, "/api/token/", nil, 1)
	common.SetContextKey(rootCtx, constant.ContextKeyTenantId, 11)
	GetAllTokens(rootCtx)
	var rootPage tokenPageResponse
	response := decodeAPIResponse(t, rootRecorder)
	require.True(t, response.Success)
	require.NoError(t, common.Unmarshal(response.Data, &rootPage))
	require.Len(t, rootPage.Items, 1)
	assert.Equal(t, "root-token", rootPage.Items[0].Name)

	providerCtx, providerRecorder := newAuthenticatedContext(t, http.MethodGet, "/api/token/", nil, 1)
	common.SetContextKey(providerCtx, constant.ContextKeyTenantId, 11)
	common.SetContextKey(providerCtx, constant.ContextKeyHubRequestedProviderId, 21)
	GetAllTokens(providerCtx)
	var providerPage tokenPageResponse
	response = decodeAPIResponse(t, providerRecorder)
	require.True(t, response.Success)
	require.NoError(t, common.Unmarshal(response.Data, &providerPage))
	require.Len(t, providerPage.Items, 1)
	assert.Equal(t, "provider-token", providerPage.Items[0].Name)

	otherProviderCtx, otherProviderRecorder := newAuthenticatedContext(t, http.MethodGet, "/api/token/", nil, 1)
	common.SetContextKey(otherProviderCtx, constant.ContextKeyTenantId, 11)
	common.SetContextKey(otherProviderCtx, constant.ContextKeyHubRequestedProviderId, 22)
	GetAllTokens(otherProviderCtx)
	var otherProviderPage tokenPageResponse
	response = decodeAPIResponse(t, otherProviderRecorder)
	require.True(t, response.Success)
	require.NoError(t, common.Unmarshal(response.Data, &otherProviderPage))
	require.Len(t, otherProviderPage.Items, 1)
	assert.Equal(t, "other-provider-token", otherProviderPage.Items[0].Name)
}

func TestAddTokenPersistsCurrentHubScope(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	tenantID := 31
	provider := model.HubProvider{OwnerUserId: 2, TenantId: &tenantID, Name: "Provider", Slug: "provider-one", Website: "https://provider.example"}
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}, &model.Channel{}, &model.Ability{}, &model.HubSupplyGroup{}))
	require.NoError(t, db.Create(&provider).Error)
	channel := model.Channel{Name: "Provider channel", Key: "provider-channel-key", Models: "gpt-5"}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&model.Ability{Group: model.HubTokenRoutingAbilityGroup, Model: "gpt-5", ChannelId: channel.Id, Enabled: true}).Error)
	require.NoError(t, db.Create(&model.HubSupplyGroup{ProviderId: provider.Id, NewAPIChannelId: channel.Id, PriceMultiplier: 0.2}).Error)
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/", publicHubRoutingTokenRequest("scoped-token"), 1)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantID)
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, provider.Id)
	request := publicHubRoutingTokenRequest("scoped-token")
	request["hub_routing_policy"] = map[string]any{
		"mode": "provider", "provider_id": provider.Id,
		"selections": []map[string]any{{"family": "openai", "exact_multipliers": []float64{0.2}}},
	}
	ctx, recorder = newAuthenticatedContext(t, http.MethodPost, "/api/token/", request, 1)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantID)
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, provider.Id)

	AddToken(ctx)

	require.True(t, decodeAPIResponse(t, recorder).Success)
	var token model.Token
	require.NoError(t, db.Where("name = ?", "scoped-token").First(&token).Error)
	assert.Equal(t, 31, token.HubTenantId)
	assert.Equal(t, provider.Id, token.HubProviderId)
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
