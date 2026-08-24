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
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetHubAdminAccess(c *gin.Context) {
	tenantID := hubProviderAdminTenantID(c)
	hostTenantID := common.GetContextKeyInt(c, constant.ContextKeyTenantId)
	data := gin.H{
		"can_manage_providers":       true,
		"can_view_channels":          true,
		"can_manage_brand":           hostTenantID > 0,
		"can_view_tenant_finance":    hostTenantID > 0,
		"can_operate_tenant_finance": isPlatformAdmin(c),
		"tenant_scoped":              tenantID != nil,
	}
	if hostTenantID > 0 && !isPlatformAdmin(c) {
		if member, err := model.GetActiveTenantMember(hostTenantID, c.GetInt("id")); err == nil {
			data["tenant_member_role"] = member.Role
			data["can_operate_tenant_finance"] = member.Role == model.TenantMemberRoleOwner
		}
	}
	if tenantID != nil {
		data["tenant_id"] = *tenantID
	}
	common.ApiSuccess(c, data)
}
