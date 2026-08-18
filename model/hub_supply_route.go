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
			result[target.ModelName][target.ProbeKind] && hubSupplyProbeTargetRoutable(target)
	}
	return result
}

func hubSupplyProbeTargetRoutable(target HubSupplyGroupProbeTarget) bool {
	if target.Status == HubSupplyProbeStatusAvailable {
		return true
	}
	switch target.Status {
	case HubSupplyProbeStatusPending, HubSupplyProbeStatusTesting, HubSupplyProbeStatusError:
		return target.LastSuccessAt > 0 && target.ConsecutiveFailures < HubSupplyProbeFailureThreshold
	default:
		return false
	}
}

func hubSupplyModelHasAvailableProbeKind(kinds hubSupplyModelProbeKinds, modelName string) bool {
	for _, available := range hubSupplyModelProbeKindsForModel(kinds, modelName) {
		if available {
			return true
		}
	}
	return false
}

func hubSupplyModelHasAvailableProbeKindForChannel(channelID int, kinds hubSupplyModelProbeKinds, modelName string) bool {
	modelKinds := hubSupplyModelProbeKindsForModel(kinds, modelName)
	for probeKind, available := range modelKinds {
		if available || HubRoutingRuntimeHealthy(channelID, modelName, probeKind) {
			return true
		}
	}
	return false
}

func hubSupplyProbeKindAvailable(kinds hubSupplyModelProbeKinds, modelName, probeKind string) bool {
	return hubSupplyModelProbeKindsForModel(kinds, modelName)[probeKind]
}

func hubSupplyAutoProbeDisabledModelKinds(channelType int, modelName string, overrides map[string]string) map[string]bool {
	kinds := make(map[string]bool)
	for _, definition := range hubSupplyProbeDefinitionsWithOverrides(channelType, []string{modelName}, overrides) {
		if strings.TrimSpace(definition.ProbeKind) != "" {
			kinds[definition.ProbeKind] = true
		}
	}
	return kinds
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
	decision := GetHubRoutingDecision(channelID, modelName, requestPath)
	if decision.HardUnavailable {
		return false
	}
	if !isSupplyChannel {
		return true
	}
	probeKind := hubSupplyProbeKindForRequestPath(requestPath)
	if hubSupplyProbeKindAvailable(
		modelKinds,
		modelName,
		probeKind,
	) {
		return true
	}
	return decision.HasRuntimeSignal && decision.RuntimeSignal.RealHealthState == HubRoutingRealHealthHealthy
}

func hubSupplyPublicModelRoutable(
	channelID int,
	modelName string,
	autoProbeDisabledKinds map[string]bool,
	targets []HubSupplyGroupProbeTarget,
) bool {
	modelKinds := buildHubSupplyModelProbeKinds(targets)
	if len(autoProbeDisabledKinds) > 0 {
		modelKinds[modelName] = autoProbeDisabledKinds
	}
	for probeKind, probeRoutable := range hubSupplyModelProbeKindsForModel(modelKinds, modelName) {
		requestPath := "/v1/chat/completions"
		if probeKind == HubSupplyProbeKindImage {
			requestPath = "/v1/images/generations"
		}
		runtimeSignal, hasRuntimeSignal := GetHubRoutingRuntimeSignal(channelID, modelName, requestPath)
		if hasRuntimeSignal && runtimeSignal.RealHealthState == HubRoutingRealHealthQuarantined {
			continue
		}
		if probeRoutable || (hasRuntimeSignal && runtimeSignal.RealHealthState == HubRoutingRealHealthHealthy) {
			return true
		}
	}
	return false
}

func loadHubSupplyChannelProbeKinds(query *gorm.DB, channelIDs []int) (hubSupplyChannelProbeKinds, []HubRoutingProbeSignal, error) {
	result := make(hubSupplyChannelProbeKinds)
	if query == nil || !query.Migrator().HasTable(&HubSupplyGroup{}) ||
		!query.Migrator().HasTable(&HubSupplyGroupProbeTarget{}) {
		return result, nil, nil
	}

	groups := make([]HubSupplyGroup, 0)
	groupQuery := query.Select("id", "new_api_channel_id", "config_version", "auto_probe_disabled_models", "probe_endpoint_overrides")
	if len(channelIDs) > 0 {
		groupQuery = groupQuery.Where("new_api_channel_id IN ?", channelIDs)
	}
	if err := groupQuery.Find(&groups).Error; err != nil {
		return nil, nil, err
	}
	if len(groups) == 0 {
		return result, nil, nil
	}

	groupByID := make(map[int]HubSupplyGroup, len(groups))
	groupIDs := make([]int, 0, len(groups))
	groupChannelIDs := make([]int, 0, len(groups))
	for _, group := range groups {
		groupByID[group.Id] = group
		groupIDs = append(groupIDs, group.Id)
		groupChannelIDs = append(groupChannelIDs, group.NewAPIChannelId)
		result[group.NewAPIChannelId] = make(hubSupplyModelProbeKinds)
	}
	channels := make([]Channel, 0, len(groups))
	if err := query.Select("id", "type", "models").Where("id IN ?", groupChannelIDs).Find(&channels).Error; err != nil {
		return nil, nil, err
	}
	channelsByID := make(map[int]Channel, len(channels))
	for _, channel := range channels {
		channelsByID[channel.Id] = channel
	}

	targets := make([]HubSupplyGroupProbeTarget, 0)
	if err := query.Where("group_id IN ?", groupIDs).Find(&targets).Error; err != nil {
		return nil, nil, err
	}
	targetsByChannel := make(map[int][]HubSupplyGroupProbeTarget)
	probeSignals := make([]HubRoutingProbeSignal, 0, len(targets))
	for _, target := range targets {
		group, ok := groupByID[target.GroupId]
		if !ok || target.ConfigVersion != group.ConfigVersion {
			continue
		}
		targetsByChannel[group.NewAPIChannelId] = append(targetsByChannel[group.NewAPIChannelId], target)
		probeSignals = append(probeSignals, HubRoutingProbeSignal{
			ChannelID: group.NewAPIChannelId, ModelName: target.ModelName, ProbeKind: target.ProbeKind,
			Routable: hubSupplyProbeTargetRoutable(target), ConsecutiveFailures: target.ConsecutiveFailures,
			LastFirstTokenMs: target.LastFirstTokenMs,
		})
	}
	for channelID, channelTargets := range targetsByChannel {
		result[channelID] = buildHubSupplyModelProbeKinds(channelTargets)
	}
	for _, group := range groups {
		modelKinds := result[group.NewAPIChannelId]
		channel := channelsByID[group.NewAPIChannelId]
		overrides := group.GetProbeEndpointOverrides(channel.Models)
		for _, modelName := range normalizeHubSupplyModelNames(group.AutoProbeDisabledModels) {
			modelKinds[modelName] = hubSupplyAutoProbeDisabledModelKinds(channel.Type, modelName, overrides)
			for probeKind := range modelKinds[modelName] {
				probeSignals = append(probeSignals, HubRoutingProbeSignal{
					ChannelID: group.NewAPIChannelId, ModelName: modelName, ProbeKind: probeKind, Routable: true,
				})
			}
		}
	}
	return result, probeSignals, nil
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
	availability, _, err := loadHubSupplyChannelProbeKinds(DB, []int{channelID})
	return err == nil && hubSupplyChannelSupportsRequest(availability, channelID, modelName, requestPath)
}
