package model

import (
	"math/rand"
	"sort"

	"github.com/QuantumNous/new-api/common"
)

type hubTierChannelCandidate struct {
	ChannelID int
	Priority  int64
	Weight    int
	Provider  int
}

// selectHubTierChannel first chooses an owner, then chooses a Channel within
// that owner. Platform Channels share provider key 0. This prevents a provider
// from gaining traffic merely by splitting one upstream into more Channels.
func selectHubTierChannel(candidates []hubTierChannelCandidate, excludedChannelIDs map[int]struct{}) int {
	providers := make(map[int][]hubTierChannelCandidate)
	for _, candidate := range candidates {
		if _, excluded := excludedChannelIDs[candidate.ChannelID]; excluded {
			continue
		}
		providers[candidate.Provider] = append(providers[candidate.Provider], candidate)
	}
	if len(providers) == 0 {
		return 0
	}
	providerIDs := make([]int, 0, len(providers))
	for providerID := range providers {
		providerIDs = append(providerIDs, providerID)
	}
	sort.Ints(providerIDs)
	providerID := providerIDs[common.GetRandomInt(len(providerIDs))]
	return selectHubTierProviderChannel(providers[providerID])
}

func selectHubTierProviderChannel(candidates []hubTierChannelCandidate) int {
	if len(candidates) == 0 {
		return 0
	}
	highestPriority := candidates[0].Priority
	for _, candidate := range candidates[1:] {
		if candidate.Priority > highestPriority {
			highestPriority = candidate.Priority
		}
	}
	targets := make([]hubTierChannelCandidate, 0, len(candidates))
	sumWeight := 0
	for _, candidate := range candidates {
		if candidate.Priority != highestPriority {
			continue
		}
		targets = append(targets, candidate)
		sumWeight += candidate.Weight
	}
	if len(targets) == 1 {
		return targets[0].ChannelID
	}
	smoothingFactor := 1
	smoothingAdjustment := 0
	if sumWeight == 0 {
		sumWeight = len(targets) * 100
		smoothingAdjustment = 100
	} else if sumWeight/len(targets) < 10 {
		smoothingFactor = 100
	}
	randomWeight := rand.Intn(sumWeight * smoothingFactor)
	for _, candidate := range targets {
		randomWeight -= candidate.Weight*smoothingFactor + smoothingAdjustment
		if randomWeight < 0 {
			return candidate.ChannelID
		}
	}
	return targets[len(targets)-1].ChannelID
}

func hubTierProviderForChannel(channelID int, filter ChannelProviderFilter) (int, bool) {
	pricing, supplyChannel := GetHubSupplyPricingByChannelID(channelID)
	if supplyChannel && pricing.SupplyProviderStatus != HubProviderStatusActive {
		return 0, false
	}
	if !ChannelMatchesProviderFilter(channelID, filter) {
		return 0, false
	}
	if supplyChannel {
		return pricing.SupplyProviderId, true
	}
	return 0, true
}
