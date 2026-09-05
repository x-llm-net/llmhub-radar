package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTokenAutoGroupsContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	return ctx
}

func disableHubTokenRoutingForLegacyContextTest(t *testing.T) {
	t.Helper()
	original := hub_routing_setting.Snapshot()
	updated := original
	updated.Enabled = false
	require.NoError(t, hub_routing_setting.Publish(updated))
	t.Cleanup(func() { require.NoError(t, hub_routing_setting.Publish(original)) })
}

func TestSetupContextForTokenPreservesCustomAutoGroupsOrder(t *testing.T) {
	disableHubTokenRoutingForLegacyContextTest(t)
	ctx := newTokenAutoGroupsContext()
	token := &model.Token{Id: 1, UserId: 2, AutoGroups: `["vip","default"]`}

	require.NoError(t, SetupContextForToken(ctx, token))
	value, ok := common.GetContextKey(ctx, constant.ContextKeyTokenAutoGroups)
	require.True(t, ok)
	assert.Equal(t, []string{"vip", "default"}, value)
}

func TestSetupContextForTokenTreatsStoredEmptyArrayAsInheritance(t *testing.T) {
	disableHubTokenRoutingForLegacyContextTest(t)
	ctx := newTokenAutoGroupsContext()
	token := &model.Token{Id: 1, UserId: 2, AutoGroups: `[]`}

	require.NoError(t, SetupContextForToken(ctx, token))
	_, ok := common.GetContextKey(ctx, constant.ContextKeyTokenAutoGroups)
	assert.False(t, ok)
}

func TestSetupContextForTokenMalformedAutoGroupsFailsClosed(t *testing.T) {
	disableHubTokenRoutingForLegacyContextTest(t)
	ctx := newTokenAutoGroupsContext()
	token := &model.Token{Id: 1, UserId: 2, AutoGroups: `not-json`}

	require.NoError(t, SetupContextForToken(ctx, token))
	value, ok := common.GetContextKey(ctx, constant.ContextKeyTokenAutoGroups)
	require.True(t, ok)
	assert.Equal(t, []string{}, value)
}

func TestSetupContextForTokenRejectsAnotherProviderSubdomain(t *testing.T) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, 8)
	token := &model.Token{Id: 1, UserId: 2, HubTenantId: 1, HubProviderId: 7}
	require.NoError(t, token.SetHubRoutingPolicy(&model.HubTokenRoutingPolicy{
		Mode:       model.HubTokenRoutingModeChannels,
		ProviderID: 7,
		ChannelIDs: []int{1},
	}))

	err := SetupContextForToken(ctx, token)

	require.Error(t, err)
	assert.Equal(t, http.StatusForbidden, recorder.Code)
	_, exists := common.GetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy)
	assert.False(t, exists)
}

func TestSetupContextForHubTokenRequiresChannelReconfiguration(t *testing.T) {
	disableHubTokenRoutingForLegacyContextTest(t)
	for _, raw := range []string{"", `not-json`, `{"mode":"provider","provider_id":7,"selections":[{"model":"gpt-5","multipliers":[0.3]}]}`} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		token := &model.Token{Id: 1, UserId: 2, HubTenantId: 1, Group: "auto", HubRoutingPolicy: raw, AutoGroups: `["default","vip"]`}
		err := SetupContextForToken(ctx, token)
		require.ErrorContains(t, err, "requires channel selection")
		assert.True(t, ctx.IsAborted())
		assert.Equal(t, http.StatusForbidden, recorder.Code)
		_, exists := common.GetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy)
		assert.False(t, exists)
		_, exists = common.GetContextKey(ctx, constant.ContextKeyTokenAutoGroups)
		assert.False(t, exists)
	}
}

func TestSetupContextForTokenUsesCurrentDefinitionsAndChecksTenantDomain(t *testing.T) {
	db := setupDistributorServiceTierTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}))
	for _, tenant := range []model.Tenant{
		{Id: 41, Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive},
		{Id: 42, Name: "Tenant B", Slug: "tenant-b", Status: model.TenantStatusActive},
	} {
		require.NoError(t, db.Create(&tenant).Error)
		require.NoError(t, db.Create(&model.TenantDomain{TenantId: tenant.Id, Host: tenant.Slug + ".example", IsPrimary: true, Status: model.TenantDomainStatusActive, VerificationStatus: model.TenantDomainVerificationVerified}).Error)
	}
	tenantID := 41
	provider := model.HubProvider{OwnerUserId: 7, TenantId: &tenantID, Name: "Provider", Slug: "provider-a", Status: model.HubProviderStatusActive}
	require.NoError(t, db.Create(&provider).Error)
	channel := model.Channel{Name: "Selected", Type: constant.ChannelTypeOpenAI, Models: "gpt-5", Key: "test-key", Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(&channel).Error)
	group := model.HubSupplyGroup{ProviderId: provider.Id, NewAPIChannelId: channel.Id, PriceMultiplier: 0.3, PublishedModels: "gpt-5", TenantPublished: true, AutoProbeDisabledModels: "gpt-5"}
	require.NoError(t, db.Create(&group).Error)
	model.InitChannelCache()
	token := &model.Token{Id: 1, UserId: 2, HubTenantId: tenantID, Group: "default"}
	require.NoError(t, token.SetHubRoutingPolicy(&model.HubTokenRoutingPolicy{Mode: model.HubTokenRoutingModeChannels, ProviderID: provider.Id, ChannelIDs: []int{channel.Id}}))
	for index, expectedMultiplier := range []float64{0.3, 0.4} {
		if index > 0 {
			require.NoError(t, db.Model(&group).Updates(map[string]any{"price_multiplier": 0.4, "tenant_published": false}).Error)
			require.NoError(t, db.Model(&channel).Update("status", common.ChannelStatusManuallyDisabled).Error)
			model.InitChannelCache()
		}
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "https://tenant-a.example/v1/chat/completions", nil)
		require.NoError(t, SetupContextForToken(ctx, token))
		assert.Equal(t, tenantID, common.GetContextKeyInt(ctx, constant.ContextKeyTenantId))
		policy, exists := common.GetContextKeyType[*model.HubTokenRoutingPolicy](ctx, constant.ContextKeyHubTokenRoutingPolicy)
		require.True(t, exists)
		assert.True(t, policy.AllowsModel("gpt-5"))
		assert.Equal(t, []float64{expectedMultiplier}, policy.OrderedMultipliers("gpt-5"))
		assert.NotContains(t, token.HubRoutingPolicy, "multiplier")
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "https://tenant-b.example/v1/chat/completions", nil)
	require.ErrorContains(t, SetupContextForToken(ctx, token), "current domain")
	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.True(t, ctx.IsAborted())
}
