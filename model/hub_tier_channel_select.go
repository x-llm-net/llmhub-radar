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

// hubTierCandidateBuckets is published with the channel cache. It keeps the
// provider-first routing shape without rebuilding provider buckets on every
// service-tier request.
type hubTierCandidateBuckets struct {
	providerIDs        []int
	candidatesBySource map[int][]hubTierChannelCandidate
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

// selectHubTierChannelFromBuckets keeps the existing provider-first choice,
// while applying request-specific endpoint, provider-status, and exclusion
// checks only to the prebuilt provider buckets.
func selectHubTierChannelFromBuckets(
	buckets *hubTierCandidateBuckets,
	excludedChannelIDs map[int]struct{},
	providerFilter ChannelProviderFilter,
	isEligible func(hubTierChannelCandidate) bool,
) int {
	if buckets == nil {
		return 0
	}

	providerIDs := make([]int, 0, len(buckets.providerIDs))
	for _, providerID := range buckets.providerIDs {
		if !hubTierBucketProviderMatchesFilter(providerID, providerFilter) {
			continue
		}
		for _, candidate := range buckets.candidatesBySource[providerID] {
			if _, excluded := excludedChannelIDs[candidate.ChannelID]; excluded {
				continue
			}
			if isEligible == nil || isEligible(candidate) {
				providerIDs = append(providerIDs, providerID)
				break
			}
		}
	}
	if len(providerIDs) == 0 {
		return 0
	}

	providerID := providerIDs[common.GetRandomInt(len(providerIDs))]
	candidates := make([]hubTierChannelCandidate, 0, len(buckets.candidatesBySource[providerID]))
	for _, candidate := range buckets.candidatesBySource[providerID] {
		if _, excluded := excludedChannelIDs[candidate.ChannelID]; excluded {
			continue
		}
		if isEligible == nil || isEligible(candidate) {
			candidates = append(candidates, candidate)
		}
	}
	return selectHubTierProviderChannel(candidates)
}

func hubTierBucketProviderMatchesFilter(providerID int, filter ChannelProviderFilter) bool {
	if filter.Mode == ChannelProviderAny || filter.ProviderID <= 0 {
		return true
	}
	switch filter.Mode {
	case ChannelProviderOnly:
		return providerID == filter.ProviderID
	case ChannelProviderExclude:
		return providerID != filter.ProviderID
	default:
		return true
	}
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
