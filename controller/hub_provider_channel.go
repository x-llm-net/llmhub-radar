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
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type hubSupplySettingsRequest struct {
	PriceMultiplier   float64 `json:"price_multiplier"`
	TextProbeMinutes  int     `json:"text_probe_minutes"`
	ImageProbeMinutes int     `json:"image_probe_minutes"`
}

type hubProviderChannelCreateRequest struct {
	AddChannelRequest
	Supply hubSupplySettingsRequest `json:"supply"`
}

type hubProviderChannelUpdateRequest struct {
	PatchChannel
	Supply hubSupplySettingsRequest `json:"supply"`
}

type hubSupplyProfileResponse struct {
	Id                  int      `json:"id"`
	PublicId            string   `json:"public_id"`
	PriceMultiplier     float64  `json:"price_multiplier"`
	Status              string   `json:"status"`
	PublishedModels     []string `json:"published_models"`
	OnlineModels        []string `json:"online_models"`
	ConfigVersion       int      `json:"config_version"`
	TextProbeMinutes    int      `json:"text_probe_minutes"`
	ImageProbeMinutes   int      `json:"image_probe_minutes"`
	AvailableModelCount int      `json:"available_model_count"`
	ErrorModelCount     int      `json:"error_model_count"`
	PendingModelCount   int      `json:"pending_model_count"`
	LastProbeAt         int64    `json:"last_probe_at"`
	NextManualProbeAt   int64    `json:"next_manual_probe_at"`
	PublishedModelCount int      `json:"published_model_count"`
	OnlineModelCount    int      `json:"online_model_count"`
	CreatedAt           int64    `json:"created_at"`
	UpdatedAt           int64    `json:"updated_at"`
}

type hubProviderChannelResponse struct {
	Channel model.Channel            `json:"channel"`
	Supply  hubSupplyProfileResponse `json:"supply"`
}

func validateHubSupplySettings(req *hubSupplySettingsRequest, existing *model.HubSupplyGroup) error {
	if req == nil {
		return fmt.Errorf("supply settings are required")
	}
	if req.PriceMultiplier == 0 && existing == nil {
		req.PriceMultiplier = 1
	}
	if req.TextProbeMinutes == 0 {
		if existing != nil && existing.TextProbeMinutes > 0 {
			req.TextProbeMinutes = existing.TextProbeMinutes
		} else {
			req.TextProbeMinutes = model.HubSupplyGroupDefaultTextProbeMinutes
		}
	}
	if req.ImageProbeMinutes == 0 {
		if existing != nil && existing.ImageProbeMinutes > 0 {
			req.ImageProbeMinutes = existing.ImageProbeMinutes
		} else {
			req.ImageProbeMinutes = model.HubSupplyGroupDefaultImageProbeMinutes
		}
	}
	if math.IsNaN(req.PriceMultiplier) || math.IsInf(req.PriceMultiplier, 0) || req.PriceMultiplier < 0.01 || req.PriceMultiplier > 100 {
		return fmt.Errorf("price multiplier must be between 0.01 and 100")
	}
	if !validHubProviderChannelProbeMinutes(req.TextProbeMinutes, req.ImageProbeMinutes) {
		return fmt.Errorf("probe intervals must be between %d and %d minutes", hubProviderChannelProbeMinutesMin, hubProviderChannelProbeMinutesMax)
	}
	req.PriceMultiplier = math.Round(req.PriceMultiplier*10000) / 10000
	return nil
}

func applyHubProviderChannelPolicy(channel *model.Channel, origin *model.Channel) {
	if channel == nil {
		return
	}
	zeroPriority := int64(0)
	zeroWeight := uint(0)
	zeroAutoBan := 0
	channel.Group = "default"
	channel.Priority = &zeroPriority
	channel.Weight = &zeroWeight
	channel.AutoBan = &zeroAutoBan
	channel.Tag = nil
	if origin == nil {
		channel.Status = common.ChannelStatusAutoDisabled
		channel.TestTime = 0
		channel.ResponseTime = 0
		channel.Balance = 0
		channel.BalanceUpdatedTime = 0
		channel.UsedQuota = 0
		return
	}
	if strings.TrimSpace(channel.Key) == "" {
		channel.Key = origin.Key
	}
	channel.Id = origin.Id
	channel.Group = origin.Group
	channel.Priority = origin.Priority
	channel.Weight = origin.Weight
	channel.AutoBan = origin.AutoBan
	channel.Tag = origin.Tag
	channel.Status = origin.Status
	channel.CreatedTime = origin.CreatedTime
	channel.TestTime = origin.TestTime
	channel.ResponseTime = origin.ResponseTime
	channel.Balance = origin.Balance
	channel.BalanceUpdatedTime = origin.BalanceUpdatedTime
	channel.UsedQuota = origin.UsedQuota
	channel.OtherInfo = origin.OtherInfo
}

func newHubProviderChannelResponse(group *model.HubSupplyGroup, channel *model.Channel) (hubProviderChannelResponse, error) {
	if group == nil || channel == nil {
		return hubProviderChannelResponse{}, fmt.Errorf("invalid supply channel")
	}
	routableModels, err := model.GetHubSupplyChannelRoutableModels(channel.Id)
	if err != nil {
		return hubProviderChannelResponse{}, err
	}
	publicChannel := *channel
	publicChannel.Key = ""
	publicChannel.Keys = nil
	nextManualProbeAt := int64(0)
	if group.LastManualProbeAt > 0 {
		nextManualProbeAt = group.LastManualProbeAt + model.HubSupplyProbeManualCooldownSeconds
	}
	publishedModels := group.GetPublishedModels(channel.Models)
	return hubProviderChannelResponse{
		Channel: publicChannel,
		Supply: hubSupplyProfileResponse{
			Id: group.Id, PublicId: group.PublicId,
			PriceMultiplier: group.PriceMultiplier, Status: group.Status,
			PublishedModels: publishedModels, OnlineModels: routableModels,
			ConfigVersion:    group.ConfigVersion,
			TextProbeMinutes: group.TextProbeMinutes, ImageProbeMinutes: group.ImageProbeMinutes,
			AvailableModelCount: group.AvailableModelCount, ErrorModelCount: group.ErrorModelCount,
			PendingModelCount: group.PendingModelCount, LastProbeAt: group.LastProbeAt,
			NextManualProbeAt:   nextManualProbeAt,
			PublishedModelCount: len(publishedModels), OnlineModelCount: len(routableModels),
			CreatedAt: group.CreatedAt, UpdatedAt: group.UpdatedAt,
		},
	}, nil
}

func getOwnedHubSupplyChannel(providerID, channelID int) (*model.HubSupplyGroup, *model.Channel, error) {
	group, err := model.GetHubSupplyGroupByChannelID(channelID)
	if err != nil || group == nil || group.ProviderId != providerID {
		return nil, nil, err
	}
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, nil, err
	}
	return group, channel, nil
}

func GetHubProviderChannels(c *gin.Context) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if provider == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderRequired)
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
		provider.Id,
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

func GetHubProviderChannel(c *gin.Context) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channelID, parseErr := strconv.Atoi(c.Param("id"))
	if provider == nil || parseErr != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return
	}
	group, channel, err := getOwnedHubSupplyChannel(provider.Id, channelID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if group == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return
	}
	item, err := newHubProviderChannelResponse(group, channel)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, item)
}

func CreateHubProviderChannel(c *gin.Context) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if provider == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderRequired)
		return
	}
	var req hubProviderChannelCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := validateHubSupplySettings(&req.Supply, nil); err != nil {
		common.ApiError(c, err)
		return
	}
	applyHubProviderChannelPolicy(req.Channel, nil)
	channels, err := prepareChannelsForCreate(&req.AddChannelRequest)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	for i := range channels {
		applyHubProviderChannelPolicy(&channels[i], nil)
	}
	groups, err := model.CreateHubSupplyChannels(provider.Id, channels, model.HubSupplyGroup{
		PriceMultiplier:   req.Supply.PriceMultiplier,
		TextProbeMinutes:  req.Supply.TextProbeMinutes,
		ImageProbeMinutes: req.Supply.ImageProbeMinutes,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]hubProviderChannelResponse, 0, len(groups))
	for i := range groups {
		item, err := newHubProviderChannelResponse(&groups[i], &channels[i])
		if err != nil {
			common.ApiError(c, err)
			return
		}
		items = append(items, item)
	}
	enqueueHubSupplyProbe()
	common.ApiSuccess(c, items)
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func UpdateHubProviderChannel(c *gin.Context) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channelID, parseErr := strconv.Atoi(c.Param("id"))
	if provider == nil || parseErr != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return
	}
	group, origin, err := getOwnedHubSupplyChannel(provider.Id, channelID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if group == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return
	}
	rawBody, err := c.GetRawData()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req hubProviderChannelUpdateRequest
	if err := common.Unmarshal(rawBody, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	var requestData map[string]any
	if err := common.Unmarshal(rawBody, &requestData); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := validateHubSupplySettings(&req.Supply, group); err != nil {
		common.ApiError(c, err)
		return
	}
	preparation, err := prepareChannelUpdate(
		&req.PatchChannel,
		origin,
		requestData,
		applyHubProviderChannelPolicy,
	)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	updated := req.PatchChannel.Channel
	group.PriceMultiplier = req.Supply.PriceMultiplier
	group.TextProbeMinutes = req.Supply.TextProbeMinutes
	group.ImageProbeMinutes = req.Supply.ImageProbeMinutes
	if err := model.UpdateHubSupplyChannel(group, &updated); err != nil {
		common.ApiError(c, err)
		return
	}
	preparation.invalidateProxyCache()
	if err := model.ReconcileHubSupplyGroupRouteState(group.Id); err != nil {
		common.ApiError(c, err)
		return
	}
	enqueueHubSupplyProbe()
	refreshedGroup, refreshedChannel, err := getOwnedHubSupplyChannel(provider.Id, channelID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	item, err := newHubProviderChannelResponse(refreshedGroup, refreshedChannel)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, item)
}

func DeleteHubProviderChannel(c *gin.Context) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channelID, parseErr := strconv.Atoi(c.Param("id"))
	if provider == nil || parseErr != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return
	}
	group, channel, err := getOwnedHubSupplyChannel(provider.Id, channelID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if group == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return
	}
	if err := channel.Delete(); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	common.ApiSuccess(c, nil)
}

func FetchHubProviderChannelModels(c *gin.Context) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channelID, parseErr := strconv.Atoi(c.Param("id"))
	if provider == nil || parseErr != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return
	}
	group, channel, err := getOwnedHubSupplyChannel(provider.Id, channelID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if group == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return
	}
	models, err := fetchChannelUpstreamModelIDs(channel)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": fmt.Sprintf("获取模型列表失败: %s", err.Error())})
		return
	}
	common.ApiSuccess(c, models)
}

func PreviewHubProviderChannelModels(c *gin.Context) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if provider == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderRequired)
		return
	}
	var req fetchModelsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if req.ChannelID > 0 {
		group, _, err := getOwnedHubSupplyChannel(provider.Id, req.ChannelID)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if group == nil {
			common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
			return
		}
	}
	models, err := fetchModelsForRequest(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": fmt.Sprintf("获取模型列表失败: %s", err.Error())})
		return
	}
	common.ApiSuccess(c, models)
}

func GetHubProviderChannelGroups(c *gin.Context) {
	common.ApiSuccess(c, []string{"default"})
}
