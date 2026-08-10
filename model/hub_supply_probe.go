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
package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	HubSupplyProbeKindText         = "text"
	HubSupplyProbeKindImage        = "image"
	HubSupplyProbeEndpointModeAuto = "auto"

	HubSupplyProbeStatusPending   = "pending"
	HubSupplyProbeStatusTesting   = "testing"
	HubSupplyProbeStatusWaiting   = "waiting"
	HubSupplyProbeStatusAvailable = "available"
	HubSupplyProbeStatusError     = "error"

	HubSupplyProbeManualCooldownSeconds = int64(5 * 60)
	HubSupplyProbeTestingLeaseSeconds   = int64(5 * 60)
)

var ErrHubSupplyProbeCooldown = errors.New("hub supply probe cooldown")
var ErrHubSupplyProbeModelNotFound = errors.New("hub supply probe model not found")
var ErrHubSupplyProbeEndpointInvalid = errors.New("hub supply probe endpoint type is invalid")
var ErrHubSupplyProbeTargetTesting = errors.New("hub supply probe target is testing")

type HubSupplyGroupRevision struct {
	Id             int    `json:"id" gorm:"primaryKey"`
	GroupId        int    `json:"group_id" gorm:"not null;uniqueIndex:idx_hub_supply_group_revision,priority:1;index"`
	ConfigVersion  int    `json:"config_version" gorm:"not null;uniqueIndex:idx_hub_supply_group_revision,priority:2"`
	ChannelType    int    `json:"channel_type" gorm:"not null"`
	BaseURL        string `json:"base_url" gorm:"type:varchar(1024);not null"`
	KeyFingerprint string `json:"key_fingerprint" gorm:"type:varchar(32);not null"`
	CreatedAt      int64  `json:"created_at" gorm:"bigint;not null"`
}

type HubSupplyGroupProbeTarget struct {
	Id                   int    `json:"id" gorm:"primaryKey"`
	GroupId              int    `json:"group_id" gorm:"not null;uniqueIndex:idx_hub_supply_probe_target,priority:1;index"`
	ConfigVersion        int    `json:"config_version" gorm:"not null;uniqueIndex:idx_hub_supply_probe_target,priority:2;index"`
	ModelName            string `json:"model_name" gorm:"type:varchar(255);not null;uniqueIndex:idx_hub_supply_probe_target,priority:3"`
	EndpointType         string `json:"endpoint_type" gorm:"type:varchar(64);not null;uniqueIndex:idx_hub_supply_probe_target,priority:4"`
	EndpointMode         string `json:"endpoint_mode" gorm:"type:varchar(64);not null;default:'auto'"`
	ResolvedEndpointType string `json:"resolved_endpoint_type" gorm:"type:varchar(64);not null;default:''"`
	ProbeKind            string `json:"probe_kind" gorm:"type:varchar(16);not null;index"`
	Status               string `json:"status" gorm:"type:varchar(24);not null;index"`
	LastProbeAt          int64  `json:"last_probe_at" gorm:"bigint;not null;default:0"`
	LastSuccessAt        int64  `json:"last_success_at" gorm:"bigint;not null;default:0"`
	NextProbeAt          int64  `json:"next_probe_at" gorm:"bigint;not null;index"`
	LastLatencyMs        int64  `json:"last_latency_ms" gorm:"bigint;not null;default:0"`
	LastFirstTokenMs     *int64 `json:"last_first_token_ms" gorm:"bigint"`
	LastError            string `json:"last_error" gorm:"type:text;not null;default:''"`
	LastErrorCode        string `json:"last_error_code" gorm:"type:varchar(64);not null;default:''"`
	CreatedAt            int64  `json:"created_at" gorm:"bigint;not null"`
	UpdatedAt            int64  `json:"updated_at" gorm:"bigint;not null"`
}

type HubSupplyGroupProbeSample struct {
	Id            int    `json:"id" gorm:"primaryKey"`
	GroupId       int    `json:"group_id" gorm:"not null;index"`
	ConfigVersion int    `json:"config_version" gorm:"not null;index"`
	ModelName     string `json:"model_name" gorm:"type:varchar(255);not null;index"`
	EndpointType  string `json:"endpoint_type" gorm:"type:varchar(64);not null"`
	ProbeKind     string `json:"probe_kind" gorm:"type:varchar(16);not null;index"`
	Success       bool   `json:"success" gorm:"not null;index"`
	LatencyMs     int64  `json:"latency_ms" gorm:"bigint;not null"`
	FirstTokenMs  *int64 `json:"first_token_ms" gorm:"bigint"`
	ErrorMessage  string `json:"error_message" gorm:"type:text;not null;default:''"`
	ErrorCode     string `json:"error_code" gorm:"type:varchar(64);not null;default:''"`
	ProbedAt      int64  `json:"probed_at" gorm:"bigint;not null;index"`
}

type HubSupplyProbeJob struct {
	TargetId             int
	GroupId              int
	ConfigVersion        int
	ModelName            string
	EndpointType         string
	EndpointMode         string
	ResolvedEndpointType string
	ProbeKind            string
	NewAPIChannelId      int
	ConfiguredModels     string
}

func hubSupplyKeyFingerprint(key string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(key)))
	return hex.EncodeToString(digest[:8])
}

func createHubSupplyGroupRevisionTx(tx *gorm.DB, group *HubSupplyGroup, channel *Channel) error {
	if tx == nil || group == nil || channel == nil {
		return errors.New("invalid hub supply group revision")
	}
	revision := HubSupplyGroupRevision{
		GroupId:        group.Id,
		ConfigVersion:  group.ConfigVersion,
		ChannelType:    channel.Type,
		BaseURL:        channel.GetBaseURL(),
		KeyFingerprint: hubSupplyKeyFingerprint(channel.Key),
		CreatedAt:      common.GetTimestamp(),
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&revision).Error
}

func NormalizeHubSupplyProbeEndpointMode(endpointType string) string {
	endpointType = strings.TrimSpace(endpointType)
	switch endpointType {
	case "", HubSupplyProbeEndpointModeAuto:
		return HubSupplyProbeEndpointModeAuto
	case string(constant.EndpointTypeOpenAI),
		string(constant.EndpointTypeOpenAIResponse),
		string(constant.EndpointTypeImageGeneration):
		return endpointType
	default:
		return ""
	}
}

func hubSupplyProbeDefinitions(channelType int, models []string) []HubSupplyGroupProbeTarget {
	return hubSupplyProbeDefinitionsWithOverrides(channelType, models, nil)
}

func hubSupplyProbeDefinitionsWithOverrides(channelType int, models []string, overrides map[string]string) []HubSupplyGroupProbeTarget {
	definitions := make([]HubSupplyGroupProbeTarget, 0, len(models))
	for _, modelName := range models {
		if endpointType := NormalizeHubSupplyProbeEndpointMode(overrides[modelName]); endpointType != "" && endpointType != HubSupplyProbeEndpointModeAuto {
			probeKind := HubSupplyProbeKindText
			if endpointType == string(constant.EndpointTypeImageGeneration) {
				probeKind = HubSupplyProbeKindImage
			}
			definitions = append(definitions, HubSupplyGroupProbeTarget{
				ModelName: modelName, EndpointType: endpointType, EndpointMode: endpointType, ProbeKind: probeKind,
			})
			continue
		}
		if common.IsImageGenerationModel(modelName) {
			definitions = append(definitions, HubSupplyGroupProbeTarget{
				ModelName: modelName, EndpointType: string(constant.EndpointTypeImageGeneration), EndpointMode: HubSupplyProbeEndpointModeAuto, ProbeKind: HubSupplyProbeKindImage,
			})
			continue
		}
		endpoints := GetModelSupportEndpointTypes(modelName)
		var primary constant.EndpointType
		hasImage := false
		for _, endpoint := range endpoints {
			if endpoint == constant.EndpointTypeImageGeneration {
				hasImage = true
				continue
			}
			if endpoint == constant.EndpointTypeOpenAIVideo || endpoint == constant.EndpointTypeOpenAIAlphaSearch {
				continue
			}
			if primary == "" {
				primary = endpoint
			}
			if channelType == constant.ChannelTypeAnthropic && endpoint == constant.EndpointTypeAnthropic {
				primary = endpoint
			}
		}
		if primary == "" && !hasImage {
			if channelType == constant.ChannelTypeAnthropic {
				primary = constant.EndpointTypeAnthropic
			} else {
				primary = constant.EndpointTypeOpenAI
			}
		}
		if primary != "" {
			definitions = append(definitions, HubSupplyGroupProbeTarget{
				ModelName: modelName, EndpointType: string(primary), EndpointMode: HubSupplyProbeEndpointModeAuto, ProbeKind: HubSupplyProbeKindText,
			})
		}
		if hasImage {
			definitions = append(definitions, HubSupplyGroupProbeTarget{
				ModelName: modelName, EndpointType: string(constant.EndpointTypeImageGeneration), EndpointMode: HubSupplyProbeEndpointModeAuto, ProbeKind: HubSupplyProbeKindImage,
			})
		}
	}
	return definitions
}

func syncHubSupplyGroupProbeTargetsTx(tx *gorm.DB, group *HubSupplyGroup, channel *Channel) error {
	models := channel.GetModels()
	definitions := hubSupplyProbeDefinitionsWithOverrides(channel.Type, models, group.GetProbeEndpointOverrides(channel.Models))
	now := common.GetTimestamp()

	var existing []HubSupplyGroupProbeTarget
	if err := tx.Where("group_id = ? AND config_version = ?", group.Id, group.ConfigVersion).Find(&existing).Error; err != nil {
		return err
	}
	desired := make(map[string]HubSupplyGroupProbeTarget, len(definitions))
	for _, definition := range definitions {
		desired[definition.ModelName+"\n"+definition.EndpointType] = definition
	}
	existingKeys := make(map[string]struct{}, len(existing))
	for _, target := range existing {
		key := target.ModelName + "\n" + target.EndpointType
		if _, keep := desired[key]; !keep {
			if err := tx.Delete(&HubSupplyGroupProbeTarget{}, target.Id).Error; err != nil {
				return err
			}
			continue
		}
		existingKeys[key] = struct{}{}
		definition := desired[key]
		if target.EndpointMode != definition.EndpointMode {
			if err := tx.Model(&HubSupplyGroupProbeTarget{Id: target.Id}).Update("endpoint_mode", definition.EndpointMode).Error; err != nil {
				return err
			}
		}
	}
	for key, definition := range desired {
		if _, exists := existingKeys[key]; exists {
			continue
		}
		definition.GroupId = group.Id
		definition.ConfigVersion = group.ConfigVersion
		definition.Status = HubSupplyProbeStatusPending
		definition.NextProbeAt = now
		definition.CreatedAt = now
		definition.UpdatedAt = now
		if err := tx.Create(&definition).Error; err != nil {
			return err
		}
	}
	return rescheduleHubSupplyGroupProbeTargetsTx(tx, group, now)
}

func rescheduleHubSupplyGroupProbeTargetsTx(tx *gorm.DB, group *HubSupplyGroup, now int64) error {
	var targets []HubSupplyGroupProbeTarget
	if err := tx.Where("group_id = ? AND config_version = ?", group.Id, group.ConfigVersion).Find(&targets).Error; err != nil {
		return err
	}
	for _, target := range targets {
		nextProbeAt := target.NextProbeAt
		if nextProbeAt <= 0 {
			nextProbeAt = now
		}
		if target.LastProbeAt > 0 &&
			target.Status != HubSupplyProbeStatusPending &&
			target.Status != HubSupplyProbeStatusTesting {
			minutes := group.TextProbeMinutes
			if target.ProbeKind == HubSupplyProbeKindImage {
				minutes = group.ImageProbeMinutes
			}
			nextProbeAt = target.LastProbeAt + int64(minutes*60)
		}
		if err := tx.Model(&HubSupplyGroupProbeTarget{Id: target.Id}).Update("next_probe_at", nextProbeAt).Error; err != nil {
			return err
		}
	}
	return nil
}

func EnsureHubSupplyGroupProbeTargets() error {
	groups, err := GetAllHubSupplyGroupsWithChannels()
	if err != nil {
		return err
	}
	for _, item := range groups {
		group := item.HubSupplyGroup
		if group.ConfigVersion <= 0 {
			group.ConfigVersion = 1
		}
		if group.TextProbeMinutes <= 0 {
			group.TextProbeMinutes = HubSupplyGroupDefaultTextProbeMinutes
		}
		if group.ImageProbeMinutes <= 0 {
			group.ImageProbeMinutes = HubSupplyGroupDefaultImageProbeMinutes
		}
		channel, channelErr := GetChannelById(group.NewAPIChannelId, true)
		if channelErr != nil {
			return channelErr
		}
		if err := group.normalizeProbeEndpointOverrides(channel.Models); err != nil {
			return err
		}
		if err := DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&HubSupplyGroup{Id: group.Id}).Updates(map[string]any{
				"config_version":           group.ConfigVersion,
				"probe_endpoint_overrides": group.ProbeEndpointOverrides,
				"text_probe_minutes":       group.TextProbeMinutes, "image_probe_minutes": group.ImageProbeMinutes,
			}).Error; err != nil {
				return err
			}
			if err := createHubSupplyGroupRevisionTx(tx, &group, channel); err != nil {
				return err
			}
			return syncHubSupplyGroupProbeTargetsTx(tx, &group, channel)
		}); err != nil {
			return err
		}
	}
	return nil
}

func HasHubSupplyGroups() bool {
	var count int64
	return DB.Model(&HubSupplyGroup{}).Limit(1).Count(&count).Error == nil && count > 0
}

func GetAllHubSupplyGroupsWithChannels() ([]HubSupplyGroupWithChannel, error) {
	groups := make([]HubSupplyGroupWithChannel, 0)
	err := DB.Table("hub_supply_groups AS supply_groups").
		Select("supply_groups.*, channels.name AS channel_name, channels.type AS channel_type, channels.base_url AS channel_base_url, channels.models AS channel_models, channels.status AS channel_status").
		Joins("JOIN channels ON channels.id = supply_groups.new_api_channel_id").
		Order("supply_groups.id ASC").Scan(&groups).Error
	return groups, err
}

func GetDueHubSupplyProbeJobs(now int64, limit int) ([]HubSupplyProbeJob, error) {
	if limit <= 0 {
		limit = 1000
	}
	jobs := make([]HubSupplyProbeJob, 0)
	err := DB.Table("hub_supply_group_probe_targets AS targets").
		Select("targets.id AS target_id, targets.group_id, targets.config_version, targets.model_name, targets.endpoint_type, targets.endpoint_mode, targets.resolved_endpoint_type, targets.probe_kind, groups.new_api_channel_id, channels.models AS configured_models").
		Joins("JOIN hub_supply_groups AS groups ON groups.id = targets.group_id AND groups.config_version = targets.config_version").
		Joins("JOIN channels ON channels.id = groups.new_api_channel_id").
		Where("targets.next_probe_at <= ?", now).
		Order("targets.next_probe_at ASC, targets.id ASC").Limit(limit).Scan(&jobs).Error
	return jobs, err
}

func GetHubSupplyGroupModelProbeJobs(groupID int, modelName string) ([]HubSupplyProbeJob, error) {
	jobs := make([]HubSupplyProbeJob, 0)
	err := DB.Table("hub_supply_group_probe_targets AS targets").
		Select("targets.id AS target_id, targets.group_id, targets.config_version, targets.model_name, targets.endpoint_type, targets.endpoint_mode, targets.resolved_endpoint_type, targets.probe_kind, groups.new_api_channel_id, channels.models AS configured_models").
		Joins("JOIN hub_supply_groups AS groups ON groups.id = targets.group_id AND groups.config_version = targets.config_version").
		Joins("JOIN channels ON channels.id = groups.new_api_channel_id").
		Where("targets.group_id = ? AND targets.model_name = ?", groupID, strings.TrimSpace(modelName)).
		Order("targets.id ASC").
		Scan(&jobs).Error
	return jobs, err
}

func UpdateHubSupplyGroupModelProbeEndpoint(groupID int, modelName, endpointMode string) error {
	modelName = strings.TrimSpace(modelName)
	endpointMode = NormalizeHubSupplyProbeEndpointMode(endpointMode)
	if groupID <= 0 || modelName == "" {
		return ErrHubSupplyProbeModelNotFound
	}
	if endpointMode == "" {
		return ErrHubSupplyProbeEndpointInvalid
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		var group HubSupplyGroup
		if err := tx.First(&group, groupID).Error; err != nil {
			return err
		}
		var channel Channel
		if err := tx.First(&channel, group.NewAPIChannelId).Error; err != nil {
			return err
		}
		configured := false
		for _, configuredModel := range channel.GetModels() {
			if configuredModel == modelName {
				configured = true
				break
			}
		}
		if !configured {
			return ErrHubSupplyProbeModelNotFound
		}

		var testingCount int64
		if err := tx.Model(&HubSupplyGroupProbeTarget{}).
			Where("group_id = ? AND config_version = ? AND model_name = ? AND status = ?", group.Id, group.ConfigVersion, modelName, HubSupplyProbeStatusTesting).
			Count(&testingCount).Error; err != nil {
			return err
		}
		if testingCount > 0 {
			return ErrHubSupplyProbeTargetTesting
		}

		overrides := group.GetProbeEndpointOverrides(channel.Models)
		if endpointMode == HubSupplyProbeEndpointModeAuto {
			delete(overrides, modelName)
		} else {
			overrides[modelName] = endpointMode
		}
		encodedOverrides, err := json.Marshal(overrides)
		if err != nil {
			return err
		}
		group.ProbeEndpointOverrides = string(encodedOverrides)

		if err := tx.Where("group_id = ? AND config_version = ? AND model_name = ?", group.Id, group.ConfigVersion, modelName).
			Delete(&HubSupplyGroupProbeSample{}).Error; err != nil {
			return err
		}
		if err := tx.Where("group_id = ? AND config_version = ? AND model_name = ?", group.Id, group.ConfigVersion, modelName).
			Delete(&HubSupplyGroupProbeTarget{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&HubSupplyGroup{Id: group.Id}).Updates(map[string]any{
			"probe_endpoint_overrides": group.ProbeEndpointOverrides,
			"updated_at":               common.GetTimestamp(),
		}).Error; err != nil {
			return err
		}

		definitions := hubSupplyProbeDefinitionsWithOverrides(channel.Type, []string{modelName}, overrides)
		now := common.GetTimestamp()
		for _, definition := range definitions {
			probeMinutes := group.TextProbeMinutes
			if definition.ProbeKind == HubSupplyProbeKindImage {
				probeMinutes = group.ImageProbeMinutes
			}
			if probeMinutes <= 0 {
				probeMinutes = HubSupplyGroupDefaultTextProbeMinutes
				if definition.ProbeKind == HubSupplyProbeKindImage {
					probeMinutes = HubSupplyGroupDefaultImageProbeMinutes
				}
			}
			definition.GroupId = group.Id
			definition.ConfigVersion = group.ConfigVersion
			definition.Status = HubSupplyProbeStatusWaiting
			definition.NextProbeAt = now + int64(probeMinutes*60)
			definition.CreatedAt = now
			definition.UpdatedAt = now
			if err := tx.Create(&definition).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func HasDueHubSupplyProbeTargets(now int64) (bool, error) {
	var count int64
	err := DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("next_probe_at <= ?", now).
		Limit(1).
		Count(&count).Error
	return count > 0, err
}

func MarkHubSupplyProbeTargetsTesting(targetIDs []int) error {
	if len(targetIDs) == 0 {
		return nil
	}
	now := common.GetTimestamp()
	return DB.Model(&HubSupplyGroupProbeTarget{}).Where("id IN ?", targetIDs).Updates(map[string]any{
		"status":        HubSupplyProbeStatusTesting,
		"next_probe_at": now + HubSupplyProbeTestingLeaseSeconds,
		"updated_at":    now,
	}).Error
}

func MarkHubSupplyGroupsTesting(groupIDs []int) error {
	if len(groupIDs) == 0 {
		return nil
	}
	return DB.Model(&HubSupplyGroup{}).
		Where("id IN ? AND status IN ?", groupIDs, []string{HubSupplyGroupStatusPending, HubSupplyGroupStatusError}).
		Updates(map[string]any{"status": HubSupplyGroupStatusTesting, "updated_at": common.GetTimestamp()}).Error
}

func GetHubSupplyGroupProbeTargets(groupID int, configVersion int) ([]HubSupplyGroupProbeTarget, error) {
	targets := make([]HubSupplyGroupProbeTarget, 0)
	err := DB.Where("group_id = ? AND config_version = ?", groupID, configVersion).
		Order("model_name ASC, probe_kind ASC, id ASC").
		Find(&targets).Error
	return targets, err
}

func RecordHubSupplyProbeResult(targetID int, success bool, latencyMs int64, errorMessage, errorCode, resolvedEndpointType string) (int, bool, error) {
	return recordHubSupplyProbeResult(targetID, success, latencyMs, nil, errorMessage, errorCode, resolvedEndpointType)
}

func RecordHubSupplyProbeResultWithTTFT(targetID int, success bool, latencyMs int64, firstTokenMs *int64, errorMessage, errorCode, resolvedEndpointType string) (int, bool, error) {
	return recordHubSupplyProbeResult(targetID, success, latencyMs, firstTokenMs, errorMessage, errorCode, resolvedEndpointType)
}

func recordHubSupplyProbeResult(targetID int, success bool, latencyMs int64, firstTokenMs *int64, errorMessage, errorCode, resolvedEndpointType string) (int, bool, error) {
	now := common.GetTimestamp()
	if firstTokenMs != nil && *firstTokenMs < 0 {
		firstTokenMs = nil
	}
	if len(errorMessage) > 2000 {
		errorMessage = errorMessage[:2000]
	}
	if len(errorCode) > 64 {
		errorCode = errorCode[:64]
	}
	groupID := 0
	isCurrent := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var target HubSupplyGroupProbeTarget
		if err := tx.First(&target, targetID).Error; err != nil {
			return err
		}
		var group HubSupplyGroup
		if err := tx.First(&group, target.GroupId).Error; err != nil {
			return err
		}
		groupID = group.Id
		isCurrent = group.ConfigVersion == target.ConfigVersion
		status := HubSupplyProbeStatusError
		lastSuccessAt := target.LastSuccessAt
		if success {
			status = HubSupplyProbeStatusAvailable
			lastSuccessAt = now
			errorMessage = ""
			errorCode = ""
		}
		nextProbeAt := int64(0)
		if isCurrent {
			minutes := group.TextProbeMinutes
			if target.ProbeKind == HubSupplyProbeKindImage {
				minutes = group.ImageProbeMinutes
			}
			nextProbeAt = now + int64(minutes*60)
		}
		updates := map[string]any{
			"status": status, "last_probe_at": now, "last_success_at": lastSuccessAt,
			"next_probe_at": nextProbeAt, "last_latency_ms": latencyMs,
			"last_error": errorMessage, "last_error_code": errorCode, "updated_at": now,
		}
		if success {
			updates["last_first_token_ms"] = firstTokenMs
		}
		if success && strings.TrimSpace(resolvedEndpointType) != "" {
			updates["resolved_endpoint_type"] = strings.TrimSpace(resolvedEndpointType)
		}
		if err := tx.Model(&HubSupplyGroupProbeTarget{Id: target.Id}).Updates(updates).Error; err != nil {
			return err
		}
		sampleEndpointType := target.EndpointType
		if strings.TrimSpace(resolvedEndpointType) != "" {
			sampleEndpointType = strings.TrimSpace(resolvedEndpointType)
		}
		sample := HubSupplyGroupProbeSample{
			GroupId: target.GroupId, ConfigVersion: target.ConfigVersion,
			ModelName: target.ModelName, EndpointType: sampleEndpointType,
			ProbeKind: target.ProbeKind, Success: success, LatencyMs: latencyMs,
			FirstTokenMs: firstTokenMs,
			ErrorMessage: errorMessage, ErrorCode: errorCode, ProbedAt: now,
		}
		return tx.Create(&sample).Error
	})
	return groupID, isCurrent, err
}

func ReconcileHubSupplyGroupRouteState(groupID int) error {
	if err := DB.Transaction(func(tx *gorm.DB) error {
		return reconcileHubSupplyGroupRouteStateTx(tx, groupID)
	}); err != nil {
		return err
	}
	InitChannelCache()
	return nil
}

func reconcileHubSupplyGroupRouteStateTx(tx *gorm.DB, groupID int) error {
	if tx == nil || groupID <= 0 {
		return errors.New("invalid hub supply group route state update")
	}
	var group HubSupplyGroup
	if err := lockForUpdate(tx).First(&group, groupID).Error; err != nil {
		return err
	}
	providerStatus := HubProviderStatusActive
	var provider HubProvider
	if err := tx.Select("status").First(&provider, group.ProviderId).Error; err == nil {
		providerStatus = provider.Status
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	var channel Channel
	if err := lockForUpdate(tx).First(&channel, group.NewAPIChannelId).Error; err != nil {
		return err
	}
	var targets []HubSupplyGroupProbeTarget
	if err := tx.Where("group_id = ? AND config_version = ?", group.Id, group.ConfigVersion).Find(&targets).Error; err != nil {
		return err
	}

	targetsByModel := make(map[string][]HubSupplyGroupProbeTarget)
	probeKinds := buildHubSupplyModelProbeKinds(targets)
	lastProbeAt := int64(0)
	for _, target := range targets {
		targetsByModel[target.ModelName] = append(targetsByModel[target.ModelName], target)
		if target.LastProbeAt > lastProbeAt {
			lastProbeAt = target.LastProbeAt
		}
	}
	configuredModels := channel.GetModels()
	fullyAvailableCount, availableCount, errorCount, pendingCount, waitingCount := 0, 0, 0, 0, 0
	for _, modelName := range configuredModels {
		modelTargets := targetsByModel[modelName]
		allAvailable := len(modelTargets) > 0
		hasAvailable := false
		hasPending := len(modelTargets) == 0
		hasWaiting := false
		for _, target := range modelTargets {
			if target.Status == HubSupplyProbeStatusAvailable {
				hasAvailable = true
			}
			if target.Status != HubSupplyProbeStatusAvailable {
				allAvailable = false
			}
			if target.Status == HubSupplyProbeStatusPending || target.Status == HubSupplyProbeStatusTesting {
				hasPending = true
			}
			if target.Status == HubSupplyProbeStatusWaiting {
				hasWaiting = true
			}
		}
		if allAvailable {
			fullyAvailableCount++
			availableCount++
		} else if hasAvailable {
			availableCount++
		} else if hasPending {
			pendingCount++
		} else if hasWaiting {
			waitingCount++
		} else {
			errorCount++
		}
	}

	status := HubSupplyGroupStatusPending
	if fullyAvailableCount == len(configuredModels) && len(configuredModels) > 0 {
		status = HubSupplyGroupStatusAvailable
	} else if availableCount > 0 {
		status = HubSupplyGroupStatusPartial
	} else if pendingCount > 0 {
		status = HubSupplyGroupStatusTesting
	} else if waitingCount > 0 {
		status = HubSupplyGroupStatusPending
	} else if errorCount > 0 {
		status = HubSupplyGroupStatusError
	}
	channelStatus := common.ChannelStatusAutoDisabled
	publishedModels := make(map[string]struct{})
	for _, modelName := range group.GetPublishedModels(channel.Models) {
		publishedModels[modelName] = struct{}{}
	}
	routableModelCount := 0
	for modelName := range publishedModels {
		if hubSupplyModelHasAvailableProbeKind(probeKinds, modelName) {
			routableModelCount++
		}
	}
	if providerStatus == HubProviderStatusActive && routableModelCount > 0 {
		channelStatus = common.ChannelStatusEnabled
	}

	if err := tx.Model(&HubSupplyGroup{Id: group.Id}).Updates(map[string]any{
		"status": status, "available_model_count": availableCount,
		"error_model_count": errorCount, "pending_model_count": pendingCount,
		"last_probe_at": lastProbeAt, "updated_at": common.GetTimestamp(),
	}).Error; err != nil {
		return err
	}
	return reconcileHubSupplyChannelRouteStateTx(tx, channel.Id, channelStatus)
}

func reconcileHubSupplyChannelRouteStateTx(tx *gorm.DB, channelID int, status int) error {
	if tx == nil || channelID <= 0 {
		return errors.New("invalid hub supply channel route state update")
	}
	if status != common.ChannelStatusEnabled && status != common.ChannelStatusAutoDisabled {
		return errors.New("invalid hub supply channel route status")
	}

	// Manual disable may happen after the probe state was read. Keep it out of
	// the automatic status update so the administrator's newer decision wins.
	result := tx.Model(&Channel{}).
		Where("id = ? AND status <> ?", channelID, common.ChannelStatusManuallyDisabled).
		Update("status", status)
	if result.Error != nil {
		return result.Error
	}

	var current Channel
	if err := tx.First(&current, channelID).Error; err != nil {
		return err
	}
	if current.Status == common.ChannelStatusManuallyDisabled || current.Status != status {
		return nil
	}
	if err := tx.Where("channel_id = ?", channelID).Delete(&Ability{}).Error; err != nil {
		return err
	}
	return current.AddAbilities(tx)
}

func requestImmediateHubSupplyGroupProbe(groupID int, modelName string) (int64, error) {
	now := common.GetTimestamp()
	nextAllowedAt := int64(0)
	isGroupProbe := modelName == ""
	err := DB.Transaction(func(tx *gorm.DB) error {
		var group HubSupplyGroup
		if err := tx.First(&group, groupID).Error; err != nil {
			return err
		}
		if isGroupProbe {
			nextAllowedAt = group.LastManualProbeAt + HubSupplyProbeManualCooldownSeconds
			if group.LastManualProbeAt > 0 && nextAllowedAt > now {
				return ErrHubSupplyProbeCooldown
			}
		}
		targets := tx.Model(&HubSupplyGroupProbeTarget{}).
			Where("group_id = ? AND config_version = ?", group.Id, group.ConfigVersion)
		if modelName != "" {
			targets = targets.Where("model_name = ?", modelName)
			var count int64
			if err := targets.Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return ErrHubSupplyProbeModelNotFound
			}
		}
		if isGroupProbe {
			if err := tx.Model(&HubSupplyGroup{Id: group.Id}).Update("last_manual_probe_at", now).Error; err != nil {
				return err
			}
			nextAllowedAt = now + HubSupplyProbeManualCooldownSeconds
		}
		if err := targets.Updates(map[string]any{
			"status": HubSupplyProbeStatusPending, "next_probe_at": now, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		return nil
	})
	return nextAllowedAt, err
}

func RequestImmediateHubSupplyGroupProbe(groupID int) (int64, error) {
	return requestImmediateHubSupplyGroupProbe(groupID, "")
}

func RequestImmediateHubSupplyGroupModelProbe(groupID int, modelName string) (int64, error) {
	return requestImmediateHubSupplyGroupProbe(groupID, strings.TrimSpace(modelName))
}
