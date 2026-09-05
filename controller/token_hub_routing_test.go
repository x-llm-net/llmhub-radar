package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type tokenChannelFixture struct {
	db              *gorm.DB
	tenantID        int
	ownerProviderID int
	childProviderID int
	ownerChannels   []int
	childChannel    int
}

func setupTokenChannelFixture(t *testing.T) tokenChannelFixture {
	t.Helper()
	db := setupTokenControllerTestDB(t)
	previousMemory := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() { common.MemoryCacheEnabled = previousMemory })
	require.NoError(t, db.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}, &model.TenantMember{}, &model.HubProvider{}, &model.Channel{}, &model.Ability{}, &model.HubSupplyGroup{}, &model.HubSupplyGroupProbeTarget{}))
	tenant := model.Tenant{Name: "Tenant", Slug: "token-tenant", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	require.NoError(t, db.Create(&model.TenantMember{TenantId: tenant.Id, UserId: 21, Role: model.TenantMemberRoleOwner, Status: model.TenantMemberStatusActive}).Error)
	owner := model.HubProvider{OwnerUserId: 21, TenantId: &tenant.Id, Name: "Owner", Slug: "owner", Status: model.HubProviderStatusActive}
	child := model.HubProvider{OwnerUserId: 22, TenantId: &tenant.Id, Name: "Child", Slug: "child", Status: model.HubProviderStatusActive}
	require.NoError(t, db.Create(&owner).Error)
	require.NoError(t, db.Create(&child).Error)
	fixture := tokenChannelFixture{db: db, tenantID: tenant.Id, ownerProviderID: owner.Id, childProviderID: child.Id}
	for index, providerID := range []int{owner.Id, owner.Id, child.Id} {
		channel := model.Channel{Name: "Channel " + stringInt(index), Type: constant.ChannelTypeOpenAI, Key: "test-key", Models: "gpt-5,claude-sonnet-4-6", Group: model.HubTokenRoutingAbilityGroup, Status: common.ChannelStatusEnabled}
		require.NoError(t, db.Create(&channel).Error)
		require.NoError(t, db.Create(&model.HubSupplyGroup{ProviderId: providerID, NewAPIChannelId: channel.Id, PriceMultiplier: 0.3 + float64(index)*0.1, TenantPublished: true, PublishedModels: channel.Models, AutoProbeDisabledModels: channel.Models}).Error)
		for _, name := range channel.GetModels() {
			require.NoError(t, db.Create(&model.Ability{Group: model.HubTokenRoutingAbilityGroup, Model: name, ChannelId: channel.Id, Enabled: true}).Error)
		}
		if providerID == owner.Id {
			fixture.ownerChannels = append(fixture.ownerChannels, channel.Id)
		} else {
			fixture.childChannel = channel.Id
		}
	}
	require.NoError(t, model.RefreshHubSupplyPricingCache())
	return fixture
}

func channelHubRoutingTokenRequest(name string, channelIDs []int) map[string]any {
	return map[string]any{
		"name": name, "expired_time": -1, "remain_quota": 0, "unlimited_quota": true,
		"group": "vip", "cross_group_retry": true,
		"hub_routing_policy": map[string]any{"mode": "channels", "channel_ids": channelIDs},
	}
}

func (fixture tokenChannelFixture) context(t *testing.T, method, target string, request any, providerID int) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	ctx, recorder := newAuthenticatedContext(t, method, target, request, 1)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, fixture.tenantID)
	if providerID > 0 {
		common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, providerID)
	}
	return ctx, recorder
}

func TestAddTokenPersistsOrderedChannelsAndServerProviderScope(t *testing.T) {
	fixture := setupTokenChannelFixture(t)
	selected := []int{fixture.ownerChannels[1], fixture.ownerChannels[0]}
	ctx, recorder := fixture.context(t, http.MethodPost, "/api/token/", channelHubRoutingTokenRequest("owner-key", selected), 0)
	AddToken(ctx)
	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var token model.Token
	require.NoError(t, fixture.db.First(&token).Error)
	assert.Equal(t, fixture.tenantID, token.HubTenantId)
	assert.Zero(t, token.HubProviderId)
	assert.Equal(t, "default", token.Group)
	assert.False(t, token.CrossGroupRetry)
	assert.Empty(t, token.AutoGroups)
	policy, err := token.GetHubRoutingPolicy()
	require.NoError(t, err)
	require.NotNil(t, policy)
	assert.Equal(t, model.HubTokenRoutingModeChannels, policy.Mode)
	assert.Equal(t, fixture.ownerProviderID, policy.ProviderID)
	assert.Equal(t, selected, policy.ChannelIDs)
	assert.NotContains(t, token.HubRoutingPolicy, "multiplier")
	assert.NotContains(t, token.HubRoutingPolicy, "models")
	assert.False(t, buildMaskedTokenResponse(&token).NeedsReconfiguration)
}

func TestHubTokenRoutingOptionsOnlyExposeDomainProvider(t *testing.T) {
	fixture := setupTokenChannelFixture(t)
	for _, test := range []struct {
		name             string
		providerID       int
		expectedProvider int
		expectedChannels []int
	}{
		{"root", 0, fixture.ownerProviderID, fixture.ownerChannels},
		{"child", fixture.childProviderID, fixture.childProviderID, []int{fixture.childChannel}},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, recorder := fixture.context(t, http.MethodGet, "/api/token/routing-options", nil, test.providerID)
			GetHubTokenRoutingOptions(ctx)
			response := decodeAPIResponse(t, recorder)
			require.True(t, response.Success, response.Message)
			var options model.HubTokenRoutingOptions
			require.NoError(t, common.Unmarshal(response.Data, &options))
			assert.Equal(t, test.expectedProvider, options.ProviderID)
			ids := make([]int, 0, len(options.Channels))
			for _, channel := range options.Channels {
				ids = append(ids, channel.ChannelID)
			}
			assert.ElementsMatch(t, test.expectedChannels, ids)
		})
	}
	ctx, recorder := fixture.context(t, http.MethodGet, "/api/token/routing-options?provider_id="+stringInt(fixture.childProviderID), nil, 0)
	GetHubTokenRoutingOptions(ctx)
	assert.False(t, decodeAPIResponse(t, recorder).Success)
}

func TestHubTokenWritesRejectForeignProviderAndMissingChannels(t *testing.T) {
	fixture := setupTokenChannelFixture(t)
	for _, test := range []struct {
		name   string
		policy any
	}{
		{"forged provider", map[string]any{"mode": "channels", "provider_id": fixture.childProviderID, "channel_ids": []int{fixture.childChannel}}},
		{"foreign channel", map[string]any{"mode": "channels", "channel_ids": []int{fixture.childChannel}}},
		{"old policy", map[string]any{"mode": "provider", "selections": []map[string]any{{"model": "gpt-5", "multipliers": []float64{0.3}}}}},
		{"no policy", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := channelHubRoutingTokenRequest(test.name, fixture.ownerChannels)
			request["hub_routing_policy"] = test.policy
			ctx, recorder := fixture.context(t, http.MethodPost, "/api/token/", request, 0)
			AddToken(ctx)
			assert.False(t, decodeAPIResponse(t, recorder).Success)
		})
	}
	var count int64
	require.NoError(t, fixture.db.Model(&model.Token{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestUpdateTokenReplacesObsoletePolicyWithoutDeletingKey(t *testing.T) {
	fixture := setupTokenChannelFixture(t)
	for _, raw := range []string{`{"mode":"provider","provider_id":1,"selections":[{"family":"openai","exact_multipliers":[0.3]}]}`, `not-json`, ""} {
		token := seedToken(t, fixture.db, 1, "old-key", "key-"+stringInt(len(raw)))
		token.HubTenantId = fixture.tenantID
		token.HubRoutingPolicy = raw
		token.Group = "auto"
		token.CrossGroupRetry = true
		token.AutoGroups = `["vip","default"]`
		require.NoError(t, fixture.db.Save(token).Error)
		assert.True(t, buildMaskedTokenResponse(token).NeedsReconfiguration)
		request := channelHubRoutingTokenRequest("updated-key", fixture.ownerChannels)
		request["id"] = token.Id
		request["auto_groups"] = []string{"vip"}
		ctx, recorder := fixture.context(t, http.MethodPut, "/api/token/", request, 0)
		UpdateToken(ctx)
		response := decodeAPIResponse(t, recorder)
		require.True(t, response.Success, response.Message)
		var updated model.Token
		require.NoError(t, fixture.db.First(&updated, token.Id).Error)
		assert.Equal(t, token.Key, updated.Key)
		assert.Equal(t, "default", updated.Group)
		assert.False(t, updated.CrossGroupRetry)
		assert.Empty(t, updated.AutoGroups)
		assert.False(t, buildMaskedTokenResponse(&updated).NeedsReconfiguration)
	}
}

func TestTokenManagementIsScopedToCurrentHubHost(t *testing.T) {
	fixture := setupTokenChannelFixture(t)
	for _, providerID := range []int{0, fixture.childProviderID} {
		token := seedToken(t, fixture.db, 1, "scope-"+stringInt(providerID), "key-scope-"+stringInt(providerID))
		token.HubTenantId = fixture.tenantID
		token.HubProviderId = providerID
		require.NoError(t, fixture.db.Save(token).Error)
	}
	for _, providerID := range []int{0, fixture.childProviderID} {
		ctx, recorder := fixture.context(t, http.MethodGet, "/api/token/", nil, providerID)
		GetAllTokens(ctx)
		response := decodeAPIResponse(t, recorder)
		require.True(t, response.Success, response.Message)
		var page tokenPageResponse
		require.NoError(t, common.Unmarshal(response.Data, &page))
		require.Len(t, page.Items, 1)
		assert.Equal(t, "scope-"+stringInt(providerID), page.Items[0].Name)
	}
}

func TestProviderTokenPersistsScopeAndCannotBeEditedFromRoot(t *testing.T) {
	fixture := setupTokenChannelFixture(t)
	request := channelHubRoutingTokenRequest("provider-key", []int{fixture.childChannel})
	ctx, recorder := fixture.context(t, http.MethodPost, "/api/token/", request, fixture.childProviderID)
	AddToken(ctx)
	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var token model.Token
	require.NoError(t, fixture.db.First(&token).Error)
	assert.Equal(t, fixture.childProviderID, token.HubProviderId)
	assert.Equal(t, fixture.tenantID, token.HubTenantId)
	request = channelHubRoutingTokenRequest("wrong-scope", fixture.ownerChannels)
	request["id"] = token.Id
	ctx, recorder = fixture.context(t, http.MethodPut, "/api/token/", request, 0)
	UpdateToken(ctx)
	assert.False(t, decodeAPIResponse(t, recorder).Success)
	var unchanged model.Token
	require.NoError(t, fixture.db.First(&unchanged, token.Id).Error)
	assert.Equal(t, token.Name, unchanged.Name)
	assert.Equal(t, token.HubRoutingPolicy, unchanged.HubRoutingPolicy)
}
