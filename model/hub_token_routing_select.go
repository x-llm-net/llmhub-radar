package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// GetRandomSatisfiedChannelWithHubPolicy keeps the existing channel priority,
// weight, request-path and probe checks, but builds its candidate set from a
// token's model-family and multiplier policy instead of one legacy Group.
func GetRandomSatisfiedChannelWithHubPolicy(
	policy *HubTokenRoutingPolicy,
	modelName string,
	retry int,
	requestPath string,
	excludedChannelIDs map[int]struct{},
	providerFilter ChannelProviderFilter,
) (*Channel, HubSupplyPricingSnapshot, error) {
	if policy == nil || strings.TrimSpace(modelName) == "" {
		return nil, HubSupplyPricingSnapshot{}, nil
	}
	if common.MemoryCacheEnabled {
		return getHubPolicyChannelFromCache(policy, modelName, retry, requestPath, excludedChannelIDs, providerFilter)
	}
	return getHubPolicyChannelFromDB(policy, modelName, retry, requestPath, excludedChannelIDs, providerFilter)
}

// IsModelAvailableForHubTokenPolicy keeps model discovery aligned with the
// same multiplier, provider-status and publication checks used by requests.
func IsModelAvailableForHubTokenPolicy(policy *HubTokenRoutingPolicy, modelName string) (bool, error) {
	if policy == nil || !policy.AllowsModel(modelName) {
		return false, nil
	}
	if policy.Mode == HubTokenRoutingModeProvider {
		provider, ok := GetHubProviderRoutingByID(policy.ProviderID)
		if !ok || provider.Status != HubProviderStatusActive {
			return false, nil
		}
	}
	channel, _, err := GetRandomSatisfiedChannelWithHubPolicy(
		policy,
		modelName,
		0,
		"",
		nil,
		ChannelProviderFilter{},
	)
	return channel != nil, err
}

// HasConfiguredSupplyForHubTokenPolicy distinguishes a permanently unsupported
// model from supply that is only temporarily unroutable. It intentionally
// ignores probe health, Channel status, and Provider status.
func HasConfiguredSupplyForHubTokenPolicy(policy *HubTokenRoutingPolicy, modelName string) (bool, error) {
	if policy == nil || !policy.AllowsModel(modelName) || DB == nil {
		return false, nil
	}

	modelNames := []string{modelName}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	if normalized != "" && normalized != modelName {
		modelNames = append(modelNames, normalized)
	}
	modelSet := make(map[string]struct{}, len(modelNames))
	for _, candidate := range modelNames {
		modelSet[candidate] = struct{}{}
	}

	type configuredSupplyRow struct {
		ChannelID       int     `gorm:"column:channel_id"`
		PriceMultiplier float64 `gorm:"column:price_multiplier"`
		PublishedModels string  `gorm:"column:published_models"`
		ChannelModels   string  `gorm:"column:channel_models"`
	}
	var supplyRows []configuredSupplyRow
	if err := DB.Table("hub_supply_groups AS supply_groups").
		Select("supply_groups.new_api_channel_id AS channel_id, supply_groups.price_multiplier, supply_groups.published_models, channels.models AS channel_models").
		Joins("JOIN channels ON channels.id = supply_groups.new_api_channel_id").
		Scan(&supplyRows).Error; err != nil {
		return false, err
	}

	configuredSupplyChannels := make(map[int]struct{}, len(supplyRows))
	family := ClassifyHubPublicModelFamily(modelName)
	for _, row := range supplyRows {
		configuredSupplyChannels[row.ChannelID] = struct{}{}
		if !policy.AllowsMultiplier(family, row.PriceMultiplier) {
			continue
		}
		group := HubSupplyGroup{PublishedModels: row.PublishedModels}
		for _, publishedModel := range group.GetPublishedModels(row.ChannelModels) {
			if _, ok := modelSet[publishedModel]; ok {
				return true, nil
			}
		}
	}

	// Channels without a Hub supply record are platform-owned and use the
	// baseline multiplier. Disabled Ability rows still represent configured
	// supply, which is exactly what this temporary/permanent distinction needs.
	if !policy.AllowsMultiplier(family, 1) {
		return false, nil
	}
	var abilities []Ability
	if err := DB.Where("model IN ?", modelNames).Find(&abilities).Error; err != nil {
		return false, err
	}
	platformChannelIDs := make([]int, 0, len(abilities))
	seenPlatformChannels := make(map[int]struct{}, len(abilities))
	for _, ability := range abilities {
		if !isHubTokenRoutingCandidateAbilityGroup(ability.Group) {
			continue
		}
		if _, isSupply := configuredSupplyChannels[ability.ChannelId]; isSupply {
			continue
		}
		if _, seen := seenPlatformChannels[ability.ChannelId]; !seen {
			seenPlatformChannels[ability.ChannelId] = struct{}{}
			platformChannelIDs = append(platformChannelIDs, ability.ChannelId)
		}
	}
	if len(platformChannelIDs) == 0 {
		return false, nil
	}
	var count int64
	if err := DB.Model(&Channel{}).Where("id IN ?", platformChannelIDs).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func getHubPolicyChannelFromCache(
	policy *HubTokenRoutingPolicy,
	modelName string,
	retry int,
	requestPath string,
	excludedChannelIDs map[int]struct{},
	providerFilter ChannelProviderFilter,
) (*Channel, HubSupplyPricingSnapshot, error) {
	_ = retry
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	modelNames := []string{modelName}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	if normalized != "" && normalized != modelName {
		modelNames = append(modelNames, normalized)
	}
	family := ClassifyHubPublicModelFamily(modelName)
	seen := make(map[int]struct{})
	candidates := make([]hubTierChannelCandidate, 0)
	for group, groups := range group2model2channels {
		if !isHubTokenRoutingCandidateAbilityGroup(group) {
			continue
		}
		for _, candidateModel := range modelNames {
			for _, channelID := range groups[candidateModel] {
				if _, exists := seen[channelID]; exists {
					continue
				}
				channel, ok := channelsIDM[channelID]
				if !ok || channel.Status != common.ChannelStatusEnabled ||
					!ChannelMatchesProviderFilter(channelID, providerFilter) ||
					!hubSupplyChannelSupportsRequest(channel2HubSupplyProbeKinds, channelID, modelName, requestPath) {
					continue
				}
				if channel.Type == constant.ChannelTypeAdvancedCustom && requestPath != "" {
					config := channel2advancedCustomConfig[channelID]
					if config == nil || !config.SupportsPathForModel(requestPath, modelName) {
						continue
					}
				}
				multiplier := 1.0
				providerID := 0
				if pricing, isSupply := hubSupplyPricingByChannel[channelID]; isSupply {
					if pricing.SupplyProviderStatus != HubProviderStatusActive || pricing.PriceMultiplier <= 0 {
						continue
					}
					multiplier = pricing.PriceMultiplier
					providerID = pricing.SupplyProviderId
				}
				if !policy.AllowsMultiplier(family, multiplier) {
					continue
				}
				seen[channelID] = struct{}{}
				candidate := hubTierChannelCandidate{
					ChannelID: channelID,
					Priority:  channel.GetPriority(),
					Weight:    channel.GetWeight(),
					Provider:  providerID,
				}
				candidates = append(candidates, decorateHubTierCandidateWithRuntimeHealth(candidate, modelName, requestPath))
			}
		}
	}
	selectedID := selectHubTierChannel(candidates, excludedChannelIDs)
	if selectedID == 0 {
		return nil, HubSupplyPricingSnapshot{}, nil
	}
	channel := channelsIDM[selectedID]
	return channel, CaptureHubSupplyPricingSnapshot(selectedID), nil
}

func getHubPolicyChannelFromDB(
	policy *HubTokenRoutingPolicy,
	modelName string,
	retry int,
	requestPath string,
	excludedChannelIDs map[int]struct{},
	providerFilter ChannelProviderFilter,
) (*Channel, HubSupplyPricingSnapshot, error) {
	_ = retry
	var abilities []Ability
	query := DB.Where("enabled = ?", true)
	if err := query.Find(&abilities).Error; err != nil {
		return nil, HubSupplyPricingSnapshot{}, err
	}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	filtered := make([]Ability, 0)
	for _, ability := range abilities {
		if !isHubTokenRoutingCandidateAbilityGroup(ability.Group) {
			continue
		}
		if ability.Model != modelName && (normalized == "" || ability.Model != normalized) {
			continue
		}
		if !ChannelMatchesProviderFilter(ability.ChannelId, providerFilter) ||
			!IsHubSupplyChannelRoutableForRequest(ability.ChannelId, modelName, requestPath) {
			continue
		}
		filtered = append(filtered, ability)
	}
	if len(filtered) == 0 {
		return nil, HubSupplyPricingSnapshot{}, nil
	}
	channelIDs := make([]int, 0, len(filtered))
	seen := make(map[int]struct{})
	for _, ability := range filtered {
		if _, exists := seen[ability.ChannelId]; !exists {
			seen[ability.ChannelId] = struct{}{}
			channelIDs = append(channelIDs, ability.ChannelId)
		}
	}
	var channels []*Channel
	if err := DB.Where("id IN ? AND status = ?", channelIDs, common.ChannelStatusEnabled).Find(&channels).Error; err != nil {
		return nil, HubSupplyPricingSnapshot{}, err
	}
	channelByID := make(map[int]*Channel, len(channels))
	for _, channel := range channels {
		channelByID[channel.Id] = channel
	}
	candidates := make([]hubTierChannelCandidate, 0, len(channelIDs))
	family := ClassifyHubPublicModelFamily(modelName)
	for _, channelID := range channelIDs {
		channel := channelByID[channelID]
		if channel == nil {
			continue
		}
		multiplier := 1.0
		providerID := 0
		if pricing, isSupply := GetHubSupplyPricingByChannelID(channelID); isSupply {
			if pricing.SupplyProviderStatus != HubProviderStatusActive || pricing.PriceMultiplier <= 0 {
				continue
			}
			multiplier = pricing.PriceMultiplier
			providerID = pricing.SupplyProviderId
		}
		if !policy.AllowsMultiplier(family, multiplier) {
			continue
		}
		priority := channel.GetPriority()
		weight := channel.GetWeight()
		for _, ability := range filtered {
			if ability.ChannelId != channelID {
				continue
			}
			if ability.Priority != nil && *ability.Priority > priority {
				priority = *ability.Priority
			}
			if int(ability.Weight) > weight {
				weight = int(ability.Weight)
			}
		}
		candidate := hubTierChannelCandidate{
			ChannelID: channelID,
			Priority:  priority,
			Weight:    weight,
			Provider:  providerID,
		}
		candidates = append(candidates, decorateHubTierCandidateWithRuntimeHealth(candidate, modelName, requestPath))
	}
	selectedID := selectHubTierChannel(candidates, excludedChannelIDs)
	if selectedID == 0 {
		return nil, HubSupplyPricingSnapshot{}, nil
	}
	channel := channelByID[selectedID]
	return channel, CaptureHubSupplyPricingSnapshot(selectedID), nil
}

// IsChannelEnabledForHubTokenPolicy is used by affinity and fixed-channel
// paths so they cannot bypass a token's model-family or multiplier boundary.
func IsChannelEnabledForHubTokenPolicy(policy *HubTokenRoutingPolicy, modelName string, channelID int) bool {
	return isChannelEnabledForHubTokenPolicy(policy, modelName, "", CaptureHubSupplyPricingSnapshot(channelID), false)
}

// IsChannelEnabledForHubTokenPolicyFallback validates a channel that already
// served an origin task. Provider-scoped tokens may continue on a platform
// fallback channel, but the model family, multiplier and endpoint stay fixed.
func IsChannelEnabledForHubTokenPolicyFallback(policy *HubTokenRoutingPolicy, modelName, requestPath string, channelID int) bool {
	return isChannelEnabledForHubTokenPolicy(policy, modelName, requestPath, CaptureHubSupplyPricingSnapshot(channelID), true)
}

// IsChannelEnabledForHubTokenPolicySnapshot validates an affinity channel
// against the same pricing generation captured with the Channel itself.
func IsChannelEnabledForHubTokenPolicySnapshot(policy *HubTokenRoutingPolicy, modelName, requestPath string, snapshot HubSupplyPricingSnapshot, allowProviderFallback bool) bool {
	return isChannelEnabledForHubTokenPolicy(policy, modelName, requestPath, snapshot, allowProviderFallback)
}

func isChannelEnabledForHubTokenPolicy(policy *HubTokenRoutingPolicy, modelName, requestPath string, snapshot HubSupplyPricingSnapshot, allowProviderFallback bool) bool {
	channelID := snapshot.ChannelID
	if policy == nil || channelID <= 0 || !policy.AllowsModel(modelName) {
		return false
	}
	multiplier := 1.0
	if snapshot.Found {
		pricing := snapshot.Pricing
		if pricing.SupplyProviderStatus != HubProviderStatusActive || pricing.PriceMultiplier <= 0 {
			return false
		}
		if policy.Mode == HubTokenRoutingModeProvider && !allowProviderFallback && pricing.SupplyProviderId != policy.ProviderID {
			return false
		}
		multiplier = pricing.PriceMultiplier
	} else if snapshot.Configured || (policy.Mode == HubTokenRoutingModeProvider && !allowProviderFallback) {
		return false
	}
	if !policy.AllowsMultiplier(ClassifyHubPublicModelFamily(modelName), multiplier) {
		return false
	}
	if requestPath != "" && !IsHubSupplyChannelRoutableForRequest(channelID, modelName, requestPath) {
		return false
	}

	modelNames := []string{modelName}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	if normalized != "" && normalized != modelName {
		modelNames = append(modelNames, normalized)
	}
	if common.MemoryCacheEnabled {
		channelSyncLock.RLock()
		defer channelSyncLock.RUnlock()
		for group, models := range group2model2channels {
			if !isHubTokenRoutingCandidateAbilityGroup(group) {
				continue
			}
			for _, candidateModel := range modelNames {
				for _, candidateChannelID := range models[candidateModel] {
					if candidateChannelID == channelID {
						return true
					}
				}
			}
		}
		return false
	}

	var abilities []Ability
	if err := DB.Where("channel_id = ? AND model IN ? AND enabled = ?", channelID, modelNames, true).Find(&abilities).Error; err != nil {
		return false
	}
	for _, ability := range abilities {
		if isHubTokenRoutingCandidateAbilityGroup(ability.Group) {
			return true
		}
	}
	return false
}

func isHubTokenRoutingCandidateAbilityGroup(group string) bool {
	return IsHubTokenRoutingAbilityGroup(group) || group == "default" || hub_routing_setting.IsServiceTier(group)
}
