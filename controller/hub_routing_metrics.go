package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
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
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit <= 0 {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		params.Limit = limit
	}

	result, err := perfmetrics.QueryHubRoutingMetrics(params)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
