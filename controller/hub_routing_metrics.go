package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/gin-gonic/gin"
)

func AdminListHubRoutingMetrics(c *gin.Context) {
	params := perfmetrics.HubRoutingMetricQueryParams{
		Model:        strings.TrimSpace(c.Query("model")),
		EndpointType: strings.TrimSpace(c.Query("endpoint_type")),
	}
	if raw := strings.TrimSpace(c.Query("provider_id")); raw != "" {
		providerID, err := strconv.Atoi(raw)
		if err != nil || providerID < 0 {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		params.ProviderID = &providerID
	}
	if raw := strings.TrimSpace(c.Query("channel_id")); raw != "" {
		channelID, err := strconv.Atoi(raw)
		if err != nil || channelID <= 0 {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		params.ChannelID = &channelID
	}
	if raw := strings.TrimSpace(c.Query("hours")); raw != "" {
		hours, err := strconv.Atoi(raw)
		if err != nil || hours <= 0 {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		params.Hours = hours
	}
	if raw := strings.TrimSpace(c.Query("window_minutes")); raw != "" {
		windowMinutes, err := strconv.Atoi(raw)
		if err != nil || windowMinutes <= 0 || windowMinutes > 60 {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		params.WindowMinutes = windowMinutes
	}
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit <= 0 {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		params.Limit = limit
	}

	var tenantChannelIDs map[int]struct{}
	requestedLimit := params.Limit
	if tenantID := hubProviderAdminTenantID(c); tenantID != nil {
		channelIDs, err := model.GetHubProviderChannelIDsInTenant(*tenantID)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		tenantChannelIDs = make(map[int]struct{}, len(channelIDs))
		for _, channelID := range channelIDs {
			tenantChannelIDs[channelID] = struct{}{}
		}
		// Query a broad bounded set before filtering so a tenant's rows are not
		// hidden by the platform-wide top-N ordering.
		params.Limit = 1000
	}
	result, err := perfmetrics.QueryHubRoutingMetrics(params)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if tenantChannelIDs != nil {
		filtered := result.Items[:0]
		for _, item := range result.Items {
			if _, ok := tenantChannelIDs[item.ChannelID]; ok {
				filtered = append(filtered, item)
			}
		}
		if requestedLimit <= 0 {
			requestedLimit = 100
		}
		if requestedLimit > 1000 {
			requestedLimit = 1000
		}
		if len(filtered) > requestedLimit {
			filtered = filtered[:requestedLimit]
		}
		result.Items = filtered
	}
	common.ApiSuccess(c, result)
}
