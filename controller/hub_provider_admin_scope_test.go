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

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/providers", nil, 7)
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
}
