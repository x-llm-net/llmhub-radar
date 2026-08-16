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
				candidates = append(candidates, hubTierChannelCandidate{
					ChannelID: channelID,
					Priority:  channel.GetPriority(),
					Weight:    channel.GetWeight(),
					Provider:  providerID,
				})
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
		candidates = append(candidates, hubTierChannelCandidate{
			ChannelID: channelID,
			Priority:  priority,
			Weight:    weight,
			Provider:  providerID,
		})
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
	return isChannelEnabledForHubTokenPolicy(policy, modelName, "", channelID, false)
}

// IsChannelEnabledForHubTokenPolicyFallback validates a channel that already
// served an origin task. Provider-scoped tokens may continue on a platform
// fallback channel, but the model family, multiplier and endpoint stay fixed.
func IsChannelEnabledForHubTokenPolicyFallback(policy *HubTokenRoutingPolicy, modelName, requestPath string, channelID int) bool {
	return isChannelEnabledForHubTokenPolicy(policy, modelName, requestPath, channelID, true)
}

func isChannelEnabledForHubTokenPolicy(policy *HubTokenRoutingPolicy, modelName, requestPath string, channelID int, allowProviderFallback bool) bool {
	if policy == nil || channelID <= 0 || !policy.AllowsModel(modelName) {
		return false
	}
	multiplier := 1.0
	if pricing, isSupply := GetHubSupplyPricingByChannelID(channelID); isSupply {
		if pricing.SupplyProviderStatus != HubProviderStatusActive || pricing.PriceMultiplier <= 0 {
			return false
		}
		if policy.Mode == HubTokenRoutingModeProvider && !allowProviderFallback && pricing.SupplyProviderId != policy.ProviderID {
			return false
		}
		multiplier = pricing.PriceMultiplier
	} else if policy.Mode == HubTokenRoutingModeProvider && !allowProviderFallback {
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
