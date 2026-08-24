package controller

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type tenantChannelScopeFixture struct {
	tenant   model.Tenant
	channelA model.Channel
	channelB model.Channel
}

func setupTenantChannelScopeFixture(t *testing.T) tenantChannelScopeFixture {
	t.Helper()
	initModelListColumnNames(t)
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.Log{}))

	fixture := tenantChannelScopeFixture{
		tenant: model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive},
	}
	require.NoError(t, model.DB.Create(&fixture.tenant).Error)
	provider := model.HubProvider{
		OwnerUserId: 42, TenantId: &fixture.tenant.Id, Slot: 1,
		Name: "Provider A", Slug: "provider-a", Status: model.HubProviderStatusActive,
	}
	require.NoError(t, model.DB.Create(&provider).Error)
	fixture.channelA = model.Channel{
		Name: "tenant channel", Key: "tenant-key", Models: "gpt-5",
		Group: "default", Status: common.ChannelStatusManuallyDisabled,
	}
	fixture.channelB = model.Channel{
		Name: "foreign channel", Key: "foreign-key", Models: "gpt-5",
		Group: "default", Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, model.DB.Create(&fixture.channelA).Error)
	require.NoError(t, model.DB.Create(&fixture.channelB).Error)
	require.NoError(t, model.DB.Create(&model.HubSupplyGroup{
		PublicId: "tenant-channel-group", ProviderId: provider.Id,
		NewAPIChannelId: fixture.channelA.Id, PriceMultiplier: 1,
		Status: model.HubSupplyGroupStatusAvailable,
	}).Error)
	return fixture
}

func setTenantChannelContext(ctx *gin.Context, tenantID int) {
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantID)
}

func TestTenantAdminChannelListSearchAndDetailStayInTenant(t *testing.T) {
	fixture := setupTenantChannelScopeFixture(t)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/channel/?p=1&page_size=100", nil, 42)
	setTenantChannelContext(ctx, fixture.tenant.Id)
	GetAllChannels(ctx)
	var listResponse struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.Channel `json:"items"`
			Total int             `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &listResponse))
	require.True(t, listResponse.Success, recorder.Body.String())
	assert.Equal(t, 1, listResponse.Data.Total)
	require.Len(t, listResponse.Data.Items, 1)
	assert.Equal(t, fixture.channelA.Id, listResponse.Data.Items[0].Id)

	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/channel/search?keyword=channel", nil, 42)
	setTenantChannelContext(ctx, fixture.tenant.Id)
	SearchChannels(ctx)
	var searchResponse struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.Channel `json:"items"`
			Total int             `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &searchResponse))
	require.True(t, searchResponse.Success, recorder.Body.String())
	assert.Equal(t, 1, searchResponse.Data.Total)
	require.Len(t, searchResponse.Data.Items, 1)
	assert.Equal(t, fixture.channelA.Id, searchResponse.Data.Items[0].Id)

	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/channel/"+strconv.Itoa(fixture.channelB.Id), nil, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(fixture.channelB.Id)}}
	setTenantChannelContext(ctx, fixture.tenant.Id)
	GetChannel(ctx)
	var detailResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &detailResponse))
	assert.False(t, detailResponse.Success)
}

func TestPlatformAdminChannelListUsesGlobalScopeOnAnyHost(t *testing.T) {
	fixture := setupTenantChannelScopeFixture(t)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/channel/?p=1&page_size=100", nil, 1)
	ctx.Request.Host = "343246113.xyz"
	ctx.Set("role", common.RoleRootUser)
	setTenantChannelContext(ctx, fixture.tenant.Id)
	GetAllChannels(ctx)

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.Channel `json:"items"`
			Total int             `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, 2, response.Data.Total)
	assert.Len(t, response.Data.Items, 2)
}

func TestTenantAdminChannelStatusRejectsForeignAndAllowsOwn(t *testing.T) {
	fixture := setupTenantChannelScopeFixture(t)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/channel/"+strconv.Itoa(fixture.channelB.Id)+"/status", map[string]any{
		"status": common.ChannelStatusEnabled,
	}, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(fixture.channelB.Id)}}
	setTenantChannelContext(ctx, fixture.tenant.Id)
	UpdateChannelStatus(ctx)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	var foreign model.Channel
	require.NoError(t, model.DB.First(&foreign, fixture.channelB.Id).Error)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, foreign.Status)

	ctx, recorder = newAuthenticatedContext(t, http.MethodPost, "/api/channel/"+strconv.Itoa(fixture.channelA.Id)+"/status", map[string]any{
		"status": common.ChannelStatusEnabled,
	}, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(fixture.channelA.Id)}}
	setTenantChannelContext(ctx, fixture.tenant.Id)
	UpdateChannelStatus(ctx)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success, recorder.Body.String())
	var owned model.Channel
	require.NoError(t, model.DB.First(&owned, fixture.channelA.Id).Error)
	assert.Equal(t, common.ChannelStatusEnabled, owned.Status)
}

func TestTenantAdminBatchStatusIsAtomicAcrossScope(t *testing.T) {
	fixture := setupTenantChannelScopeFixture(t)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/channel/status/batch", map[string]any{
		"ids":    []int{fixture.channelA.Id, fixture.channelB.Id},
		"status": common.ChannelStatusEnabled,
	}, 42)
	setTenantChannelContext(ctx, fixture.tenant.Id)
	BatchUpdateChannelStatus(ctx)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)

	var channels []model.Channel
	require.NoError(t, model.DB.Where("id IN ?", []int{fixture.channelA.Id, fixture.channelB.Id}).Order("id").Find(&channels).Error)
	require.Len(t, channels, 2)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, channels[0].Status)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, channels[1].Status)
}
