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
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// AdminGetHubProvider returns the provider profile and administrator metrics
// for the current platform or tenant scope.
func AdminGetHubProvider(c *gin.Context) {
	providerID, err := strconv.Atoi(c.Param("id"))
	if err != nil || providerID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if !requireHubProviderAdminScope(c, providerID) {
		return
	}
	provider, err := model.GetHubProviderAdminByID(providerID, hubProviderAdminTenantID(c))
	if err != nil {
		if errors.Is(err, model.ErrHubProviderNotFound) {
			common.ApiErrorI18n(c, i18n.MsgNotFound)
			return
		}
		common.ApiError(c, err)
		return
	}
	if provider.LogoAssetId > 0 {
		provider.LogoURL = "/api/hub/admin/providers/" + strconv.Itoa(provider.Id) + "/logo"
	}
	common.ApiSuccess(c, provider)
}

// AdminGetHubProviderChannels is intentionally read-only. It reuses the
// provider response that strips channel credentials before serialization.
func AdminGetHubProviderChannels(c *gin.Context) {
	providerID, err := strconv.Atoi(c.Param("id"))
	if err != nil || providerID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if !requireHubProviderAdminScope(c, providerID) {
		return
	}

	pageInfo := common.GetPageQuery(c)
	channelType := 0
	if rawType := strings.TrimSpace(c.Query("type")); rawType != "" {
		if parsedType, parseErr := strconv.Atoi(rawType); parseErr == nil && parsedType > 0 {
			channelType = parsedType
		}
	}
	groups, total, typeCounts, err := model.ListHubSupplyGroupsByProviderID(
		providerID,
		model.HubSupplyGroupListOptions{
			Keyword:     c.Query("keyword"),
			Model:       c.Query("model"),
			Status:      c.Query("status"),
			ChannelType: channelType,
			SortBy:      c.Query("sort_by"),
			SortOrder:   c.Query("sort_order"),
			Offset:      pageInfo.GetStartIdx(),
			Limit:       pageInfo.GetPageSize(),
		},
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]hubProviderChannelResponse, 0, len(groups))
	for _, group := range groups {
		channel, err := model.GetChannelById(group.NewAPIChannelId, false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		item, err := newHubProviderChannelResponse(&group.HubSupplyGroup, channel)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		items = append(items, item)
	}
	common.ApiSuccess(c, gin.H{
		"items":       items,
		"total":       total,
		"page":        pageInfo.GetPage(),
		"page_size":   pageInfo.GetPageSize(),
		"type_counts": typeCounts,
	})
}
