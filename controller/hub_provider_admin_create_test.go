/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.
*/
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

func seedHubProviderAdminCreateUser(t *testing.T, id int, username string) {
	t.Helper()
	require.NoError(t, model.DB.Create(&model.User{
		Id:       id,
		Username: username,
		Password: "unused",
		Status:   common.UserStatusEnabled,
		AffCode:  username + "-aff",
	}).Error)
}

func hubProviderAdminCreatePayload(ownerID int, tenantID *int) map[string]any {
	return map[string]any{
		"owner_user_id": ownerID,
		"tenant_id":     tenantID,
		"name":          "Managed Provider",
		"slug":          "managed-provider",
		"website":       "",
		"description":   "Created by an administrator",
		"contact_type":  "qq",
		"contact_value": "123456789",
		"support_type":  "community",
		"support_value": "https://example.com/community",
	}
}

func TestAdminCreateHubProviderBindsCurrentTenantAndActivates(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Tenant{}, &model.HubProvider{}))
	seedHubProviderAdminCreateUser(t, 42, "provider-owner")
	tenant := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/providers", hubProviderAdminCreatePayload(42, nil), 7)
	ctx.Set("role", common.RoleAdminUser)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	AdminCreateHubProvider(ctx)

	var response struct {
		Success bool               `json:"success"`
		Data    *model.HubProvider `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	require.NotNil(t, response.Data)
	assert.Equal(t, model.HubProviderStatusActive, response.Data.Status)
	assert.Regexp(t, `^managed-provider-[a-z0-9]{4}$`, response.Data.Slug)

	stored, err := model.GetHubProviderByOwnerUserID(42)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, model.HubProviderStatusActive, stored.Status)
	assert.Equal(t, tenant.Id, *stored.TenantId)
}

func TestAdminCreateHubProviderCanUseCleanSlugForTenantAdmin(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Tenant{}, &model.HubProvider{}))
	seedHubProviderAdminCreateUser(t, 42, "provider-owner")
	tenant := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)

	payload := hubProviderAdminCreatePayload(42, nil)
	payload["use_provisional_slug"] = false
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/providers", payload, 7)
	ctx.Set("role", common.RoleAdminUser)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	AdminCreateHubProvider(ctx)

	var response struct {
		Success bool               `json:"success"`
		Data    *model.HubProvider `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	require.NotNil(t, response.Data)
	assert.Equal(t, "managed-provider", response.Data.Slug)
	assert.Equal(t, "managed-provider", response.Data.SlugBase)
}

func TestAdminCreateHubProviderCanUseCleanSlugForPlatformAdmin(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Tenant{}, &model.HubProvider{}))
	seedHubProviderAdminCreateUser(t, 42, "provider-owner")
	tenant := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)

	payload := hubProviderAdminCreatePayload(42, &tenant.Id)
	payload["use_provisional_slug"] = false
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/providers", payload, 1)
	ctx.Set("role", common.RoleRootUser)
	AdminCreateHubProvider(ctx)

	var response struct {
		Success bool               `json:"success"`
		Data    *model.HubProvider `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	require.NotNil(t, response.Data)
	assert.Equal(t, "managed-provider", response.Data.Slug)
	assert.Equal(t, "managed-provider", response.Data.SlugBase)
}

func TestAdminCreateHubProviderRejectsTenantOverrideForTenantAdmin(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Tenant{}, &model.HubProvider{}))
	seedHubProviderAdminCreateUser(t, 42, "provider-owner")
	tenantA := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	tenantB := model.Tenant{Name: "Tenant B", Slug: "tenant-b", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenantA).Error)
	require.NoError(t, db.Create(&tenantB).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/providers", hubProviderAdminCreatePayload(42, &tenantB.Id), 7)
	ctx.Set("role", common.RoleAdminUser)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantA.Id)
	AdminCreateHubProvider(ctx)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success, recorder.Body.String())
	var count int64
	require.NoError(t, db.Model(&model.HubProvider{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestAdminCreateHubProviderRequiresTenantForPlatformAdmin(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Tenant{}, &model.HubProvider{}))
	seedHubProviderAdminCreateUser(t, 42, "provider-owner")
	tenant := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/providers", hubProviderAdminCreatePayload(42, nil), 1)
	ctx.Set("role", common.RoleRootUser)
	AdminCreateHubProvider(ctx)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success, recorder.Body.String())
}

func TestAdminCreateHubProviderRejectsDisabledOrDuplicateOwners(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Tenant{}, &model.HubProvider{}))
	seedHubProviderAdminCreateUser(t, 42, "provider-owner")
	seedHubProviderAdminCreateUser(t, 43, "disabled-owner")
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", 43).Update("status", common.UserStatusDisabled).Error)
	tenant := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	provider := &model.HubProvider{OwnerUserId: 42, TenantId: &tenant.Id, Name: "Existing", Slug: "existing-provider"}
	require.NoError(t, db.Create(provider).Error)

	for _, ownerID := range []int{42, 43} {
		ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/providers", hubProviderAdminCreatePayload(ownerID, nil), 7)
		ctx.Set("role", common.RoleAdminUser)
		common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
		AdminCreateHubProvider(ctx)
		var response struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		assert.False(t, response.Success, "owner %d: %s", ownerID, recorder.Body.String())
	}
}

func TestAdminListHubProviderOwnerCandidatesOnlyReturnsEnabledUnownedUsers(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.HubProvider{}))
	seedHubProviderAdminCreateUser(t, 42, "available-owner")
	seedHubProviderAdminCreateUser(t, 43, "existing-owner")
	seedHubProviderAdminCreateUser(t, 44, "disabled-owner")
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", 44).Update("status", common.UserStatusDisabled).Error)
	require.NoError(t, db.Create(&model.HubProvider{OwnerUserId: 43, Name: "Existing", Slug: "existing-provider"}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/providers/owner-candidates?p=1&page_size=20", nil, 7)
	ctx.Set("role", common.RoleAdminUser)
	AdminListHubProviderOwnerCandidates(ctx)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.HubProviderOwnerCandidate `json:"items"`
			Total int                               `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	require.Len(t, response.Data.Items, 1)
	assert.Equal(t, 42, response.Data.Items[0].Id)
	assert.Equal(t, 1, response.Data.Total)
}
