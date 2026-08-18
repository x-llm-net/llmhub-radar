package model

import (
	"math/rand"
	"sort"

	"github.com/QuantumNous/new-api/common"
)

type hubTierChannelCandidate struct {
	ChannelID             int
	Priority              int64
	Weight                int
	Provider              int
	AvailabilityFactorBps int
	LatencyFactorBps      int
	HardUnavailable       bool
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
		if candidate.HardUnavailable {
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
	decorate func(hubTierChannelCandidate) hubTierChannelCandidate,
) int {
	if buckets == nil {
		return 0
	}

	providerIDs := make([]int, 0, len(buckets.providerIDs))
	eligibleByProvider := make(map[int][]hubTierChannelCandidate, len(buckets.providerIDs))
	for _, providerID := range buckets.providerIDs {
		if !hubTierBucketProviderMatchesFilter(providerID, providerFilter) {
			continue
		}
		for _, candidate := range buckets.candidatesBySource[providerID] {
			if _, excluded := excludedChannelIDs[candidate.ChannelID]; excluded {
				continue
			}
			if isEligible != nil && !isEligible(candidate) {
				continue
			}
			if decorate != nil {
				candidate = decorate(candidate)
			}
			if candidate.HardUnavailable {
				continue
			}
			eligibleByProvider[providerID] = append(eligibleByProvider[providerID], candidate)
		}
		if len(eligibleByProvider[providerID]) > 0 {
			providerIDs = append(providerIDs, providerID)
		}
	}
	if len(providerIDs) == 0 {
		return 0
	}

	providerID := providerIDs[common.GetRandomInt(len(providerIDs))]
	return selectHubTierProviderChannel(eligibleByProvider[providerID])
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
	highestPriority := int64(0)
	foundPriority := false
	for _, candidate := range candidates {
		if candidate.HardUnavailable {
			continue
		}
		if !foundPriority || candidate.Priority > highestPriority {
			highestPriority = candidate.Priority
			foundPriority = true
		}
	}
	if !foundPriority {
		return 0
	}
	targets := make([]hubTierChannelCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.HardUnavailable || candidate.Priority != highestPriority {
			continue
		}
		targets = append(targets, candidate)
	}
	if len(targets) == 0 {
		return 0
	}
	if len(targets) == 1 {
		return targets[0].ChannelID
	}
	allStaticWeightsZero := true
	for _, candidate := range targets {
		if candidate.Weight > 0 {
			allStaticWeightsZero = false
			break
		}
	}
	sumWeight := 0
	for index := range targets {
		baseWeight := targets[index].Weight
		if allStaticWeightsZero {
			baseWeight = 100
		}
		availability := targets[index].AvailabilityFactorBps
		if availability <= 0 {
			availability = HubRoutingFactorNeutralBps
		}
		latency := targets[index].LatencyFactorBps
		if latency <= 0 {
			latency = HubRoutingFactorNeutralBps
		}
		effectiveWeight := CalculateHubRoutingEffectiveWeight(baseWeight, availability, latency)
		targets[index].Weight = effectiveWeight
		sumWeight += effectiveWeight
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

func decorateHubTierCandidateWithRuntimeHealth(candidate hubTierChannelCandidate, modelName, requestPath string) hubTierChannelCandidate {
	decision := GetHubRoutingDecision(candidate.ChannelID, modelName, requestPath)
	candidate.AvailabilityFactorBps = decision.AvailabilityFactorBps
	candidate.LatencyFactorBps = decision.LatencyFactorBps
	candidate.HardUnavailable = decision.HardUnavailable
	return candidate
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
