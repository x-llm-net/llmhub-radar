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

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/hub_provider_notification_setting"
	"github.com/gin-gonic/gin"
)

func ListHubAdminNotifications(c *gin.Context) {
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if err != nil || limit <= 0 {
		limit = 50
	}
	notifications, err := model.ListHubAdminNotifications(limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, notifications)
}

func GetHubProviderNotificationSettings(c *gin.Context) {
	common.ApiSuccess(c, hub_provider_notification_setting.Get())
}

func UpdateHubProviderNotificationSettings(c *gin.Context) {
	var config hub_provider_notification_setting.Config
	if err := common.DecodeJson(c.Request.Body, &config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效的通知设置"})
		return
	}
	normalized, err := hub_provider_notification_setting.Normalize(config)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	raw, err := common.Marshal(normalized)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOption(hub_provider_notification_setting.OptionKey, string(raw)); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "hub_provider.notification_settings.update", map[string]interface{}{
		"email_count":   len(normalized.EmailRecipients),
		"webhook_count": len(normalized.Webhooks),
	})
	common.ApiSuccess(c, normalized)
}

func TestHubProviderNotification(c *gin.Context) {
	if err := service.TestHubProviderNotification(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"sent": true})
}
