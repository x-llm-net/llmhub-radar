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
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func AdminListHubRoutingHealth(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	options := model.HubRoutingHealthListOptions{
		Keyword:     c.Query("keyword"),
		Model:       c.Query("model"),
		Endpoint:    c.Query("endpoint"),
		ProbeStatus: c.Query("probe_status"),
		ServiceTier: c.Query("service_tier"),
		Offset:      pageInfo.GetStartIdx(),
		Limit:       pageInfo.GetPageSize(),
	}
	if raw := strings.TrimSpace(c.Query("provider_id")); raw != "" {
		providerID := 0
		if raw != "platform" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed <= 0 {
				common.ApiErrorI18n(c, i18n.MsgInvalidParams)
				return
			}
			providerID = parsed
		}
		options.ProviderID = &providerID
	}
	if raw := strings.TrimSpace(c.Query("channel_status")); raw != "" {
		status, err := strconv.Atoi(raw)
		if err != nil || status < common.ChannelStatusEnabled || status > common.ChannelStatusAutoDisabled {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		options.ChannelStatus = status
	}

	rows, total, err := model.ListHubRoutingHealth(options, common.GetTimestamp())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(total)
	pageInfo.SetItems(rows)
	common.ApiSuccess(c, pageInfo)
}
