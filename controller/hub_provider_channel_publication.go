package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type hubChannelPublicationRequest struct {
	Published bool `json:"published"`
}

type hubChannelPublicationBatchRequest struct {
	Ids       []int `json:"ids"`
	Published bool  `json:"published"`
}

func requireHubChannelPublicationScope(c *gin.Context, channelIDs []int) bool {
	allowed, scoped, err := hubProviderAdminChannelIDs(c)
	if err != nil {
		common.ApiError(c, err)
		return false
	}
	if !scoped {
		return true
	}
	allowedSet := make(map[int]struct{}, len(allowed))
	for _, channelID := range allowed {
		allowedSet[channelID] = struct{}{}
	}
	for _, channelID := range channelIDs {
		if _, ok := allowedSet[channelID]; !ok {
			common.ApiErrorI18n(c, i18n.MsgNotFound)
			return false
		}
	}
	return true
}

func updateHubChannelPublication(c *gin.Context, channelIDs []int, published bool) {
	if !requireHubChannelPublicationScope(c, channelIDs) {
		return
	}
	if err := model.UpdateHubSupplyGroupTenantPublication(channelIDs, published); err != nil {
		if errors.Is(err, model.ErrHubSupplyGroupNotFound) {
			common.ApiErrorI18n(c, i18n.MsgNotFound)
			return
		}
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"channel_ids": channelIDs,
			"published":   published,
		},
	})
}

func UpdateHubChannelPublication(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgNotFound)
		return
	}
	var req hubChannelPublicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	updateHubChannelPublication(c, []int{channelID}, req.Published)
}

func BatchUpdateHubChannelPublication(c *gin.Context) {
	var req hubChannelPublicationBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Ids) == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	updateHubChannelPublication(c, req.Ids, req.Published)
}
