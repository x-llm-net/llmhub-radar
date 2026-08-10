package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
)

type hubSupplyModelProbeKinds map[string]map[string]bool
type hubSupplyChannelProbeKinds map[int]hubSupplyModelProbeKinds

func hubSupplyProbeKindForRequestPath(requestPath string) string {
	requestPath = strings.ToLower(strings.TrimSpace(requestPath))
	if strings.HasPrefix(requestPath, "/v1/images/generations") ||
		strings.HasPrefix(requestPath, "/v1/images/edits") {
		return HubSupplyProbeKindImage
	}
	return HubSupplyProbeKindText
}

func buildHubSupplyModelProbeKinds(targets []HubSupplyGroupProbeTarget) hubSupplyModelProbeKinds {
	result := make(hubSupplyModelProbeKinds)
	seen := make(map[string]map[string]bool)
	for _, target := range targets {
		if result[target.ModelName] == nil {
			result[target.ModelName] = make(map[string]bool)
			seen[target.ModelName] = make(map[string]bool)
		}
		if !seen[target.ModelName][target.ProbeKind] {
			result[target.ModelName][target.ProbeKind] = true
			seen[target.ModelName][target.ProbeKind] = true
		}
		result[target.ModelName][target.ProbeKind] =
			result[target.ModelName][target.ProbeKind] && target.Status == HubSupplyProbeStatusAvailable
	}
	return result
}

func hubSupplyModelHasAvailableProbeKind(kinds hubSupplyModelProbeKinds, modelName string) bool {
	for _, available := range hubSupplyModelProbeKindsForModel(kinds, modelName) {
		if available {
			return true
		}
	}
	return false
}

func hubSupplyProbeKindAvailable(kinds hubSupplyModelProbeKinds, modelName, probeKind string) bool {
	return hubSupplyModelProbeKindsForModel(kinds, modelName)[probeKind]
}

func hubSupplyModelProbeKindsForModel(kinds hubSupplyModelProbeKinds, modelName string) map[string]bool {
	if modelKinds := kinds[modelName]; modelKinds != nil {
		return modelKinds
	}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	if normalized != "" && normalized != modelName {
		return kinds[normalized]
	}
	return nil
}

func hubSupplyChannelSupportsRequest(
	availability hubSupplyChannelProbeKinds,
	channelID int,
	modelName string,
	requestPath string,
) bool {
	modelKinds, isSupplyChannel := availability[channelID]
	if !isSupplyChannel {
		return true
	}
	return hubSupplyProbeKindAvailable(
		modelKinds,
		modelName,
		hubSupplyProbeKindForRequestPath(requestPath),
	)
}

func loadHubSupplyChannelProbeKinds(query *gorm.DB, channelIDs []int) (hubSupplyChannelProbeKinds, error) {
	result := make(hubSupplyChannelProbeKinds)
	if query == nil || !query.Migrator().HasTable(&HubSupplyGroup{}) {
		return result, nil
	}

	groups := make([]HubSupplyGroup, 0)
	groupQuery := query.Select("id", "new_api_channel_id", "config_version")
	if len(channelIDs) > 0 {
		groupQuery = groupQuery.Where("new_api_channel_id IN ?", channelIDs)
	}
	if err := groupQuery.Find(&groups).Error; err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		return result, nil
	}

	groupByID := make(map[int]HubSupplyGroup, len(groups))
	groupIDs := make([]int, 0, len(groups))
	for _, group := range groups {
		groupByID[group.Id] = group
		groupIDs = append(groupIDs, group.Id)
		result[group.NewAPIChannelId] = make(hubSupplyModelProbeKinds)
	}

	targets := make([]HubSupplyGroupProbeTarget, 0)
	if err := query.Where("group_id IN ?", groupIDs).Find(&targets).Error; err != nil {
		return nil, err
	}
	targetsByChannel := make(map[int][]HubSupplyGroupProbeTarget)
	for _, target := range targets {
		group, ok := groupByID[target.GroupId]
		if !ok || target.ConfigVersion != group.ConfigVersion {
			continue
		}
		targetsByChannel[group.NewAPIChannelId] = append(targetsByChannel[group.NewAPIChannelId], target)
	}
	for channelID, channelTargets := range targetsByChannel {
		result[channelID] = buildHubSupplyModelProbeKinds(channelTargets)
	}
	return result, nil
}

func IsHubSupplyChannelRoutableForRequest(channelID int, modelName, requestPath string) bool {
	if channelID <= 0 || strings.TrimSpace(modelName) == "" {
		return false
	}
	if common.MemoryCacheEnabled {
		channelSyncLock.RLock()
		defer channelSyncLock.RUnlock()
		return hubSupplyChannelSupportsRequest(channel2HubSupplyProbeKinds, channelID, modelName, requestPath)
	}
	availability, err := loadHubSupplyChannelProbeKinds(DB, []int{channelID})
	return err == nil && hubSupplyChannelSupportsRequest(availability, channelID, modelName, requestPath)
}
