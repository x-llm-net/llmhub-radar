/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdminTenantLifecycleAndOwnerProtection(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}, &model.TenantMember{}, &model.User{}))
	require.NoError(t, model.DB.Create(&model.User{
		Id: 42, Username: "tenant-lifecycle-user", DisplayName: "Lifecycle User",
		Password: "unused", Status: common.UserStatusEnabled, AffCode: "tenant-lifecycle-user",
	}).Error)
	require.NoError(t, model.DB.Create(&model.User{
		Id: 43, Username: "tenant-replacement-user", DisplayName: "Replacement User",
		Password: "unused", Status: common.UserStatusEnabled, AffCode: "tenant-replacement-user",
	}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/tenants", map[string]any{
		"name": "Lifecycle tenant",
		"slug": "lifecycle-tenant",
	}, 1)
	AdminCreateHubTenant(ctx)
	var createResponse struct {
		Success bool         `json:"success"`
		Data    model.Tenant `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &createResponse))
	require.True(t, createResponse.Success, recorder.Body.String())
	tenantID := createResponse.Data.Id

	ctx, recorder = newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/tenants/1/domains", map[string]any{
		"host":       "  Test.Tenant.Example.com:443  ",
		"trusted":    true,
		"is_primary": true,
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenantID)}}
	AdminCreateHubTenantDomain(ctx)
	var domainResponse struct {
		Success bool               `json:"success"`
		Data    model.TenantDomain `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &domainResponse))
	require.True(t, domainResponse.Success, recorder.Body.String())
	assert.Equal(t, "test.tenant.example.com", domainResponse.Data.Host)
	assert.Equal(t, model.TenantDomainVerificationVerified, domainResponse.Data.VerificationStatus)

	ctx, recorder = newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/tenants/1/members", map[string]any{
		"user_id": 42,
		"role":    model.TenantMemberRoleOwner,
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenantID)}}
	AdminUpsertHubTenantMember(ctx)
	var memberResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &memberResponse))
	require.True(t, memberResponse.Success, recorder.Body.String())

	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/tenants/1/members/42", map[string]any{
		"status": model.TenantMemberStatusDisabled,
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenantID)}, {Key: "user_id", Value: "42"}}
	AdminUpdateHubTenantMember(ctx)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &memberResponse))
	require.True(t, memberResponse.Success, recorder.Body.String())

	// A disabled owner still occupies the tenant's single owner role.
	ctx, recorder = newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/tenants/1/members", map[string]any{
		"user_id": 43,
		"role":    model.TenantMemberRoleOwner,
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenantID)}}
	AdminUpsertHubTenantMember(ctx)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &memberResponse))
	assert.False(t, memberResponse.Success, recorder.Body.String())

	// Promoting an existing admin is subject to the same single-owner rule.
	ctx, recorder = newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/tenants/1/members", map[string]any{
		"user_id": 43,
		"role":    model.TenantMemberRoleAdmin,
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenantID)}}
	AdminUpsertHubTenantMember(ctx)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &memberResponse))
	require.True(t, memberResponse.Success, recorder.Body.String())

	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/tenants/1/members/43", map[string]any{
		"role": model.TenantMemberRoleOwner,
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenantID)}, {Key: "user_id", Value: "43"}}
	AdminUpdateHubTenantMember(ctx)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &memberResponse))
	assert.False(t, memberResponse.Success, recorder.Body.String())

	// Reassigning ownership requires removing the old owner's role first.
	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/tenants/1/members/42", map[string]any{
		"role": model.TenantMemberRoleAdmin,
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenantID)}, {Key: "user_id", Value: "42"}}
	AdminUpdateHubTenantMember(ctx)
	var updateResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &updateResponse))
	require.True(t, updateResponse.Success, recorder.Body.String())

	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/tenants/1/members/43", map[string]any{
		"role": model.TenantMemberRoleOwner,
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenantID)}, {Key: "user_id", Value: "43"}}
	AdminUpdateHubTenantMember(ctx)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &memberResponse))
	require.True(t, memberResponse.Success, recorder.Body.String())

	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/hub/admin/tenants", nil, 1)
	AdminListHubTenants(ctx)
	var listResponse struct {
		Success bool `json:"success"`
		Data    struct {
			Items []hubAdminTenantItem `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &listResponse))
	require.True(t, listResponse.Success, recorder.Body.String())
	require.Len(t, listResponse.Data.Items, 1)
	assert.Len(t, listResponse.Data.Items[0].Domains, 1)
	assert.Len(t, listResponse.Data.Items[0].Members, 2)
}

func TestAdminTenantDomainCanBeUntrustedAndTrusted(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}))
	tenant := model.Tenant{Name: "Domain tenant", Slug: "domain-tenant", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(&tenant).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/admin/tenants/1/domains", map[string]any{
		"host":    "pending.example.com",
		"trusted": false,
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenant.Id)}}
	AdminCreateHubTenantDomain(ctx)
	var createResponse struct {
		Success bool               `json:"success"`
		Data    model.TenantDomain `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &createResponse))
	require.True(t, createResponse.Success, recorder.Body.String())

	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/tenants/1/domains/1", map[string]any{
		"verification_status": model.TenantDomainVerificationVerified,
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenant.Id)}, {Key: "domain_id", Value: strconv.Itoa(createResponse.Data.Id)}}
	AdminUpdateHubTenantDomain(ctx)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &createResponse))
	require.True(t, createResponse.Success, recorder.Body.String())
	assert.Equal(t, model.TenantDomainVerificationVerified, createResponse.Data.VerificationStatus)
}
