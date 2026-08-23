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
	require.NoError(t, model.LOG_DB.Create(&model.Log{Type: model.LogTypeConsume, ChannelId: channelA.Id, Quota: 100, PromptTokens: 2, CompletionTokens: 3, CreatedAt: now}).Error)
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
