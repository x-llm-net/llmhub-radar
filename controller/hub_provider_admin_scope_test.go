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

func TestAdminProviderManagementUsesTenantScope(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Tenant{}))
	require.NoError(t, model.DB.Create(&model.User{
		Id: 42, Username: "tenant-a-owner", DisplayName: "Tenant A", Email: "a@example.com",
		Password: "unused", Status: common.UserStatusEnabled, AffCode: "tenant-a",
	}).Error)
	require.NoError(t, model.DB.Create(&model.User{
		Id: 43, Username: "tenant-b-owner", DisplayName: "Tenant B", Email: "b@example.com",
		Password: "unused", Status: common.UserStatusEnabled, AffCode: "tenant-b",
	}).Error)
	tenantA := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	tenantB := model.Tenant{Name: "Tenant B", Slug: "tenant-b", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(&tenantA).Error)
	require.NoError(t, model.DB.Create(&tenantB).Error)
	providerA := &model.HubProvider{OwnerUserId: 42, TenantId: &tenantA.Id, Slot: 1, Name: "Provider A", Slug: "provider-a"}
	providerB := &model.HubProvider{OwnerUserId: 43, TenantId: &tenantB.Id, Slot: 1, Name: "Provider B", Slug: "provider-b"}
	require.NoError(t, model.DB.Create(providerA).Error)
	require.NoError(t, model.DB.Create(providerB).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/providers?tenant_id="+strconv.Itoa(tenantB.Id), nil, 7)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantA.Id)
	AdminListHubProviders(ctx)
	var listResponse struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.HubProviderAdminListItem `json:"items"`
			Total int                              `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &listResponse))
	require.True(t, listResponse.Success, recorder.Body.String())
	assert.Equal(t, 1, listResponse.Data.Total)
	require.Len(t, listResponse.Data.Items, 1)
	assert.Equal(t, providerA.Id, listResponse.Data.Items[0].Id)

	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/1/settlement-settings", map[string]any{
		"platform_fee_basis_points": 100,
	}, 7)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(providerB.Id)}}
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantA.Id)
	AdminUpdateHubProviderSettlementSettings(ctx)
	var updateResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &updateResponse))
	assert.False(t, updateResponse.Success)
	var stored model.HubProvider
	require.NoError(t, model.DB.First(&stored, providerB.Id).Error)
	assert.Nil(t, stored.PlatformFeeBasisPoints)

	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/providers/"+strconv.Itoa(providerA.Id), nil, 7)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(providerA.Id)}}
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantA.Id)
	AdminGetHubProvider(ctx)
	var ownDetailResponse struct {
		Success bool                           `json:"success"`
		Data    model.HubProviderAdminListItem `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &ownDetailResponse))
	require.True(t, ownDetailResponse.Success, recorder.Body.String())
	assert.Equal(t, providerA.Id, ownDetailResponse.Data.Id)

	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/providers/"+strconv.Itoa(providerB.Id), nil, 7)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(providerB.Id)}}
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantA.Id)
	AdminGetHubProvider(ctx)
	var foreignDetailResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &foreignDetailResponse))
	assert.False(t, foreignDetailResponse.Success)
}

func TestPlatformAdminUsesGlobalProviderScopeOnAnyHost(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Tenant{}))
	for _, user := range []model.User{
		{Id: 42, Username: "tenant-owner", DisplayName: "Tenant Owner", Status: common.UserStatusEnabled, AffCode: "tenant-owner"},
		{Id: 43, Username: "platform-owner", DisplayName: "Platform Owner", Status: common.UserStatusEnabled, AffCode: "platform-owner"},
	} {
		require.NoError(t, model.DB.Create(&user).Error)
	}
	tenant := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(&tenant).Error)
	tenantProvider := &model.HubProvider{
		OwnerUserId: 42, TenantId: &tenant.Id, Slot: 1, Name: "Tenant Provider", Slug: "tenant-provider",
	}
	platformProvider := &model.HubProvider{
		OwnerUserId: 43, Slot: 1, Name: "Platform Provider", Slug: "platform-provider",
	}
	require.NoError(t, model.DB.Create(tenantProvider).Error)
	require.NoError(t, model.DB.Create(platformProvider).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/providers", nil, 1)
	ctx.Request.Host = "343246113.xyz"
	ctx.Set("role", common.RoleRootUser)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	AdminListHubProviders(ctx)
	var listResponse struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.HubProviderAdminListItem `json:"items"`
			Total int                              `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &listResponse))
	require.True(t, listResponse.Success, recorder.Body.String())
	assert.Equal(t, 2, listResponse.Data.Total)

	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/providers?tenant_id="+strconv.Itoa(tenant.Id), nil, 1)
	ctx.Request.Host = "343246113.xyz"
	ctx.Set("role", common.RoleRootUser)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	AdminListHubProviders(ctx)
	var tenantListResponse struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.HubProviderAdminListItem `json:"items"`
			Total int                              `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &tenantListResponse))
	require.True(t, tenantListResponse.Success, recorder.Body.String())
	assert.Equal(t, 1, tenantListResponse.Data.Total)
	require.Len(t, tenantListResponse.Data.Items, 1)
	assert.Equal(t, tenantProvider.Id, tenantListResponse.Data.Items[0].Id)

	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/providers/"+strconv.Itoa(platformProvider.Id), nil, 1)
	ctx.Request.Host = "343246113.xyz"
	ctx.Set("role", common.RoleRootUser)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(platformProvider.Id)}}
	AdminGetHubProvider(ctx)
	var detailResponse struct {
		Success bool                           `json:"success"`
		Data    model.HubProviderAdminListItem `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &detailResponse))
	assert.True(t, detailResponse.Success, recorder.Body.String())
	assert.Equal(t, platformProvider.Id, detailResponse.Data.Id)
}

func TestAdminProviderOverviewIgnoresTenantHostScope(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Tenant{}))
	require.NoError(t, model.DB.Create(&model.User{
		Id: 42, Username: "tenant-a-owner", DisplayName: "Tenant A", Email: "a@example.com",
		Password: "unused", Status: common.UserStatusEnabled, AffCode: "tenant-a",
	}).Error)
	require.NoError(t, model.DB.Create(&model.User{
		Id: 43, Username: "platform-owner", DisplayName: "Platform Owner", Email: "platform@example.com",
		Password: "unused", Status: common.UserStatusEnabled, AffCode: "platform",
	}).Error)
	tenant := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(&tenant).Error)
	tenantProvider := &model.HubProvider{OwnerUserId: 42, TenantId: &tenant.Id, Slot: 1, Name: "Tenant Provider", Slug: "tenant-provider"}
	platformProvider := &model.HubProvider{OwnerUserId: 43, Slot: 1, Name: "Platform Provider", Slug: "platform-provider"}
	require.NoError(t, model.DB.Create(tenantProvider).Error)
	require.NoError(t, model.DB.Create(platformProvider).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/provider-overview", nil, 1)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	AdminListHubProviderOverview(ctx)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.HubProviderAdminListItem `json:"items"`
			Total int                              `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, 2, response.Data.Total)
	require.Len(t, response.Data.Items, 2)
	assert.Equal(t, "", response.Data.Items[0].TenantName)
	assert.Equal(t, "Tenant A", response.Data.Items[1].TenantName)

	platformCtx, platformRecorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/provider-overview?tenant_id=platform", nil, 1)
	AdminListHubProviderOverview(platformCtx)
	var platformResponse struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.HubProviderAdminListItem `json:"items"`
			Total int                              `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(platformRecorder.Body.Bytes(), &platformResponse))
	require.True(t, platformResponse.Success, platformRecorder.Body.String())
	assert.Equal(t, 1, platformResponse.Data.Total)
	require.Len(t, platformResponse.Data.Items, 1)
	assert.Equal(t, platformProvider.Id, platformResponse.Data.Items[0].Id)
}
