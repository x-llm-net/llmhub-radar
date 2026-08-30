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
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

const (
	hubProviderChannelProbeMinutesMin     = 5
	hubProviderChannelProbeMinutesMax     = 1440
	hubProviderChannelDefaultTextMinutes  = 20
	hubProviderChannelDefaultImageMinutes = 60
	hubProviderChannelPublicationBatchMax = 10000
)

type hubProviderChannelProbeEndpointResponse struct {
	EndpointType         string `json:"endpoint_type"`
	ResolvedEndpointType string `json:"resolved_endpoint_type"`
	ProbeKind            string `json:"probe_kind"`
	Status               string `json:"status"`
	LastProbeAt          int64  `json:"last_probe_at"`
	LastLatencyMs        int64  `json:"last_latency_ms"`
	LastFirstTokenMs     *int64 `json:"last_first_token_ms"`
	LastError            string `json:"last_error"`
	LastErrorCode        string `json:"last_error_code"`
	ConsecutiveFailures  int    `json:"consecutive_failures"`
	SuspendedAt          int64  `json:"suspended_at"`
	SuspensionReason     string `json:"suspension_reason"`
}

type hubProviderChannelModelProbeResponse struct {
	ModelName        string                                    `json:"model_name"`
	EndpointMode     string                                    `json:"endpoint_mode"`
	Status           string                                    `json:"status"`
	AutoProbeEnabled bool                                      `json:"auto_probe_enabled"`
	Published        bool                                      `json:"published"`
	Online           bool                                      `json:"online"`
	LastProbeAt      int64                                     `json:"last_probe_at"`
	Endpoints        []hubProviderChannelProbeEndpointResponse `json:"endpoints"`
}

type hubProviderChannelProbeResponse struct {
	ChannelId         int                                    `json:"channel_id"`
	Name              string                                 `json:"name"`
	Running           bool                                   `json:"running"`
	NextManualProbeAt int64                                  `json:"next_manual_probe_at"`
	Models            []hubProviderChannelModelProbeResponse `json:"models"`
}

type hubProviderChannelModelProbeRequest struct {
	ModelName string `json:"model_name"`
}

type hubProviderChannelModelProbeEndpointRequest struct {
	ModelName    string `json:"model_name"`
	EndpointType string `json:"endpoint_type"`
}

type hubProviderChannelModelAutoProbeRequest struct {
	ModelName string `json:"model_name"`
	Enabled   bool   `json:"enabled"`
}

type hubProviderChannelModelPublicationRequest struct {
	ModelName string `json:"model_name"`
	Published bool   `json:"published"`
}

type hubProviderChannelModelsPublicationRequest struct {
	ModelNames []string `json:"model_names"`
	Published  bool     `json:"published"`
}

type hubProviderChannelMissingPricesNotificationRequest struct {
	ModelNames []string `json:"model_names"`
}

func getCurrentHubProviderChannel(c *gin.Context) (*model.HubSupplyGroup, *model.Channel, bool) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return nil, nil, false
	}
	if provider == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderRequired)
		return nil, nil, false
	}
	channelID, err := strconv.Atoi(strings.TrimSpace(c.Param("id")))
	if err != nil || channelID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return nil, nil, false
	}
	group, channel, err := getOwnedHubSupplyChannel(provider.Id, channelID)
	if err != nil {
		common.ApiError(c, err)
		return nil, nil, false
	}
	if group == nil || channel == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return nil, nil, false
	}
	return group, channel, true
}

func getCurrentActiveHubProviderChannel(c *gin.Context) (*model.HubSupplyGroup, *model.Channel, bool) {
	provider, ok := requireActiveHubProvider(c)
	if !ok {
		return nil, nil, false
	}
	channelID, err := strconv.Atoi(strings.TrimSpace(c.Param("id")))
	if err != nil || channelID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return nil, nil, false
	}
	group, channel, err := getOwnedHubSupplyChannel(provider.Id, channelID)
	if err != nil {
		common.ApiError(c, err)
		return nil, nil, false
	}
	if group == nil || channel == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderChannelNotFound)
		return nil, nil, false
	}
	return group, channel, true
}

func RequestHubProviderChannelProbe(c *gin.Context) {
	group, _, ok := getCurrentActiveHubProviderChannel(c)
	if !ok {
		return
	}
	nextAllowedAt, err := model.RequestImmediateHubSupplyGroupProbe(group.Id)
	if err != nil {
		if err == model.ErrHubSupplyProbeCooldown {
			common.ApiError(c, fmt.Errorf("probe can be requested again after %d", nextAllowedAt))
			return
		}
		common.ApiError(c, err)
		return
	}
	enqueueHubSupplyProbe()
	common.ApiSuccess(c, gin.H{"next_manual_probe_at": nextAllowedAt})
}

func GetHubProviderChannelProbes(c *gin.Context) {
	group, channel, ok := getCurrentHubProviderChannel(c)
	if !ok {
		return
	}
	targets, err := model.GetHubSupplyGroupProbeTargets(group.Id, group.ConfigVersion)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	targetsByModel := make(map[string][]model.HubSupplyGroupProbeTarget)
	for _, target := range targets {
		targetsByModel[target.ModelName] = append(targetsByModel[target.ModelName], target)
	}
	onlineModels := make(map[string]struct{})
	routableModels, err := model.GetHubSupplyChannelRoutableModels(channel.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for _, modelName := range routableModels {
		onlineModels[modelName] = struct{}{}
	}
	publishedModels := make(map[string]struct{})
	for _, modelName := range group.GetPublishedModels(channel.Models) {
		publishedModels[modelName] = struct{}{}
	}
	items := make([]hubProviderChannelModelProbeResponse, 0, len(channel.GetModels()))
	running := false
	for _, modelName := range channel.GetModels() {
		modelTargets := targetsByModel[modelName]
		autoProbeEnabled := !group.IsAutoProbeDisabled(modelName, channel.Models)
		item := hubProviderChannelModelProbeResponse{
			ModelName:        modelName,
			EndpointMode:     group.GetProbeEndpointMode(modelName, channel.Models),
			Status:           model.HubSupplyProbeStatusPending,
			AutoProbeEnabled: autoProbeEnabled,
			Endpoints:        make([]hubProviderChannelProbeEndpointResponse, 0, len(modelTargets)),
		}
		_, item.Online = onlineModels[modelName]
		_, item.Published = publishedModels[modelName]
		allAvailable := len(modelTargets) > 0
		hasPending := len(modelTargets) == 0
		hasTesting := false
		hasWaiting := false
		hasSuspended := false
		for _, target := range modelTargets {
			item.Endpoints = append(item.Endpoints, hubProviderChannelProbeEndpointResponse{
				EndpointType: target.EndpointType, ResolvedEndpointType: target.ResolvedEndpointType,
				ProbeKind: target.ProbeKind, Status: target.Status,
				LastProbeAt: target.LastProbeAt, LastLatencyMs: target.LastLatencyMs,
				LastFirstTokenMs: target.LastFirstTokenMs,
				LastError:        target.LastError, LastErrorCode: target.LastErrorCode,
				ConsecutiveFailures: target.ConsecutiveFailures,
				SuspendedAt:         target.SuspendedAt, SuspensionReason: target.SuspensionReason,
			})
			if target.LastProbeAt > item.LastProbeAt {
				item.LastProbeAt = target.LastProbeAt
			}
			if target.Status != model.HubSupplyProbeStatusAvailable {
				allAvailable = false
			}
			if target.Status == model.HubSupplyProbeStatusPending {
				hasPending = true
			}
			if target.Status == model.HubSupplyProbeStatusTesting {
				hasTesting = true
			}
			if target.Status == model.HubSupplyProbeStatusWaiting {
				hasWaiting = true
			}
			if target.Status == model.HubSupplyProbeStatusSuspended {
				hasSuspended = true
			}
		}
		switch {
		case !autoProbeEnabled:
			item.Status = model.HubSupplyProbeStatusSkipped
		case hasTesting:
			item.Status = model.HubSupplyProbeStatusTesting
			running = true
		case hasPending:
			item.Status = model.HubSupplyProbeStatusPending
			running = true
		case hasWaiting:
			item.Status = model.HubSupplyProbeStatusWaiting
		case allAvailable:
			item.Status = model.HubSupplyProbeStatusAvailable
		case hasSuspended:
			item.Status = model.HubSupplyProbeStatusSuspended
		default:
			item.Status = model.HubSupplyProbeStatusError
		}
		items = append(items, item)
	}

	nextManualProbeAt := int64(0)
	if group.LastManualProbeAt > 0 {
		nextManualProbeAt = group.LastManualProbeAt + model.HubSupplyProbeManualCooldownSeconds
	}
	common.ApiSuccess(c, hubProviderChannelProbeResponse{
		ChannelId: channel.Id, Name: channel.Name, Running: running,
		NextManualProbeAt: nextManualProbeAt, Models: items,
	})
}

func RequestHubProviderChannelModelProbe(c *gin.Context) {
	group, _, ok := getCurrentActiveHubProviderChannel(c)
	if !ok {
		return
	}
	var req hubProviderChannelModelProbeRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.ModelName = strings.TrimSpace(req.ModelName)
	if req.ModelName == "" || len(req.ModelName) > 255 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	modelAvailable, err := runImmediateHubSupplyModelProbe(c.Request.Context(), group.Id, req.ModelName)
	if err != nil {
		if err == model.ErrHubSupplyProbeModelNotFound {
			common.ApiError(c, fmt.Errorf("model is not configured for this channel"))
			return
		}
		common.ApiError(c, err)
		return
	}
	modelStatus := model.HubSupplyProbeStatusError
	if modelAvailable {
		modelStatus = model.HubSupplyProbeStatusAvailable
	}
	common.ApiSuccess(c, gin.H{
		"next_manual_probe_at": int64(0),
		"model_status":         modelStatus,
	})
}

func UpdateHubProviderChannelModelProbeEndpoint(c *gin.Context) {
	group, _, ok := getCurrentActiveHubProviderChannel(c)
	if !ok {
		return
	}
	var req hubProviderChannelModelProbeEndpointRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.ModelName = strings.TrimSpace(req.ModelName)
	req.EndpointType = model.NormalizeHubSupplyProbeEndpointMode(req.EndpointType)
	if req.ModelName == "" || len(req.ModelName) > 255 || req.EndpointType == "" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.UpdateHubSupplyGroupModelProbeEndpoint(group.Id, req.ModelName, req.EndpointType); err != nil {
		switch err {
		case model.ErrHubSupplyProbeModelNotFound:
			common.ApiError(c, fmt.Errorf("model is not configured for this channel"))
		case model.ErrHubSupplyProbeEndpointInvalid:
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		case model.ErrHubSupplyProbeTargetTesting:
			common.ApiError(c, fmt.Errorf("model is currently being tested"))
		default:
			common.ApiError(c, err)
		}
		return
	}
	if err := reconcileHubSupplyGroupRouteState(group.Id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"next_manual_probe_at": int64(0),
		"model_status":         model.HubSupplyProbeStatusWaiting,
	})
}

func UpdateHubProviderChannelModelAutoProbe(c *gin.Context) {
	group, channel, ok := getCurrentActiveHubProviderChannel(c)
	if !ok {
		return
	}
	var req hubProviderChannelModelAutoProbeRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.ModelName = strings.TrimSpace(req.ModelName)
	if req.ModelName == "" || len(req.ModelName) > 255 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.UpdateHubSupplyGroupModelAutoProbe(group.Id, req.ModelName, req.Enabled); err != nil {
		switch err {
		case model.ErrHubSupplyProbeModelNotFound:
			common.ApiError(c, fmt.Errorf("model is not configured for this channel"))
		case model.ErrHubSupplyProbeTargetTesting:
			common.ApiError(c, fmt.Errorf("model is currently being tested"))
		default:
			common.ApiError(c, err)
		}
		return
	}
	if req.Enabled {
		enqueueHubSupplyProbe()
	}
	routableModels, err := model.GetHubSupplyChannelRoutableModels(channel.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	online := false
	for _, modelName := range routableModels {
		if modelName == req.ModelName {
			online = true
			break
		}
	}
	common.ApiSuccess(c, gin.H{
		"model_name": req.ModelName, "auto_probe_enabled": req.Enabled, "online": online,
	})
}

func UpdateHubProviderChannelModelPublication(c *gin.Context) {
	group, channel, ok := getCurrentActiveHubProviderChannel(c)
	if !ok {
		return
	}
	var req hubProviderChannelModelPublicationRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.ModelName = strings.TrimSpace(req.ModelName)
	if req.ModelName == "" || len(req.ModelName) > 255 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.UpdateHubSupplyGroupModelPublication(group.Id, req.ModelName, req.Published); err != nil {
		if err == model.ErrHubSupplyProbeModelNotFound {
			common.ApiError(c, fmt.Errorf("model is not configured for this channel"))
			return
		}
		common.ApiError(c, err)
		return
	}
	refreshedGroup, err := model.GetHubSupplyGroupByChannelID(channel.Id)
	if err != nil || refreshedGroup == nil {
		if err == nil {
			err = fmt.Errorf("channel supply state not found")
		}
		common.ApiError(c, err)
		return
	}
	publishedModels := make(map[string]struct{})
	for _, modelName := range refreshedGroup.GetPublishedModels(channel.Models) {
		publishedModels[modelName] = struct{}{}
	}
	onlineModels := make(map[string]struct{})
	routableModels, err := model.GetHubSupplyChannelRoutableModels(channel.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for _, modelName := range routableModels {
		onlineModels[modelName] = struct{}{}
	}
	_, published := publishedModels[req.ModelName]
	_, online := onlineModels[req.ModelName]
	common.ApiSuccess(c, gin.H{
		"model_name": req.ModelName, "published": published, "online": online,
		"published_model_count": len(publishedModels), "online_model_count": len(onlineModels),
	})
}

func UpdateHubProviderChannelModelsPublication(c *gin.Context) {
	group, channel, ok := getCurrentActiveHubProviderChannel(c)
	if !ok {
		return
	}
	var req hubProviderChannelModelsPublicationRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	modelNames, valid := normalizeHubProviderChannelPublicationModels(req.ModelNames)
	if !valid {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.UpdateHubSupplyGroupModelsPublication(group.Id, modelNames, req.Published); err != nil {
		if err == model.ErrHubSupplyProbeModelNotFound {
			common.ApiError(c, fmt.Errorf("one or more models are not configured for this channel"))
			return
		}
		common.ApiError(c, err)
		return
	}
	refreshedGroup, err := model.GetHubSupplyGroupByChannelID(channel.Id)
	if err != nil || refreshedGroup == nil {
		if err == nil {
			err = fmt.Errorf("channel supply state not found")
		}
		common.ApiError(c, err)
		return
	}
	routableModels, err := model.GetHubSupplyChannelRoutableModels(channel.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"model_names": modelNames, "published": req.Published,
		"published_model_count": len(refreshedGroup.GetPublishedModels(channel.Models)),
		"online_model_count":    len(routableModels),
	})
}

func DeleteHubProviderChannelFailedModels(c *gin.Context) {
	group, _, ok := getCurrentActiveHubProviderChannel(c)
	if !ok {
		return
	}
	deletedModels, err := model.DeleteHubSupplyGroupFailedModels(group.Id)
	if err != nil {
		if err == model.ErrHubSupplyFailedModelsNotFound {
			common.ApiError(c, fmt.Errorf("no failed models to delete"))
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"deleted_count":  len(deletedModels),
		"deleted_models": deletedModels,
	})
}

func NotifyHubProviderChannelMissingModelPrices(c *gin.Context) {
	group, channel, ok := getCurrentActiveHubProviderChannel(c)
	if !ok {
		return
	}
	var req hubProviderChannelMissingPricesNotificationRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	modelNames, valid := normalizeHubProviderChannelPublicationModels(req.ModelNames)
	if !valid {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	configuredModels := make(map[string]struct{}, len(channel.GetModels()))
	for _, modelName := range channel.GetModels() {
		configuredModels[modelName] = struct{}{}
	}
	missingModels := make([]string, 0, len(modelNames))
	for _, modelName := range modelNames {
		if _, configured := configuredModels[modelName]; !configured {
			continue
		}
		_, _, priced := ratio_setting.GetModelRatioOrPrice(modelName)
		if !priced {
			missingModels = append(missingModels, modelName)
		}
	}
	if len(missingModels) == 0 {
		common.ApiSuccess(c, gin.H{"notified_count": 0, "model_names": []string{}})
		return
	}
	notified, suppressed := service.NotifyHubModelPricesMissing(missingModels, channel.Id, channel.Name)
	if !notified && !suppressed {
		common.ApiError(c, fmt.Errorf("administrator notifications are disabled"))
		return
	}
	notifiedCount := 0
	if notified {
		notifiedCount = len(missingModels)
	}
	common.ApiSuccess(c, gin.H{
		"notified_count": notifiedCount,
		"model_names":    missingModels,
		"channel_id":     group.NewAPIChannelId,
		"suppressed":     suppressed,
	})
}

func normalizeHubProviderChannelPublicationModels(modelNames []string) ([]string, bool) {
	if len(modelNames) == 0 || len(modelNames) > hubProviderChannelPublicationBatchMax {
		return nil, false
	}
	normalized := make([]string, 0, len(modelNames))
	seen := make(map[string]struct{}, len(modelNames))
	for _, modelName := range modelNames {
		modelName = strings.TrimSpace(modelName)
		if modelName == "" || len(modelName) > 255 {
			return nil, false
		}
		if _, exists := seen[modelName]; exists {
			continue
		}
		seen[modelName] = struct{}{}
		normalized = append(normalized, modelName)
	}
	return normalized, len(normalized) > 0
}

func getCurrentHubProvider(c *gin.Context) (*model.HubProvider, error) {
	tenantID := common.GetContextKeyInt(c, constant.ContextKeyTenantId)
	if tenantID <= 0 {
		return model.GetHubProviderByOwnerUserIDWithoutTenant(c.GetInt("id"))
	}
	return model.GetHubProviderByOwnerUserIDInTenant(c.GetInt("id"), tenantID)
}

func requireActiveHubProvider(c *gin.Context) (*model.HubProvider, bool) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return nil, false
	}
	if provider == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderRequired)
		return nil, false
	}
	if provider.Status != model.HubProviderStatusActive {
		common.ApiErrorI18n(c, i18n.MsgHubProviderNotActive)
		return nil, false
	}
	return provider, true
}

func validHubProviderChannelProbeMinutes(textMinutes int, imageMinutes int) bool {
	return textMinutes >= hubProviderChannelProbeMinutesMin && textMinutes <= hubProviderChannelProbeMinutesMax &&
		imageMinutes >= hubProviderChannelProbeMinutesMin && imageMinutes <= hubProviderChannelProbeMinutesMax
}

func enqueueHubSupplyProbe() {
	if _, _, err := service.EnqueueSystemTask(model.SystemTaskTypeHubSupplyProbe, nil); err != nil {
		common.SysLog(fmt.Sprintf("failed to enqueue hub supply probe: %v", err))
	}
}
