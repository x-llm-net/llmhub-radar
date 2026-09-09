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
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
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
	HubSupplyProbeStatusSuspended = "suspended"
	HubSupplyProbeStatusSkipped   = "skipped"

	HubSupplyProbeManualCooldownSeconds = int64(5 * 60)
	HubSupplyProbeTestingLeaseSeconds   = int64(5 * 60)
	HubSupplyProbeFailureThreshold      = 2
	HubSupplyProbeFailureSuspendLimit   = 100

	HubSupplyProbeSuspensionReasonFailureLimit = "automatic_probe_failure_limit"
)

var ErrHubSupplyProbeCooldown = errors.New("hub supply probe cooldown")
var ErrHubSupplyProbeModelNotFound = errors.New("hub supply probe model not found")
var ErrHubSupplyProbeEndpointInvalid = errors.New("hub supply probe endpoint type is invalid")
var ErrHubSupplyProbeTargetTesting = errors.New("hub supply probe target is testing")
var ErrHubSupplyProbeLeaseLost = errors.New("hub supply probe lease lost")

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
	LastError            string `json:"last_error" gorm:"type:text;not null"`
	LastErrorCode        string `json:"last_error_code" gorm:"type:varchar(64);not null;default:''"`
	ConsecutiveFailures  int    `json:"consecutive_failures" gorm:"not null;default:0"`
	SuspendedAt          int64  `json:"suspended_at" gorm:"bigint;not null;default:0"`
	SuspensionReason     string `json:"suspension_reason" gorm:"type:varchar(64);not null;default:''"`
	ManualProbeRequested bool   `json:"manual_probe_requested" gorm:"not null;default:false"`
	ProbeLeaseToken      string `json:"-" gorm:"type:varchar(64);not null;default:''"`
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
	ErrorMessage  string `json:"error_message" gorm:"type:text;not null"`
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
	ManualProbeRequested bool
	ProbeLeaseToken      string
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
		string(constant.EndpointTypeOpenAIResponseCompact),
		string(constant.EndpointTypeAnthropic),
		string(constant.EndpointTypeGemini),
		string(constant.EndpointTypeJinaRerank),
		string(constant.EndpointTypeEmbeddings),
		string(constant.EndpointTypeImageGeneration):
		return endpointType
	default:
		return ""
	}
}

func hubSupplyProbeDefinitions(channelType int, models []string) []HubSupplyGroupProbeTarget {
	return hubSupplyProbeDefinitionsWithOverrides(channelType, models, nil)
}

func hubSupplyProbeEndpointTypesForChannelModel(channelType int, modelName string) []constant.EndpointType {
	endpoints := common.GetEndpointTypesByChannelType(channelType, modelName)
	seen := make(map[constant.EndpointType]struct{}, len(endpoints))
	result := make([]constant.EndpointType, 0, len(endpoints))
	for _, endpoint := range endpoints {
		if endpoint == constant.EndpointTypeOpenAIVideo || endpoint == constant.EndpointTypeOpenAIAlphaSearch {
			continue
		}
		if _, exists := seen[endpoint]; exists {
			continue
		}
		seen[endpoint] = struct{}{}
		result = append(result, endpoint)
	}
	return result
}

func appendHubSupplyProbeEndpointType(endpoints []constant.EndpointType, endpoint constant.EndpointType) []constant.EndpointType {
	if endpoint == "" || endpoint == constant.EndpointTypeOpenAIVideo || endpoint == constant.EndpointTypeOpenAIAlphaSearch {
		return endpoints
	}
	for _, existing := range endpoints {
		if existing == endpoint {
			return endpoints
		}
	}
	return append(endpoints, endpoint)
}

// Initial probe hints come from this channel's configuration or explicit model
// metadata. An endpoint inferred from another channel is not a valid hint.
func hubSupplyProbeEndpointTypesForConcreteChannelTxWithResolver(tx *gorm.DB, channel *Channel, modelName string, resolver *modelMetadataEndpointResolver) []constant.EndpointType {
	if channel == nil {
		return nil
	}
	if channel.Type == constant.ChannelTypeAdvancedCustom {
		if config := channel.GetOtherSettings().AdvancedCustom; config != nil {
			endpoints := config.SupportedEndpointTypesForModel(modelName)
			result := make([]constant.EndpointType, 0, len(endpoints))
			for _, endpoint := range endpoints {
				result = appendHubSupplyProbeEndpointType(result, constant.EndpointType(endpoint))
			}
			return result
		}
	}

	result := hubSupplyProbeEndpointTypesForChannelModel(channel.Type, modelName)
	explicitEndpoints := make([]constant.EndpointType, 0)
	explicitDeclared := false
	if resolver == nil && tx != nil {
		resolver = newModelMetadataEndpointResolver(tx)
	}
	if resolver != nil {
		// Once the models table is available, resolve only from that transaction
		// snapshot. The process-wide pricing union contains capabilities from
		// unrelated channels and must never fill a concrete channel's target set.
		if resolver.err != nil {
			return nil
		}
		if metadataEndpoints, found := resolver.endpointTypes(modelName); found {
			explicitEndpoints = metadataEndpoints
			explicitDeclared = true
		}
	} else {
		explicitEndpoints = GetModelExplicitEndpointTypes(modelName)
		explicitDeclared = len(explicitEndpoints) > 0
	}
	if explicitDeclared {
		declared := make([]constant.EndpointType, 0, len(explicitEndpoints))
		for _, endpoint := range explicitEndpoints {
			// Metadata guides the first probe, not actual request eligibility.
			if common.IsEndpointTypeCompatible(channel.Type, endpoint) {
				declared = appendHubSupplyProbeEndpointType(declared, endpoint)
			}
		}
		if len(declared) > 0 {
			return declared
		}
	}
	return result
}

// legacyHubSupplyProbeEndpointTypes preserves the model-only helper used by
// older in-package callers and tests. Production paths pass a concrete Channel
// and never use this model-wide union.
func legacyHubSupplyProbeEndpointTypes(channelType int, modelName string) []constant.EndpointType {
	modelEndpoints := GetModelSupportEndpointTypes(modelName)
	if len(modelEndpoints) > 0 {
		result := make([]constant.EndpointType, 0, len(modelEndpoints))
		for _, endpoint := range modelEndpoints {
			result = appendHubSupplyProbeEndpointType(result, endpoint)
		}
		return result
	}
	return hubSupplyProbeEndpointTypesForChannelModel(channelType, modelName)
}

func hubSupplyProbeDefinition(modelName, endpointType, endpointMode, probeKind string) HubSupplyGroupProbeTarget {
	return HubSupplyGroupProbeTarget{
		ModelName: modelName, EndpointType: endpointType, EndpointMode: endpointMode, ProbeKind: probeKind,
	}
}

// hubSupplyPrimaryProbeEndpoint chooses the automatic text probe adapter for a
// concrete channel. Protocol order comes from the channel adapter and any
// explicit endpoint declaration; model names never select a protocol.
func hubSupplyPrimaryProbeEndpoint(_ int, endpoints []constant.EndpointType) constant.EndpointType {
	for _, endpoint := range endpoints {
		if endpoint == constant.EndpointTypeImageGeneration ||
			endpoint == constant.EndpointTypeOpenAIVideo ||
			endpoint == constant.EndpointTypeOpenAIAlphaSearch {
			continue
		}
		switch endpoint {
		case constant.EndpointTypeOpenAI, constant.EndpointTypeOpenAIResponse,
			constant.EndpointTypeOpenAIResponseCompact,
			constant.EndpointTypeAnthropic, constant.EndpointTypeGemini,
			constant.EndpointTypeEmbeddings, constant.EndpointTypeJinaRerank:
			return endpoint
		}
	}
	return ""
}

func hubSupplyProbeDefinitionsWithOverrides(channelType int, models []string, overrides map[string]string) []HubSupplyGroupProbeTarget {
	return hubSupplyProbeDefinitionsForChannel(nil, channelType, models, overrides)
}

func hubSupplyProbeDefinitionsForChannel(channel *Channel, channelType int, models []string, overrides map[string]string) []HubSupplyGroupProbeTarget {
	definitions, _ := hubSupplyProbeDefinitionsForChannelTx(nil, channel, channelType, models, overrides)
	return definitions
}

func hubSupplyProbeDefinitionsForChannelTx(tx *gorm.DB, channel *Channel, channelType int, models []string, overrides map[string]string) ([]HubSupplyGroupProbeTarget, error) {
	definitions := make([]HubSupplyGroupProbeTarget, 0, len(models))
	if len(models) == 0 {
		return definitions, nil
	}
	var metadataResolver *modelMetadataEndpointResolver
	if tx != nil && channel != nil && channel.Type != constant.ChannelTypeAdvancedCustom {
		for _, modelName := range models {
			if NormalizeHubSupplyProbeEndpointMode(overrides[modelName]) == HubSupplyProbeEndpointModeAuto {
				metadataResolver = newModelMetadataEndpointResolver(tx)
				break
			}
		}
		if metadataResolver != nil && metadataResolver.err != nil {
			return nil, metadataResolver.err
		}
	}
	concreteChannel := channel
	if concreteChannel == nil {
		concreteChannel = &Channel{Type: channelType}
	}
	for _, modelName := range models {
		if endpointType := NormalizeHubSupplyProbeEndpointMode(overrides[modelName]); endpointType != "" && endpointType != HubSupplyProbeEndpointModeAuto {
			probeKind := HubSupplyProbeKindText
			if endpointType == string(constant.EndpointTypeImageGeneration) {
				probeKind = HubSupplyProbeKindImage
			}
			definitions = append(definitions, hubSupplyProbeDefinition(modelName, endpointType, endpointType, probeKind))
			continue
		}
		var endpoints []constant.EndpointType
		if channel == nil {
			endpoints = legacyHubSupplyProbeEndpointTypes(channelType, modelName)
		} else {
			endpoints = hubSupplyProbeEndpointTypesForConcreteChannelTxWithResolver(tx, concreteChannel, modelName, metadataResolver)
		}
		primary := hubSupplyPrimaryProbeEndpoint(channelType, endpoints)
		if primary != "" {
			definitions = append(definitions, hubSupplyProbeDefinition(modelName, string(primary), HubSupplyProbeEndpointModeAuto, HubSupplyProbeKindText))
		}

		for _, endpoint := range endpoints {
			if endpoint != constant.EndpointTypeImageGeneration {
				continue
			}
			if channelType == constant.ChannelTypeCodex {
				continue
			}
			definitions = append(definitions, hubSupplyProbeDefinition(modelName, string(endpoint), HubSupplyProbeEndpointModeAuto, HubSupplyProbeKindImage))
			break
		}
	}
	return definitions, nil
}

func syncHubSupplyGroupProbeTargetsTx(tx *gorm.DB, group *HubSupplyGroup, channel *Channel) error {
	now := common.GetTimestamp()

	var existing []HubSupplyGroupProbeTarget
	if err := tx.Where("group_id = ? AND config_version = ?", group.Id, group.ConfigVersion).Find(&existing).Error; err != nil {
		return err
	}
	// Existing targets belong to this configuration version. Cache or metadata
	// refreshes must not replace their selected endpoint or successful history.
	configured := make(map[string]bool)
	for _, modelName := range channel.GetModels() {
		configured[modelName] = true
	}
	known := make(map[string]bool)
	definitions := make([]HubSupplyGroupProbeTarget, 0, len(existing))
	for _, target := range existing {
		if configured[target.ModelName] {
			known[target.ModelName] = true
			definitions = append(definitions, target)
		}
	}
	// Older versions removed targets when periodic probing was disabled. Restore
	// only successful evidence for the same configuration and selected endpoint.
	missingDisabled := make([]string, 0)
	for _, modelName := range group.GetAutoProbeDisabledModels(channel.Models) {
		if !known[modelName] {
			missingDisabled = append(missingDisabled, modelName)
		}
	}
	if len(missingDisabled) > 0 {
		var samples []HubSupplyGroupProbeSample
		if err := tx.Where("group_id = ? AND config_version = ? AND model_name IN ? AND success = ?", group.Id, group.ConfigVersion, missingDisabled, true).
			Order("probed_at DESC, id DESC").Find(&samples).Error; err != nil {
			return err
		}
		restoredKinds := make(map[string]bool)
		overrides := group.GetProbeEndpointOverrides(channel.Models)
		for _, sample := range samples {
			if NormalizeHubSupplyProbeKind(sample.ProbeKind) == "" {
				continue
			}
			mode := NormalizeHubSupplyProbeEndpointMode(overrides[sample.ModelName])
			if mode != HubSupplyProbeEndpointModeAuto && mode != sample.EndpointType {
				continue
			}
			if sample.ProbeKind == HubSupplyProbeKindImage && sample.EndpointType != string(constant.EndpointTypeImageGeneration) {
				continue
			}
			if sample.ProbedAt <= 0 || NormalizeHubSupplyProbeEndpointMode(sample.EndpointType) == "" {
				continue
			}
			key := sample.ModelName + "\n" + sample.ProbeKind
			if restoredKinds[key] {
				continue
			}
			restoredKinds[key] = true
			known[sample.ModelName] = true
			definition := hubSupplyProbeDefinition(sample.ModelName, sample.EndpointType, mode, sample.ProbeKind)
			definition.ResolvedEndpointType = sample.EndpointType
			definition.Status = HubSupplyProbeStatusAvailable
			definition.LastSuccessAt = sample.ProbedAt
			definition.LastProbeAt = sample.ProbedAt
			definition.LastLatencyMs = sample.LatencyMs
			definition.LastFirstTokenMs = sample.FirstTokenMs
			definitions = append(definitions, definition)
		}
	}
	models := make([]string, 0)
	for _, modelName := range channel.GetModels() {
		if !known[modelName] {
			models = append(models, modelName)
		}
	}
	newDefinitions, err := hubSupplyProbeDefinitionsForChannelTx(tx, channel, channel.Type, models, group.GetProbeEndpointOverrides(channel.Models))
	if err != nil {
		return err
	}
	definitions = append(definitions, newDefinitions...)
	desired := make(map[string]HubSupplyGroupProbeTarget, len(definitions))
	for _, definition := range definitions {
		desired[definition.ModelName+"\n"+definition.EndpointType+"\n"+definition.ProbeKind] = definition
	}
	existingKeys := make(map[string]struct{}, len(existing))
	for _, target := range existing {
		// ProbeKind is part of the in-memory reconciliation identity. This
		// prevents a future text/image pair that shares a protocol endpoint
		// from silently reusing or deleting the other capability's target.
		key := target.ModelName + "\n" + target.EndpointType + "\n" + target.ProbeKind
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
		if definition.Status == "" {
			definition.Status = HubSupplyProbeStatusPending
		}
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
		if group.IsAutoProbeDisabled(target.ModelName, target.ModelName) && !target.ManualProbeRequested {
			if err := tx.Model(&HubSupplyGroupProbeTarget{Id: target.Id}).Update("next_probe_at", 0).Error; err != nil {
				return err
			}
			continue
		}
		nextProbeAt := target.NextProbeAt
		if target.Status == HubSupplyProbeStatusSuspended || target.ConsecutiveFailures >= HubSupplyProbeFailureSuspendLimit {
			nextProbeAt = 0
		} else if target.LastProbeAt > 0 &&
			target.Status != HubSupplyProbeStatusPending &&
			target.Status != HubSupplyProbeStatusTesting {
			nextProbeAt = hubSupplyProbeNextProbeAt(group, &target, target.LastProbeAt, target.ConsecutiveFailures)
		}
		if nextProbeAt <= 0 {
			if target.Status != HubSupplyProbeStatusSuspended && target.ConsecutiveFailures < HubSupplyProbeFailureSuspendLimit {
				nextProbeAt = now
			}
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
			if err := syncHubSupplyGroupProbeTargetsTx(tx, &group, channel); err != nil {
				return err
			}
			return reconcileHubSupplyGroupRouteStateTx(tx, group.Id)
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

func GetAllHubSupplyGroupsWithChannels(providerIDs ...[]int) ([]HubSupplyGroupWithChannel, error) {
	groups := make([]HubSupplyGroupWithChannel, 0)
	query := DB.Table("hub_supply_groups AS supply_groups").
		Select("supply_groups.*, channels.name AS channel_name, channels.type AS channel_type, channels.base_url AS channel_base_url, channels.models AS channel_models, channels.status AS channel_status").
		Joins("JOIN channels ON channels.id = supply_groups.new_api_channel_id")
	if len(providerIDs) > 0 {
		if len(providerIDs[0]) == 0 {
			return groups, nil
		}
		query = query.Where("supply_groups.provider_id IN ?", providerIDs[0])
	}
	err := query.Order("supply_groups.id ASC").Scan(&groups).Error
	return groups, err
}

func hubSupplyProbeJobsQuery(db *gorm.DB) *gorm.DB {
	return db.Table("hub_supply_group_probe_targets AS targets").
		Select("targets.id AS target_id, targets.group_id, targets.config_version, targets.model_name, targets.endpoint_type, targets.endpoint_mode, targets.resolved_endpoint_type, targets.probe_kind, targets.manual_probe_requested, targets.probe_lease_token, supply_groups.new_api_channel_id, channels.models AS configured_models").
		Joins("JOIN hub_supply_groups AS supply_groups ON supply_groups.id = targets.group_id AND supply_groups.config_version = targets.config_version").
		Joins("JOIN channels ON channels.id = supply_groups.new_api_channel_id").
		Joins("LEFT JOIN hub_providers AS providers ON providers.id = supply_groups.provider_id")
}

func GetDueHubSupplyProbeJobs(now int64, limit int) ([]HubSupplyProbeJob, error) {
	if limit <= 0 {
		limit = 1000
	}
	jobs := make([]HubSupplyProbeJob, 0)
	err := hubSupplyProbeJobsQuery(DB).
		Where("(channels.status IN ? OR (channels.status = ? AND targets.manual_probe_requested = ?))",
			[]int{common.ChannelStatusEnabled, common.ChannelStatusAutoDisabled}, common.ChannelStatusManuallyDisabled, true).
		Where("providers.id IS NOT NULL AND providers.status = ?", HubProviderStatusActive).
		Where("targets.status <> ?", HubSupplyProbeStatusSuspended).
		Where("targets.next_probe_at > 0").
		Where("targets.next_probe_at <= ?", now).
		Order("targets.next_probe_at ASC, targets.id ASC").Limit(limit).Scan(&jobs).Error
	return jobs, err
}

func GetHubSupplyGroupModelProbeJobs(groupID int, modelName string) ([]HubSupplyProbeJob, error) {
	jobs := make([]HubSupplyProbeJob, 0)
	err := hubSupplyProbeJobsQuery(DB).
		Where("targets.group_id = ? AND targets.model_name = ?", groupID, strings.TrimSpace(modelName)).
		Order("targets.id ASC").
		Scan(&jobs).Error
	return jobs, err
}

func IsHubSupplyProbeJobExecutable(job HubSupplyProbeJob) bool {
	executable, _ := CheckHubSupplyProbeJobExecutable(job)
	return executable
}

func CheckHubSupplyProbeJobExecutable(job HubSupplyProbeJob) (bool, error) {
	if job.TargetId <= 0 || job.NewAPIChannelId <= 0 {
		return false, nil
	}
	query := hubSupplyProbeJobsQuery(DB).
		Where("targets.id = ? AND targets.status = ?", job.TargetId, HubSupplyProbeStatusTesting).
		Where("providers.id IS NOT NULL AND providers.status = ?", HubProviderStatusActive)
	if strings.TrimSpace(job.ProbeLeaseToken) != "" {
		query = query.Where("targets.probe_lease_token = ?", strings.TrimSpace(job.ProbeLeaseToken))
	}
	if job.ManualProbeRequested {
		query = query.Where("channels.status IN ?", []int{
			common.ChannelStatusEnabled,
			common.ChannelStatusManuallyDisabled,
			common.ChannelStatusAutoDisabled,
		})
	} else {
		query = query.Where("channels.status IN ?", []int{common.ChannelStatusEnabled, common.ChannelStatusAutoDisabled})
	}
	var count int64
	if err := query.Limit(1).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
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
		encodedOverrides, err := common.Marshal(overrides)
		if err != nil {
			return err
		}
		group.ProbeEndpointOverrides = string(encodedOverrides)
		if endpointMode == HubSupplyProbeEndpointModeAuto {
			if err := tx.Model(&HubSupplyGroup{Id: group.Id}).Updates(map[string]any{
				"probe_endpoint_overrides": group.ProbeEndpointOverrides,
				"updated_at":               common.GetTimestamp(),
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(&HubSupplyGroupProbeTarget{}).
				Where("group_id = ? AND config_version = ? AND model_name = ?", group.Id, group.ConfigVersion, modelName).
				Update("endpoint_mode", HubSupplyProbeEndpointModeAuto).Error; err != nil {
				return err
			}
			var verifiedCount int64
			if err := tx.Model(&HubSupplyGroupProbeTarget{}).
				Where("group_id = ? AND config_version = ? AND model_name = ? AND (last_success_at > 0 OR status = ?)", group.Id, group.ConfigVersion, modelName, HubSupplyProbeStatusAvailable).
				Count(&verifiedCount).Error; err != nil {
				return err
			}
			if verifiedCount == 0 {
				if err := tx.Where("group_id = ? AND config_version = ? AND model_name = ?", group.Id, group.ConfigVersion, modelName).
					Delete(&HubSupplyGroupProbeTarget{}).Error; err != nil {
					return err
				}
			}
			if err := syncHubSupplyGroupProbeTargetsTx(tx, &group, &channel); err != nil {
				return err
			}
			return reconcileHubSupplyGroupRouteStateTx(tx, group.Id)
		}

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

		definitions, err := hubSupplyProbeDefinitionsForChannelTx(tx, &channel, channel.Type, []string{modelName}, overrides)
		if err != nil {
			return err
		}
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
			if group.IsAutoProbeDisabled(modelName, channel.Models) {
				definition.NextProbeAt = 0
			}
			definition.CreatedAt = now
			definition.UpdatedAt = now
			if err := tx.Create(&definition).Error; err != nil {
				return err
			}
		}
		return reconcileHubSupplyGroupRouteStateTx(tx, group.Id)
	})
}

func HasDueHubSupplyProbeTargets(now int64) (bool, error) {
	var count int64
	// Keep the follow-up check aligned with GetDueHubSupplyProbeJobs. Targets
	// from superseded group configurations remain for audit, but must not wake
	// the scheduler because the runner cannot execute them.
	err := hubSupplyProbeJobsQuery(DB).
		Where("(channels.status IN ? OR (channels.status = ? AND targets.manual_probe_requested = ?))",
			[]int{common.ChannelStatusEnabled, common.ChannelStatusAutoDisabled}, common.ChannelStatusManuallyDisabled, true).
		Where("providers.id IS NOT NULL AND providers.status = ?", HubProviderStatusActive).
		Where("targets.status <> ?", HubSupplyProbeStatusSuspended).
		Where("targets.next_probe_at > 0 AND targets.next_probe_at <= ?", now).
		Limit(1).
		Count(&count).Error
	return count > 0, err
}

func RequeueExpiredHubSupplyProbeTargets(now int64) error {
	return DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("status = ? AND next_probe_at <= ?", HubSupplyProbeStatusTesting, now).
		Updates(map[string]any{
			"status": HubSupplyProbeStatusPending, "next_probe_at": now,
			"probe_lease_token": "", "updated_at": now,
		}).Error
}

func RequeueHubSupplyProbeTargets(targetIDs []int) error {
	return RequeueHubSupplyProbeTargetsWithLease(targetIDs, "")
}

func RequeueHubSupplyProbeTargetsWithLease(targetIDs []int, leaseToken string) error {
	if len(targetIDs) == 0 {
		return nil
	}
	now := common.GetTimestamp()
	query := DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("id IN ? AND status = ?", targetIDs, HubSupplyProbeStatusTesting)
	if strings.TrimSpace(leaseToken) != "" {
		query = query.Where("probe_lease_token = ?", strings.TrimSpace(leaseToken))
	}
	return query.
		Updates(map[string]any{
			"status": HubSupplyProbeStatusPending, "next_probe_at": now,
			"probe_lease_token": "", "updated_at": now,
		}).Error
}

func ReleaseSkippedHubSupplyProbeTargetWithLease(targetID int, leaseToken string) error {
	if targetID <= 0 || strings.TrimSpace(leaseToken) == "" {
		return nil
	}
	now := common.GetTimestamp()
	return DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("id = ? AND status = ? AND probe_lease_token = ?", targetID, HubSupplyProbeStatusTesting, strings.TrimSpace(leaseToken)).
		Updates(map[string]any{
			"status": gorm.Expr(
				"CASE WHEN consecutive_failures >= ? THEN ? WHEN consecutive_failures > 0 THEN ? WHEN last_success_at > 0 THEN ? ELSE ? END",
				HubSupplyProbeFailureSuspendLimit, HubSupplyProbeStatusSuspended,
				HubSupplyProbeStatusError, HubSupplyProbeStatusAvailable, HubSupplyProbeStatusPending,
			),
			"next_probe_at": gorm.Expr(
				"CASE WHEN consecutive_failures >= ? THEN 0 ELSE ? END",
				HubSupplyProbeFailureSuspendLimit, now,
			),
			"manual_probe_requested": false,
			"probe_lease_token":      "",
			"updated_at":             now,
		}).Error
}

func MarkHubSupplyProbeTargetsTesting(targetIDs []int) error {
	_, err := ClaimHubSupplyProbeTargetsTesting(targetIDs)
	return err
}

func ClaimHubSupplyProbeTargetsTesting(targetIDs []int) (string, error) {
	if len(targetIDs) == 0 {
		return "", nil
	}
	now := common.GetTimestamp()
	tokenBytes := make([]byte, 24)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := hex.EncodeToString(tokenBytes)
	err := DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("id IN ? AND status NOT IN ?", targetIDs, []string{HubSupplyProbeStatusSuspended, HubSupplyProbeStatusTesting}).
		Where("next_probe_at > 0 AND next_probe_at <= ?", now).
		Updates(map[string]any{
			"status":            HubSupplyProbeStatusTesting,
			"next_probe_at":     now + HubSupplyProbeTestingLeaseSeconds,
			"probe_lease_token": token,
			"updated_at":        now,
		}).Error
	return token, err
}

func ResetHubSupplyProbeTargetsForManualProbe(targetIDs []int) error {
	if len(targetIDs) == 0 {
		return nil
	}
	now := common.GetTimestamp()
	return DB.Model(&HubSupplyGroupProbeTarget{}).Where("id IN ?", targetIDs).Updates(map[string]any{
		"status": HubSupplyProbeStatusPending, "next_probe_at": now,
		"consecutive_failures": 0, "suspended_at": 0, "suspension_reason": "",
		"manual_probe_requested": true, "probe_lease_token": "",
		"updated_at": now,
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
	return recordHubSupplyProbeResultWithLease(targetID, "", success, latencyMs, nil, errorMessage, errorCode, resolvedEndpointType)
}

func RecordHubSupplyProbeResultWithTTFT(targetID int, success bool, latencyMs int64, firstTokenMs *int64, errorMessage, errorCode, resolvedEndpointType string) (int, bool, error) {
	return recordHubSupplyProbeResultWithLease(targetID, "", success, latencyMs, firstTokenMs, errorMessage, errorCode, resolvedEndpointType)
}

func recordHubSupplyProbeResult(targetID int, success bool, latencyMs int64, firstTokenMs *int64, errorMessage, errorCode, resolvedEndpointType string) (int, bool, error) {
	return recordHubSupplyProbeResultWithLease(targetID, "", success, latencyMs, firstTokenMs, errorMessage, errorCode, resolvedEndpointType)
}

func RecordHubSupplyProbeResultWithLease(targetID int, leaseToken string, success bool, latencyMs int64, firstTokenMs *int64, errorMessage, errorCode, resolvedEndpointType string) (int, bool, error) {
	return recordHubSupplyProbeResultWithLease(targetID, leaseToken, success, latencyMs, firstTokenMs, errorMessage, errorCode, resolvedEndpointType)
}

func recordHubSupplyProbeResultWithLease(targetID int, leaseToken string, success bool, latencyMs int64, firstTokenMs *int64, errorMessage, errorCode, resolvedEndpointType string) (int, bool, error) {
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
		targetQuery := tx.Where("id = ?", targetID)
		if strings.TrimSpace(leaseToken) != "" {
			targetQuery = targetQuery.Where("status = ? AND probe_lease_token = ?", HubSupplyProbeStatusTesting, strings.TrimSpace(leaseToken))
		}
		if err := targetQuery.First(&target).Error; err != nil {
			if strings.TrimSpace(leaseToken) != "" && errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrHubSupplyProbeLeaseLost
			}
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
		consecutiveFailures := target.ConsecutiveFailures + 1
		suspendedAt := int64(0)
		suspensionReason := ""
		if success {
			status = HubSupplyProbeStatusAvailable
			lastSuccessAt = now
			consecutiveFailures = 0
			errorMessage = ""
			errorCode = ""
		} else if consecutiveFailures >= HubSupplyProbeFailureSuspendLimit {
			consecutiveFailures = HubSupplyProbeFailureSuspendLimit
			status = HubSupplyProbeStatusSuspended
			suspendedAt = now
			suspensionReason = HubSupplyProbeSuspensionReasonFailureLimit
		}
		nextProbeAt := int64(0)
		if isCurrent && status != HubSupplyProbeStatusSuspended && !group.IsAutoProbeDisabled(target.ModelName, target.ModelName) {
			nextProbeAt = hubSupplyProbeNextProbeAt(&group, &target, now, consecutiveFailures)
		}
		updates := map[string]any{
			"status": status, "last_probe_at": now, "last_success_at": lastSuccessAt,
			"next_probe_at": nextProbeAt, "last_latency_ms": latencyMs,
			"last_error": errorMessage, "last_error_code": errorCode,
			"consecutive_failures": consecutiveFailures,
			"suspended_at":         suspendedAt, "suspension_reason": suspensionReason,
			"manual_probe_requested": false, "probe_lease_token": "",
			"updated_at": now,
		}
		if success {
			updates["last_first_token_ms"] = firstTokenMs
		}
		if success && strings.TrimSpace(resolvedEndpointType) != "" {
			updates["resolved_endpoint_type"] = strings.TrimSpace(resolvedEndpointType)
		}
		updateQuery := tx.Model(&HubSupplyGroupProbeTarget{}).Where("id = ?", target.Id)
		if strings.TrimSpace(leaseToken) != "" {
			updateQuery = updateQuery.Where("status = ? AND probe_lease_token = ?", HubSupplyProbeStatusTesting, strings.TrimSpace(leaseToken))
		}
		updateResult := updateQuery.Updates(updates)
		if updateResult.Error != nil {
			return updateResult.Error
		}
		if strings.TrimSpace(leaseToken) != "" && updateResult.RowsAffected != 1 {
			return ErrHubSupplyProbeLeaseLost
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
		if err := tx.Create(&sample).Error; err != nil {
			return err
		}
		if isCurrent {
			return reconcileHubSupplyGroupRouteStateTx(tx, group.Id)
		}
		return nil
	})
	return groupID, isCurrent, err
}

func hubSupplyProbeNextProbeAt(group *HubSupplyGroup, target *HubSupplyGroupProbeTarget, probedAt int64, consecutiveFailures int) int64 {
	if consecutiveFailures >= HubSupplyProbeFailureSuspendLimit {
		return 0
	}
	minutes := HubSupplyGroupDefaultTextProbeMinutes
	if group != nil {
		minutes = group.TextProbeMinutes
	}
	if target != nil && target.ProbeKind == HubSupplyProbeKindImage {
		minutes = HubSupplyGroupDefaultImageProbeMinutes
		if group != nil {
			minutes = group.ImageProbeMinutes
		}
	}
	if minutes <= 0 {
		minutes = HubSupplyGroupDefaultTextProbeMinutes
		if target != nil && target.ProbeKind == HubSupplyProbeKindImage {
			minutes = HubSupplyGroupDefaultImageProbeMinutes
		}
	}
	minutes = HubSupplyProbeRetryDelayMinutes(minutes, consecutiveFailures)
	return probedAt + int64(minutes*60)
}

// HubSupplyProbeRetryDelayMinutes is shared by scheduled probes and the
// temporary affinity recovery gate. Keeping the backoff here prevents those
// two paths from slowly acquiring different retry semantics.
func HubSupplyProbeRetryDelayMinutes(baseMinutes, consecutiveFailures int) int {
	if baseMinutes <= 0 {
		baseMinutes = HubSupplyGroupDefaultTextProbeMinutes
	}
	if consecutiveFailures <= 0 {
		return baseMinutes
	}
	capMinutes := 5
	if consecutiveFailures >= 30 {
		capMinutes = 60
	} else if consecutiveFailures >= 10 {
		capMinutes = 15
	}
	if baseMinutes > capMinutes {
		return capMinutes
	}
	return baseMinutes
}

// HubSupplyProbeRecoveryDelaySeconds uses the text-probe schedule as the
// default for a request-path recovery attempt. It is not a second probe: it
// only controls how long a fallback affinity remains preferred.
func HubSupplyProbeRecoveryDelaySeconds(consecutiveFailures int) int64 {
	return HubSupplyProbeRecoveryDelaySecondsForRequestPath("", consecutiveFailures)
}

// HubSupplyProbeRecoveryDelaySecondsForRequestPath follows the same endpoint
// defaults as scheduled probes: text uses 10 minutes and image uses 30
// minutes before the shared failure backoff is applied.
func HubSupplyProbeRecoveryDelaySecondsForRequestPath(requestPath string, consecutiveFailures int) int64 {
	return HubSupplyProbeRecoveryDelaySecondsForModelRequest("", requestPath, consecutiveFailures)
}

// HubSupplyProbeRecoveryDelaySecondsForModelRequest follows the same
// request-path classification used by routing and runtime health.
func HubSupplyProbeRecoveryDelaySecondsForModelRequest(modelName, requestPath string, consecutiveFailures int) int64 {
	return HubSupplyProbeRecoveryDelaySecondsForModelRequestWithProbeKind(modelName, requestPath, "", consecutiveFailures)
}

func HubSupplyProbeRecoveryDelaySecondsForModelRequestWithProbeKind(modelName, requestPath, probeKind string, consecutiveFailures int) int64 {
	baseMinutes := HubSupplyGroupDefaultTextProbeMinutes
	if HubSupplyProbeKindForRequest(requestPath, probeKind) == HubSupplyProbeKindImage {
		baseMinutes = HubSupplyGroupDefaultImageProbeMinutes
	}
	return int64(HubSupplyProbeRetryDelayMinutes(baseMinutes, consecutiveFailures) * 60)
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
	autoProbeDisabled := make(map[string]struct{})
	for _, modelName := range group.GetAutoProbeDisabledModels(channel.Models) {
		autoProbeDisabled[modelName] = struct{}{}
		probeKinds[modelName] = hubSupplyAutoProbeDisabledModelKinds(modelName, targets)
	}
	fullyAvailableCount, availableCount, errorCount, pendingCount, waitingCount := 0, 0, 0, 0, 0
	for _, modelName := range configuredModels {
		if _, disabled := autoProbeDisabled[modelName]; disabled && hubSupplyModelHasAvailableProbeKind(probeKinds, modelName) {
			fullyAvailableCount++
			availableCount++
			continue
		}
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
		if hubSupplyModelHasAvailableProbeKindForChannel(channel.Id, probeKinds, modelName) {
			routableModelCount++
		}
	}
	if providerStatus == HubProviderStatusActive && routableModelCount > 0 {
		channelStatus = common.ChannelStatusEnabled
	}
	if routableModelCount > 0 && status != HubSupplyGroupStatusAvailable {
		status = HubSupplyGroupStatusPartial
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

func migrateHubSupplyProbeFailureCounts() error {
	if !DB.Migrator().HasTable(&HubSupplyGroupProbeTarget{}) {
		return nil
	}
	// Rows written before consecutive failure tracking have a zero value even
	// when they are already in error. Keep those legacy failures quarantined.
	if err := DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("status = ? AND consecutive_failures = 0", HubSupplyProbeStatusError).
		Update("consecutive_failures", HubSupplyProbeFailureThreshold).Error; err != nil {
		return err
	}
	now := common.GetTimestamp()
	return DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("consecutive_failures >= ? AND (status <> ? OR suspended_at = 0 OR suspension_reason = '')",
			HubSupplyProbeFailureSuspendLimit, HubSupplyProbeStatusSuspended).
		Updates(map[string]any{
			"status": HubSupplyProbeStatusSuspended, "next_probe_at": 0,
			"suspended_at": now, "suspension_reason": HubSupplyProbeSuspensionReasonFailureLimit,
			"manual_probe_requested": false, "probe_lease_token": "",
		}).Error
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
			"status": HubSupplyProbeStatusPending, "next_probe_at": now,
			"consecutive_failures": 0, "suspended_at": 0, "suspension_reason": "",
			"manual_probe_requested": true, "probe_lease_token": "",
			"updated_at": now,
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

func UpdateHubSupplyGroupModelAutoProbe(groupID int, modelName string, enabled bool) error {
	modelName = strings.TrimSpace(modelName)
	if groupID <= 0 || modelName == "" {
		return ErrHubSupplyProbeModelNotFound
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var group HubSupplyGroup
		if err := lockForUpdate(tx).First(&group, groupID).Error; err != nil {
			return err
		}
		var channel Channel
		if err := lockForUpdate(tx).First(&channel, group.NewAPIChannelId).Error; err != nil {
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

		disabled := make(map[string]struct{})
		for _, disabledModel := range group.GetAutoProbeDisabledModels(channel.Models) {
			disabled[disabledModel] = struct{}{}
		}
		if enabled {
			delete(disabled, modelName)
		} else {
			disabled[modelName] = struct{}{}
		}
		ordered := make([]string, 0, len(disabled))
		for _, configuredModel := range channel.GetModels() {
			if _, ok := disabled[configuredModel]; ok {
				ordered = append(ordered, configuredModel)
			}
		}
		group.AutoProbeDisabledModels = strings.Join(ordered, ",")
		if err := tx.Model(&HubSupplyGroup{Id: group.Id}).Updates(map[string]any{
			"auto_probe_disabled_models": group.AutoProbeDisabledModels,
			"updated_at":                 common.GetTimestamp(),
		}).Error; err != nil {
			return err
		}
		if err := syncHubSupplyGroupProbeTargetsTx(tx, &group, &channel); err != nil {
			return err
		}
		return reconcileHubSupplyGroupRouteStateTx(tx, group.Id)
	})
	if err != nil {
		return err
	}
	InitChannelCache()
	return nil
}
