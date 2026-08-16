package middleware

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
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
	previousRedisEnabled := common.RedisEnabled
	previousRetryTimes := common.RetryTimes
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&model.Channel{},
		&model.Ability{},
		&model.HubProvider{},
		&model.HubSupplyGroup{},
		&model.HubSupplyGroupProbeTarget{},
		&model.Log{},
	))

	model.DB = db
	model.LOG_DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.MemoryCacheEnabled = true
	common.RedisEnabled = false
	common.RetryTimes = 2
	model.InitChannelCache()

	t.Cleanup(func() {
		model.DB = previousDB
		model.LOG_DB = previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		common.MemoryCacheEnabled = previousMemoryCacheEnabled
		common.RedisEnabled = previousRedisEnabled
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
	return newDistributorServiceTierContextForModel(providerID, "service-tier-recovery-model")
}

func newDistributorServiceTierContextForModel(providerID int, modelName string) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/v1/chat/completions",
		bytes.NewBufferString(fmt.Sprintf(`{"model":%q,"messages":[]}`, modelName)),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	ctx.Set(common.RequestIdKey, "service-tier-request-id")
	if providerID > 0 {
		common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, providerID)
	}
	return ctx, recorder
}

func newFixedChannelServiceTierContext(channelID int, modelName string, requestPath string, body string, providerID int) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, requestPath, bytes.NewBufferString(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	common.SetContextKey(ctx, constant.ContextKeyTokenSpecificChannelId, strconv.Itoa(channelID))
	if providerID > 0 {
		common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, providerID)
	}
	return ctx, recorder
}

func createFixedChannelServiceTierFixture(t *testing.T, db *gorm.DB, modelName string) (*model.HubProvider, *model.Channel) {
	t.Helper()
	priority := int64(0)
	provider := &model.HubProvider{
		OwnerUserId: 73002,
		Name:        "Fixed Token Provider",
		Slug:        "fixed-token-provider",
		Status:      model.HubProviderStatusActive,
	}
	require.NoError(t, db.Create(provider).Error)
	channel := &model.Channel{
		Name:     "fixed-token-channel",
		Type:     constant.ChannelTypeOpenAI,
		Key:      "fixed-token-key",
		Models:   modelName,
		Group:    hub_routing_setting.ServiceTierMedium,
		Status:   common.ChannelStatusEnabled,
		Priority: &priority,
	}
	require.NoError(t, db.Create(channel).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group: hub_routing_setting.ServiceTierMedium, Model: modelName,
		ChannelId: channel.Id, Enabled: true, Priority: &priority,
	}).Error)
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, NewAPIChannelId: channel.Id, PriceMultiplier: 0.8,
	}
	require.NoError(t, db.Create(group).Error)
	require.NoError(t, db.Create(&model.HubSupplyGroupProbeTarget{
		GroupId: group.Id, ConfigVersion: group.ConfigVersion, ModelName: modelName,
		EndpointType: "openai", EndpointMode: "openai", ProbeKind: model.HubSupplyProbeKindText,
		Status: model.HubSupplyProbeStatusAvailable,
	}).Error)
	model.InitChannelCache()
	return provider, channel
}

func assertServiceTierUnavailable(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
	var response distributorErrorResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.Equal(t, "service_tier_unavailable", response.Error.Code)
}

func TestDistributeFixedChannelServiceTierEnforcesRoutingBoundaries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())

	t.Run("matching tier and provider succeeds", func(t *testing.T) {
		db := setupDistributorServiceTierTestDB(t)
		provider, channel := createFixedChannelServiceTierFixture(t, db, "fixed-tier-success")
		ctx, recorder := newFixedChannelServiceTierContext(channel.Id, "fixed-tier-success", "/v1/chat/completions", `{"model":"fixed-tier-success","messages":[]}`, provider.Id)

		Distribute()(ctx)

		require.False(t, ctx.IsAborted())
		require.Equal(t, http.StatusOK, recorder.Code)
		assert.Equal(t, channel.Id, common.GetContextKeyInt(ctx, constant.ContextKeyChannelId))
	})

	t.Run("hub policy rejects a fixed channel outside the multiplier range", func(t *testing.T) {
		db := setupDistributorServiceTierTestDB(t)
		provider, channel := createFixedChannelServiceTierFixture(t, db, "fixed-policy-multiplier")
		ctx, recorder := newFixedChannelServiceTierContext(channel.Id, "fixed-policy-multiplier", "/v1/chat/completions", `{"model":"fixed-policy-multiplier","messages":[]}`, provider.Id)
		common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, &model.HubTokenRoutingPolicy{
			Mode: model.HubTokenRoutingModePublic,
			Selections: []model.HubTokenRoutingSelection{{
				Family:        "other",
				MinMultiplier: 0.2,
				MaxMultiplier: 0.2,
			}},
		})

		Distribute()(ctx)

		assertServiceTierUnavailable(t, recorder)
	})

	t.Run("missing ability is unavailable", func(t *testing.T) {
		db := setupDistributorServiceTierTestDB(t)
		provider, channel := createFixedChannelServiceTierFixture(t, db, "fixed-tier-no-ability")
		require.NoError(t, db.Where("channel_id = ?", channel.Id).Delete(&model.Ability{}).Error)
		model.InitChannelCache()
		ctx, recorder := newFixedChannelServiceTierContext(channel.Id, "fixed-tier-no-ability", "/v1/chat/completions", `{"model":"fixed-tier-no-ability","messages":[]}`, provider.Id)

		Distribute()(ctx)

		assertServiceTierUnavailable(t, recorder)
	})

	t.Run("disabled provider is unavailable", func(t *testing.T) {
		db := setupDistributorServiceTierTestDB(t)
		provider, channel := createFixedChannelServiceTierFixture(t, db, "fixed-tier-disabled-provider")
		_, err := model.UpdateHubProviderStatus(provider.Id, model.HubProviderStatusDisabled)
		require.NoError(t, err)
		model.InitChannelCache()
		ctx, recorder := newFixedChannelServiceTierContext(channel.Id, "fixed-tier-disabled-provider", "/v1/chat/completions", `{"model":"fixed-tier-disabled-provider","messages":[]}`, provider.Id)

		Distribute()(ctx)

		assertServiceTierUnavailable(t, recorder)
	})

	t.Run("disabled channel is unavailable", func(t *testing.T) {
		db := setupDistributorServiceTierTestDB(t)
		provider, channel := createFixedChannelServiceTierFixture(t, db, "fixed-tier-disabled-channel")
		require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", channel.Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
		model.InitChannelCache()
		ctx, recorder := newFixedChannelServiceTierContext(channel.Id, "fixed-tier-disabled-channel", "/v1/chat/completions", `{"model":"fixed-tier-disabled-channel","messages":[]}`, provider.Id)

		Distribute()(ctx)

		assertServiceTierUnavailable(t, recorder)
	})

	t.Run("provider subdomain cannot use another provider channel", func(t *testing.T) {
		db := setupDistributorServiceTierTestDB(t)
		provider, channel := createFixedChannelServiceTierFixture(t, db, "fixed-tier-provider-mismatch")
		otherProvider := &model.HubProvider{
			OwnerUserId: 73003,
			Name:        "Other Provider",
			Slug:        "other-provider",
			Status:      model.HubProviderStatusActive,
		}
		require.NoError(t, db.Create(otherProvider).Error)
		model.InitChannelCache()
		ctx, recorder := newFixedChannelServiceTierContext(channel.Id, "fixed-tier-provider-mismatch", "/v1/chat/completions", `{"model":"fixed-tier-provider-mismatch","messages":[]}`, otherProvider.Id)

		Distribute()(ctx)

		assertServiceTierUnavailable(t, recorder)
		assert.NotEqual(t, provider.Id, otherProvider.Id)
	})

	t.Run("text-only endpoint cannot serve image request", func(t *testing.T) {
		db := setupDistributorServiceTierTestDB(t)
		provider, channel := createFixedChannelServiceTierFixture(t, db, "fixed-tier-text-only")
		ctx, recorder := newFixedChannelServiceTierContext(channel.Id, "fixed-tier-text-only", "/v1/images/generations", `{"model":"fixed-tier-text-only","prompt":"test"}`, provider.Id)

		Distribute()(ctx)

		assertServiceTierUnavailable(t, recorder)
	})

	t.Run("missing model remains a bad request", func(t *testing.T) {
		db := setupDistributorServiceTierTestDB(t)
		provider, channel := createFixedChannelServiceTierFixture(t, db, "fixed-tier-no-model")
		ctx, recorder := newFixedChannelServiceTierContext(channel.Id, "", "/v1/chat/completions", `{"messages":[]}`, provider.Id)

		Distribute()(ctx)

		require.Equal(t, http.StatusBadRequest, recorder.Code)
	})
}

func TestSetupContextRejectsLegacyProviderMidjourneyChannel(t *testing.T) {
	db := setupDistributorServiceTierTestDB(t)
	provider := &model.HubProvider{
		OwnerUserId: 73010, Name: "Legacy Midjourney Provider", Slug: "legacy-midjourney-provider",
		Status: model.HubProviderStatusActive,
	}
	require.NoError(t, db.Create(provider).Error)
	channel := &model.Channel{
		Name: "legacy-midjourney-supply", Type: constant.ChannelTypeMidjourney,
		Key: "secret", Models: "midjourney", Group: hub_routing_setting.ServiceTierMedium,
		Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, db.Create(channel).Error)
	require.NoError(t, db.Create(&model.HubSupplyGroup{
		ProviderId: provider.Id, NewAPIChannelId: channel.Id, PriceMultiplier: 1,
	}).Error)
	model.InitChannelCache()

	ctx, _ := newDistributorServiceTierContextForModel(0, "midjourney")
	err := SetupContextForSelectedChannel(ctx, channel, "midjourney")
	require.NotNil(t, err)
	assert.Equal(t, types.ErrorCodeChannelEndpointUnsupported, err.GetErrorCode())
	assert.Equal(t, http.StatusServiceUnavailable, err.StatusCode)
	assert.True(t, types.IsSkipRetryError(err))
}

func TestDistributeAffinityRejectsDisabledProvider(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupDistributorServiceTierTestDB(t)

	const modelName = "service-tier-disabled-provider-affinity"
	provider := &model.HubProvider{
		OwnerUserId: 73001,
		Name:        "Affinity Provider",
		Slug:        "affinity-provider",
		Status:      model.HubProviderStatusActive,
	}
	require.NoError(t, db.Create(provider).Error)

	priority := int64(0)
	providerChannel := &model.Channel{
		Name:     "affinity-provider-channel",
		Type:     constant.ChannelTypeOpenAI,
		Key:      "provider-key",
		Models:   modelName,
		Group:    hub_routing_setting.ServiceTierMedium,
		Status:   common.ChannelStatusEnabled,
		Priority: &priority,
	}
	require.NoError(t, db.Create(providerChannel).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group: hub_routing_setting.ServiceTierMedium, Model: modelName,
		ChannelId: providerChannel.Id, Enabled: true, Priority: &priority,
	}).Error)
	supplyGroup := &model.HubSupplyGroup{
		ProviderId: provider.Id, NewAPIChannelId: providerChannel.Id, PriceMultiplier: 0.8,
	}
	require.NoError(t, db.Create(supplyGroup).Error)
	require.NoError(t, db.Create(&model.HubSupplyGroupProbeTarget{
		GroupId: supplyGroup.Id, ConfigVersion: supplyGroup.ConfigVersion,
		ModelName: modelName, EndpointType: "openai", EndpointMode: "openai",
		ProbeKind: model.HubSupplyProbeKindText, Status: model.HubSupplyProbeStatusAvailable,
	}).Error)
	model.InitChannelCache()

	affinitySetting := operation_setting.GetChannelAffinitySetting()
	originalRules := affinitySetting.Rules
	originalEnabled := affinitySetting.Enabled
	originalKeepDisabled := affinitySetting.KeepOnChannelDisabled
	affinitySetting.Enabled = true
	affinitySetting.KeepOnChannelDisabled = true
	affinitySetting.Rules = append([]operation_setting.ChannelAffinityRule{{
		Name:              "disabled-provider-affinity-test",
		ModelRegex:        []string{"^" + modelName + "$"},
		PathRegex:         []string{"^/v1/chat/completions$"},
		KeySources:        []operation_setting.ChannelAffinityKeySource{{Type: "request_header", Key: "X-Test-Affinity"}},
		TTLSeconds:        60,
		IncludeUsingGroup: true,
		IncludeModelName:  true,
		IncludeRuleName:   true,
	}}, originalRules...)
	t.Cleanup(func() {
		affinitySetting.Rules = originalRules
		affinitySetting.Enabled = originalEnabled
		affinitySetting.KeepOnChannelDisabled = originalKeepDisabled
	})

	seedCtx, seedRecorder := newDistributorServiceTierContextForModel(0, modelName)
	seedCtx.Request.Header.Set("X-Test-Affinity", "disabled-provider-session")
	Distribute()(seedCtx)
	require.False(t, seedCtx.IsAborted())
	require.Equal(t, http.StatusOK, seedRecorder.Code)
	require.Equal(t, providerChannel.Id, common.GetContextKeyInt(seedCtx, constant.ContextKeyChannelId))

	platformChannel := &model.Channel{
		Name:     "affinity-platform-fallback",
		Type:     constant.ChannelTypeOpenAI,
		Key:      "platform-key",
		Models:   modelName,
		Group:    hub_routing_setting.ServiceTierMedium,
		Status:   common.ChannelStatusEnabled,
		Priority: &priority,
	}
	require.NoError(t, db.Create(platformChannel).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group: hub_routing_setting.ServiceTierMedium, Model: modelName,
		ChannelId: platformChannel.Id, Enabled: true, Priority: &priority,
	}).Error)
	_, err := model.UpdateHubProviderStatus(provider.Id, model.HubProviderStatusDisabled)
	require.NoError(t, err)
	model.InitChannelCache()

	fallbackCtx, fallbackRecorder := newDistributorServiceTierContextForModel(0, modelName)
	fallbackCtx.Request.Header.Set("X-Test-Affinity", "disabled-provider-session")
	Distribute()(fallbackCtx)
	require.False(t, fallbackCtx.IsAborted())
	require.Equal(t, http.StatusOK, fallbackRecorder.Code)
	require.Equal(t, platformChannel.Id, common.GetContextKeyInt(fallbackCtx, constant.ContextKeyChannelId))
}

func TestDistributeServiceTierClearsDisabledChannelAffinity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	db := setupDistributorServiceTierTestDB(t)

	const modelName = "service-tier-disabled-channel-affinity"
	priority := int64(0)
	disabledChannel := &model.Channel{
		Name: "disabled-affinity-channel", Type: constant.ChannelTypeOpenAI,
		Key: "disabled-key", Models: modelName, Group: hub_routing_setting.ServiceTierMedium,
		Status: common.ChannelStatusEnabled, Priority: &priority,
	}
	require.NoError(t, db.Create(disabledChannel).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group: hub_routing_setting.ServiceTierMedium, Model: modelName,
		ChannelId: disabledChannel.Id, Enabled: true, Priority: &priority,
	}).Error)
	model.InitChannelCache()

	affinitySetting := operation_setting.GetChannelAffinitySetting()
	originalRules := affinitySetting.Rules
	originalEnabled := affinitySetting.Enabled
	originalKeepDisabled := affinitySetting.KeepOnChannelDisabled
	affinitySetting.Enabled = true
	affinitySetting.KeepOnChannelDisabled = true
	affinitySetting.Rules = append([]operation_setting.ChannelAffinityRule{{
		Name: "disabled-channel-affinity-test", ModelRegex: []string{"^" + modelName + "$"},
		PathRegex:  []string{"^/v1/chat/completions$"},
		KeySources: []operation_setting.ChannelAffinityKeySource{{Type: "request_header", Key: "X-Test-Affinity"}},
		TTLSeconds: 60, IncludeUsingGroup: true, IncludeRuleName: true,
	}}, originalRules...)
	t.Cleanup(func() {
		affinitySetting.Rules = originalRules
		affinitySetting.Enabled = originalEnabled
		affinitySetting.KeepOnChannelDisabled = originalKeepDisabled
	})

	seedCtx, seedRecorder := newDistributorServiceTierContextForModel(0, modelName)
	seedCtx.Request.Header.Set("X-Test-Affinity", "disabled-channel-session")
	Distribute()(seedCtx)
	require.False(t, seedCtx.IsAborted())
	require.Equal(t, http.StatusOK, seedRecorder.Code)
	require.Equal(t, disabledChannel.Id, common.GetContextKeyInt(seedCtx, constant.ContextKeyChannelId))
	seedSnapshot, ok := common.GetContextKeyType[model.HubSupplyPricingSnapshot](seedCtx, constant.ContextKeyHubSupplyPricingSnapshot)
	require.True(t, ok)
	require.Equal(t, disabledChannel.Id, seedSnapshot.ChannelID)

	require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", disabledChannel.Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	model.InitChannelCache()

	unavailableCtx, unavailableRecorder := newDistributorServiceTierContextForModel(0, modelName)
	unavailableCtx.Request.Header.Set("X-Test-Affinity", "disabled-channel-session")
	Distribute()(unavailableCtx)
	require.True(t, unavailableCtx.IsAborted())
	require.Equal(t, http.StatusServiceUnavailable, unavailableRecorder.Code)

	nextCtx, _ := newDistributorServiceTierContextForModel(0, modelName)
	nextCtx.Request.Header.Set("X-Test-Affinity", "disabled-channel-session")
	_, found := service.GetPreferredChannelByAffinity(nextCtx, modelName, hub_routing_setting.ServiceTierMedium)
	require.False(t, found)

	replacementChannel := &model.Channel{
		Name: "replacement-affinity-channel", Type: constant.ChannelTypeOpenAI,
		Key: "replacement-key", Models: modelName, Group: hub_routing_setting.ServiceTierMedium,
		Status: common.ChannelStatusEnabled, Priority: &priority,
	}
	require.NoError(t, db.Create(replacementChannel).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group: hub_routing_setting.ServiceTierMedium, Model: modelName,
		ChannelId: replacementChannel.Id, Enabled: true, Priority: &priority,
	}).Error)
	model.InitChannelCache()

	recoveredCtx, recoveredRecorder := newDistributorServiceTierContextForModel(0, modelName)
	recoveredCtx.Request.Header.Set("X-Test-Affinity", "disabled-channel-session")
	Distribute()(recoveredCtx)
	require.False(t, recoveredCtx.IsAborted())
	require.Equal(t, http.StatusOK, recoveredRecorder.Code)
	require.Equal(t, replacementChannel.Id, common.GetContextKeyInt(recoveredCtx, constant.ContextKeyChannelId))
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
			assert.Contains(t, response.Error.Message, "standard service tier")
			assert.Contains(t, response.Error.Message, "Cross-tier fallback was not used")
			assert.NotContains(t, response.Error.Message, "distributor")
			assert.NotContains(t, response.Error.Message, "under group")

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

func TestDistributeServiceTierUnavailableRecordsSelectionError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	db := setupDistributorServiceTierTestDB(t)

	ctx, recorder := newDistributorServiceTierContextForModel(0, "selection-log-model")
	ctx.Set("id", 73001)
	ctx.Set("username", "selection-log-user")
	ctx.Set("token_id", 4)
	ctx.Set("token_name", "test-mid")
	ctx.Set("group", hub_routing_setting.ServiceTierMedium)

	Distribute()(ctx)

	assertServiceTierUnavailable(t, recorder)
	var logs []model.Log
	require.NoError(t, db.Where("request_id = ?", "service-tier-request-id").Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Equal(t, model.LogTypeError, logs[0].Type)
	assert.Equal(t, 4, logs[0].TokenId)
	assert.Equal(t, "selection-log-model", logs[0].ModelName)
	var other map[string]interface{}
	require.NoError(t, common.Unmarshal([]byte(logs[0].Other), &other))
	assert.Equal(t, "service_tier_unavailable", other["error_code"])
	assert.Equal(t, float64(http.StatusServiceUnavailable), other["status_code"])
	assert.Equal(t, "/v1/chat/completions", other["request_path"])
}

func TestUnavailableChannelErrorCodePreservesLegacyGroups(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "default")
	assert.Equal(t, "model_not_found", string(unavailableChannelErrorCode(ctx)))
}

func TestAffinityRoutingPhasePreservesRequestOrigin(t *testing.T) {
	publicCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(publicCtx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	assert.Equal(t, "public_pool", affinityRoutingPhase(publicCtx))

	providerCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(providerCtx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	common.SetContextKey(providerCtx, constant.ContextKeyHubRequestedProviderId, 7)
	assert.Equal(t, "preferred", affinityRoutingPhase(providerCtx))

	legacyCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(legacyCtx, constant.ContextKeyUsingGroup, "default")
	common.SetContextKey(legacyCtx, constant.ContextKeyHubRoutingPhase, "legacy")
	assert.Equal(t, "legacy", affinityRoutingPhase(legacyCtx))
}
