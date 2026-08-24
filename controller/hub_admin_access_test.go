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

func TestGetHubAdminAccessReportsTenantScope(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}))
	tenant := model.Tenant{Name: "Access tenant", Slug: "access-tenant", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(&tenant).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/access", nil, 42)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	GetHubAdminAccess(ctx)

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			CanManageProviders bool `json:"can_manage_providers"`
			CanViewChannels    bool `json:"can_view_channels"`
			CanManageBrand     bool `json:"can_manage_brand"`
			TenantScoped       bool `json:"tenant_scoped"`
			TenantID           int  `json:"tenant_id"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success, recorder.Body.String())
	assert.True(t, response.Data.CanManageProviders)
	assert.True(t, response.Data.CanViewChannels)
	assert.True(t, response.Data.CanManageBrand)
	assert.True(t, response.Data.TenantScoped)
	assert.Equal(t, tenant.Id, response.Data.TenantID)
}

func TestGetHubAdminAccessReportsPlatformScope(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/access", nil, 42)
	GetHubAdminAccess(ctx)

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			TenantScoped   bool `json:"tenant_scoped"`
			CanManageBrand bool `json:"can_manage_brand"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success, recorder.Body.String())
	assert.False(t, response.Data.TenantScoped)
	assert.False(t, response.Data.CanManageBrand)
}

func TestGetHubAdminAccessAllowsRootToManageCurrentHostBrand(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}))
	tenant := model.Tenant{Name: "Root host tenant", Slug: "root-host-tenant", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(&tenant).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/access", nil, 1)
	ctx.Set("role", common.RoleRootUser)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	GetHubAdminAccess(ctx)

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			TenantScoped   bool `json:"tenant_scoped"`
			CanManageBrand bool `json:"can_manage_brand"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success, recorder.Body.String())
	assert.False(t, response.Data.TenantScoped)
	assert.True(t, response.Data.CanManageBrand)
}
