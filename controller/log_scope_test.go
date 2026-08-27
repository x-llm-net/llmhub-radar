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

type adminLogPageResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Items []model.Log `json:"items"`
		Total int         `json:"total"`
	} `json:"data"`
}

func TestAdminLogsAndStatsUseTenantChannelScope(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.Log{}))
	tenant := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(&tenant).Error)
	channelA := model.Channel{Name: "tenant channel", Key: "key-11"}
	channelB := model.Channel{Name: "other channel", Key: "key-22"}
	require.NoError(t, model.DB.Create(&channelA).Error)
	require.NoError(t, model.DB.Create(&channelB).Error)
	provider := model.HubProvider{OwnerUserId: 42, TenantId: &tenant.Id, Slot: 1, Name: "Provider A", Slug: "provider-a"}
	require.NoError(t, model.DB.Create(&provider).Error)
	require.NoError(t, model.DB.Create(&model.HubSupplyGroup{
		PublicId: "group-a", ProviderId: provider.Id, NewAPIChannelId: channelA.Id,
		PriceMultiplier: 1, Status: model.HubSupplyGroupStatusAvailable,
	}).Error)
	now := common.GetTimestamp()
	require.NoError(t, model.LOG_DB.Create(&model.Log{
		Type: model.LogTypeConsume, UserId: 84, Username: "tenant-customer",
		ChannelId: channelA.Id, Quota: 100, PromptTokens: 2, CompletionTokens: 3,
		CreatedAt: now, Ip: "192.0.2.10", Other: common.MapToJsonStr(map[string]interface{}{
			"admin_info":                        map[string]interface{}{"use_channel": []int{channelA.Id}},
			"hub_attempts":                      []map[string]interface{}{{"channel_id": channelA.Id}},
			"expr_b64":                          "private-expression",
			"hub_requested_provider_id":         999,
			"hub_requested_provider_slug":       "foreign-provider",
			"hub_provider_id":                   provider.Id,
			"hub_supply_group_id":               101,
			"platform_fee_basis_points":         3000,
			"provider_service_fee_basis_points": 1000,
			"routing_phase":                     "preferred",
		}),
	}).Error)
	require.NoError(t, model.LOG_DB.Create(&model.Log{Type: model.LogTypeConsume, ChannelId: channelB.Id, Quota: 200, PromptTokens: 4, CompletionTokens: 6, CreatedAt: now}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/log/?p=1&page_size=100", nil, 42)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	GetAllLogs(ctx)
	var page adminLogPageResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &page))
	require.True(t, page.Success, recorder.Body.String())
	assert.Equal(t, 1, page.Data.Total)
	require.Len(t, page.Data.Items, 1)
	assert.Equal(t, channelA.Id, page.Data.Items[0].ChannelId)
	assert.Equal(t, "tenant-customer", page.Data.Items[0].Username)
	assert.Equal(t, provider.Id, page.Data.Items[0].ProviderId)
	assert.Equal(t, provider.Name, page.Data.Items[0].ProviderName)
	assert.Empty(t, page.Data.Items[0].Ip)
	var scopedOther map[string]interface{}
	require.NoError(t, common.UnmarshalJsonStr(page.Data.Items[0].Other, &scopedOther))
	assert.Equal(t, "preferred", scopedOther["routing_phase"])
	for _, key := range []string{
		"admin_info", "hub_attempts", "expr_b64", "hub_requested_provider_id",
		"hub_requested_provider_slug", "hub_provider_id", "hub_supply_group_id",
		"platform_fee_basis_points", "provider_service_fee_basis_points",
	} {
		assert.NotContains(t, scopedOther, key)
	}

	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/log/stat", nil, 42)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	GetLogsStat(ctx)
	var statResponse struct {
		Success bool       `json:"success"`
		Data    model.Stat `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &statResponse))
	require.True(t, statResponse.Success, recorder.Body.String())
	assert.Equal(t, model.Stat{Quota: 100, Rpm: 1, Tpm: 5}, statResponse.Data)
}

func TestProviderLogsOnlyShowRequestsServedByOwnedChannels(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Log{}))
	ownedChannel := model.Channel{Name: "owned channel", Key: "owned-key"}
	foreignChannel := model.Channel{Name: "fallback channel", Key: "fallback-key"}
	require.NoError(t, model.DB.Create(&ownedChannel).Error)
	require.NoError(t, model.DB.Create(&foreignChannel).Error)
	provider := model.HubProvider{OwnerUserId: 42, Slot: 1, Name: "Provider A", Slug: "provider-a"}
	foreignProvider := model.HubProvider{OwnerUserId: 43, Slot: 1, Name: "Provider B", Slug: "provider-b"}
	emptyProvider := model.HubProvider{OwnerUserId: 44, Slot: 1, Name: "Provider C", Slug: "provider-c"}
	require.NoError(t, model.DB.Create(&provider).Error)
	require.NoError(t, model.DB.Create(&foreignProvider).Error)
	require.NoError(t, model.DB.Create(&emptyProvider).Error)
	require.NoError(t, model.DB.Create(&model.HubSupplyGroup{
		PublicId: "owned-group", ProviderId: provider.Id, NewAPIChannelId: ownedChannel.Id,
		PriceMultiplier: 1, Status: model.HubSupplyGroupStatusAvailable,
	}).Error)
	require.NoError(t, model.DB.Create(&model.HubSupplyGroup{
		PublicId: "foreign-group", ProviderId: foreignProvider.Id, NewAPIChannelId: foreignChannel.Id,
		PriceMultiplier: 1, Status: model.HubSupplyGroupStatusAvailable,
	}).Error)
	now := common.GetTimestamp()
	require.NoError(t, model.LOG_DB.Create(&model.Log{
		UserId: 100, Username: "customer-a", Type: model.LogTypeConsume,
		ChannelId: ownedChannel.Id, Quota: 120, PromptTokens: 3, CompletionTokens: 4,
		CreatedAt: now, Ip: "192.0.2.20",
	}).Error)
	// This represents a request that was ultimately served by another
	// provider after fallback and must not be visible to Provider A.
	require.NoError(t, model.LOG_DB.Create(&model.Log{
		UserId: 101, Username: "customer-b", Type: model.LogTypeConsume,
		ChannelId: foreignChannel.Id, Quota: 240, PromptTokens: 5, CompletionTokens: 6,
		CreatedAt: now,
	}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/provider/logs?p=1&page_size=100", nil, provider.OwnerUserId)
	GetHubProviderLogs(ctx)
	var page adminLogPageResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &page))
	require.True(t, page.Success, recorder.Body.String())
	assert.Equal(t, 1, page.Data.Total)
	require.Len(t, page.Data.Items, 1)
	assert.Equal(t, "customer-a", page.Data.Items[0].Username)
	assert.Equal(t, ownedChannel.Id, page.Data.Items[0].ChannelId)
	assert.Equal(t, "owned channel", page.Data.Items[0].ChannelName)
	assert.Equal(t, provider.Id, page.Data.Items[0].ProviderId)
	assert.Equal(t, provider.Name, page.Data.Items[0].ProviderName)
	assert.Empty(t, page.Data.Items[0].Ip)

	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/hub/provider/logs/stat", nil, provider.OwnerUserId)
	GetHubProviderLogsStat(ctx)
	var statResponse struct {
		Success bool       `json:"success"`
		Data    model.Stat `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &statResponse))
	require.True(t, statResponse.Success, recorder.Body.String())
	assert.Equal(t, model.Stat{Quota: 120, Rpm: 1, Tpm: 7}, statResponse.Data)

	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/hub/provider/logs?p=1&page_size=100", nil, emptyProvider.OwnerUserId)
	GetHubProviderLogs(ctx)
	page = adminLogPageResponse{}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &page))
	require.True(t, page.Success, recorder.Body.String())
	assert.Zero(t, page.Data.Total)
	assert.Empty(t, page.Data.Items)
}

func TestAdminLogsWithoutTenantContextRemainPlatformWide(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Log{}))
	channelA := model.Channel{Name: "channel 11", Key: "key-11"}
	channelB := model.Channel{Name: "channel 22", Key: "key-22"}
	require.NoError(t, model.DB.Create(&channelA).Error)
	require.NoError(t, model.DB.Create(&channelB).Error)
	now := common.GetTimestamp()
	require.NoError(t, model.LOG_DB.Create(&model.Log{Type: model.LogTypeConsume, ChannelId: channelA.Id, CreatedAt: now}).Error)
	require.NoError(t, model.LOG_DB.Create(&model.Log{Type: model.LogTypeConsume, ChannelId: channelB.Id, CreatedAt: now}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/log/?p=1&page_size=100", nil, 1)
	GetAllLogs(ctx)
	var page adminLogPageResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &page))
	require.True(t, page.Success, recorder.Body.String())
	assert.Equal(t, 2, page.Data.Total)
	assert.Len(t, page.Data.Items, 2)
}
