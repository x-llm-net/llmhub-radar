package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHubTierPrerequisites(t *testing.T) {
	_, _, priced := ratio_setting.GetModelRatioOrPrice("gpt-5")
	require.True(t, priced)
	tiers := hub_routing_setting.ResolveEligibleServiceTiers("openai", 0.15, 2)
	assert.Equal(t, []string{hub_routing_setting.ServiceTierLow}, tiers)
}

func TestBuildChannelAbilitiesCreatesPriceAndHighQualityRows(t *testing.T) {
	original := *hub_routing_setting.Get()
	t.Cleanup(func() { require.NoError(t, hub_routing_setting.Publish(original)) })
	routingSetting := original
	routingSetting.Enabled = true
	routingSetting.HighQualityProviderIDs = []int{1}
	require.NoError(t, hub_routing_setting.Publish(routingSetting))

	channel := &Channel{
		Id:     91001,
		Status: common.ChannelStatusEnabled,
		Models: "gpt-5",
		Group:  "default",
	}
	group := HubSupplyGroup{
		ProviderId:      1,
		NewAPIChannelId: channel.Id,
		PriceMultiplier: 0.08,
		PublishedModels: channel.Models,
		ConfigVersion:   1,
	}
	require.NoError(t, DB.Create(&group).Error)
	require.NoError(t, DB.Create(&HubSupplyGroupProbeTarget{
		GroupId:       group.Id,
		ConfigVersion: group.ConfigVersion,
		ModelName:     "gpt-5",
		EndpointType:  "openai",
		ProbeKind:     "text",
		Status:        HubSupplyProbeStatusAvailable,
	}).Error)
	t.Cleanup(func() {
		DB.Where("group_id = ?", group.Id).Delete(&HubSupplyGroupProbeTarget{})
		DB.Delete(&HubSupplyGroup{}, group.Id)
	})

	abilities, err := buildChannelAbilities(nil, channel)
	require.NoError(t, err)
	require.Len(t, abilities, 3)
	assert.Equal(t, HubTokenRoutingAbilityGroup, abilities[0].Group)
	assert.Equal(t, hub_routing_setting.ServiceTierSpecial, abilities[1].Group)
	assert.Equal(t, hub_routing_setting.ServiceTierHigh, abilities[2].Group)
	assert.Equal(t, "gpt-5", abilities[0].Model)
	assert.Equal(t, channel.Id, abilities[2].ChannelId)
}

func TestSelectHubTierChannelStrictlyExcludesFailedChannels(t *testing.T) {
	candidates := []hubTierChannelCandidate{
		{ChannelID: 11, Provider: 1, Priority: 10, Weight: 100},
		{ChannelID: 12, Provider: 1, Priority: 0, Weight: 100},
	}
	assert.Equal(t, 12, selectHubTierChannel(candidates, map[int]struct{}{11: {}}))
	assert.Zero(t, selectHubTierChannel(candidates, map[int]struct{}{11: {}, 12: {}}))
}

func TestSelectHubTierProviderChannelUsesHighestRemainingPriority(t *testing.T) {
	candidates := []hubTierChannelCandidate{
		{ChannelID: 21, Provider: 2, Priority: 0, Weight: 100},
		{ChannelID: 22, Provider: 2, Priority: 10, Weight: 0},
	}
	assert.Equal(t, 22, selectHubTierProviderChannel(candidates))
}

func TestBuildHubTierCandidateBucketsPreservesProviderFirstSelection(t *testing.T) {
	priorityHigh := int64(10)
	priorityLow := int64(0)
	special := hub_routing_setting.ServiceTierSpecial
	buckets := buildHubTierCandidateBuckets(
		map[string]map[string][]int{
			special: {
				"gpt-cache-test": {101, 102, 201, 301},
			},
		},
		map[int]*Channel{
			101: {Id: 101, Priority: &priorityHigh},
			102: {Id: 102, Priority: &priorityLow},
			201: {Id: 201, Priority: &priorityLow},
			301: {Id: 301, Priority: &priorityLow},
		},
		map[int]HubSupplyPricing{
			101: {SupplyProviderId: 10},
			102: {SupplyProviderId: 10},
			201: {SupplyProviderId: 20},
		},
	)

	bucket := buckets[special]["gpt-cache-test"]
	require.NotNil(t, bucket)
	assert.Equal(t, []int{0, 10, 20}, bucket.providerIDs)
	assert.Len(t, bucket.candidatesBySource[10], 2)
	assert.Len(t, bucket.candidatesBySource[20], 1)
	assert.Len(t, bucket.candidatesBySource[0], 1)

	providerOnly := ChannelProviderFilter{ProviderID: 10, Mode: ChannelProviderOnly}
	assert.Equal(t, 101, selectHubTierChannelFromBuckets(bucket, nil, providerOnly, nil, nil))
	assert.Equal(t, 102, selectHubTierChannelFromBuckets(bucket, map[int]struct{}{101: {}}, providerOnly, nil, nil))

	providerUnavailable := ChannelProviderFilter{ProviderID: 20, Mode: ChannelProviderOnly}
	assert.Zero(t, selectHubTierChannelFromBuckets(bucket, nil, providerUnavailable, func(candidate hubTierChannelCandidate) bool {
		return candidate.ChannelID != 201
	}, nil))
}

func TestSelectHubTierChannelFromBucketsDecoratesEachCandidateOnce(t *testing.T) {
	bucket := &hubTierCandidateBuckets{
		providerIDs: []int{10, 20},
		candidatesBySource: map[int][]hubTierChannelCandidate{
			10: {{ChannelID: 101, Provider: 10, Weight: 100}},
			20: {{ChannelID: 201, Provider: 20, Weight: 100}},
		},
	}
	calls := make(map[int]int)
	selected := selectHubTierChannelFromBuckets(
		bucket,
		nil,
		ChannelProviderFilter{Mode: ChannelProviderAny},
		nil,
		func(candidate hubTierChannelCandidate) hubTierChannelCandidate {
			calls[candidate.ChannelID]++
			return candidate
		},
	)

	assert.Contains(t, []int{101, 201}, selected)
	assert.Equal(t, map[int]int{101: 1, 201: 1}, calls)
}

func TestHubTierQualityBandRunsBeforePriorityAndFallsBackAfterExclusion(t *testing.T) {
	candidates := []hubTierChannelCandidate{
		qualityCandidate(101, 10, 0, 9_950, 1_000),
		qualityCandidate(201, 20, 100, 9_950, 1_301),
	}

	assert.Equal(t, 101, selectHubTierChannel(candidates, nil))
	assert.Equal(t, 201, selectHubTierChannel(candidates, map[int]struct{}{101: {}}))
}

func TestHubTierQualityBandAppliesSuccessBoundary(t *testing.T) {
	candidates := []hubTierChannelCandidate{
		qualityCandidate(101, 10, 0, 9_900, 1_000),
		qualityCandidate(201, 20, 0, 9_800, 1_000),
		qualityCandidate(301, 30, 0, 9_799, 1_000),
	}

	filtered := filterHubTierCandidatesByQualityBand(candidates)
	assert.ElementsMatch(t, []int{101, 201}, hubTierCandidateIDs(filtered))
}

func TestHubTierQualityBandAppliesRelativeAndAbsoluteTTFTBoundary(t *testing.T) {
	candidates := []hubTierChannelCandidate{
		qualityCandidate(101, 10, 0, 9_900, 2_000),
		qualityCandidate(201, 20, 0, 9_900, 2_400),
		qualityCandidate(301, 30, 0, 9_900, 2_401),
	}

	filtered := filterHubTierCandidatesByQualityBand(candidates)
	assert.ElementsMatch(t, []int{101, 201}, hubTierCandidateIDs(filtered))
}

func TestHubTierQualityBandKeepsColdCandidatesOnlyWithoutMatureCandidates(t *testing.T) {
	cold := qualityCandidate(101, 10, 0, 10_000, 500)
	cold.RealSampleCount = hubRoutingQualityMinRealSamples - 1
	cold.RealFirstTokenSamples = hubRoutingQualityMinRealSamples - 1
	mature := qualityCandidate(201, 20, 0, 9_900, 1_000)

	assert.Equal(t, []int{101}, hubTierCandidateIDs(filterHubTierCandidatesByQualityBand([]hubTierChannelCandidate{cold})))
	assert.Equal(t, []int{201}, hubTierCandidateIDs(filterHubTierCandidatesByQualityBand([]hubTierChannelCandidate{cold, mature})))
}

func TestHubTierQualityBandDoesNotLetUnhealthyMatureCandidateSuppressColdCandidate(t *testing.T) {
	cold := qualityCandidate(101, 10, 0, 10_000, 500)
	cold.RealSampleCount = hubRoutingQualityMinRealSamples - 1
	cold.RealFirstTokenSamples = hubRoutingQualityMinRealSamples - 1
	unhealthy := qualityCandidate(201, 20, 0, 0, 1_000)

	filtered := filterHubTierCandidatesByQualityBand([]hubTierChannelCandidate{cold, unhealthy})
	assert.ElementsMatch(t, []int{101, 201}, hubTierCandidateIDs(filtered))
}

func TestHubTierQualityBandUsesStabilityOnlyWithoutComparableTTFT(t *testing.T) {
	stable := qualityCandidate(101, 10, 0, 9_900, 1_000)
	stable.RealFirstTokenSamples = 0
	stable.HasRealFirstTokenP95 = false
	boundary := qualityCandidate(201, 20, 0, 9_800, 5_000)
	boundary.RealFirstTokenSamples = 0
	boundary.HasRealFirstTokenP95 = false
	unstable := qualityCandidate(301, 30, 0, 9_799, 500)
	unstable.RealFirstTokenSamples = 0
	unstable.HasRealFirstTokenP95 = false

	filtered := filterHubTierCandidatesByQualityBand([]hubTierChannelCandidate{stable, boundary, unstable})
	assert.ElementsMatch(t, []int{101, 201}, hubTierCandidateIDs(filtered))
}

func TestHubTierQualityBandPreservesProviderNormalization(t *testing.T) {
	candidates := make([]hubTierChannelCandidate, 0, 11)
	for channelID := 1; channelID <= 10; channelID++ {
		candidates = append(candidates, qualityCandidate(channelID, 10, 0, 9_900, 1_000))
	}
	candidates = append(candidates, qualityCandidate(101, 20, 0, 9_900, 1_000))

	provider10Selections := 0
	const iterations = 10_000
	for iteration := 0; iteration < iterations; iteration++ {
		if selectHubTierChannel(candidates, nil) <= 10 {
			provider10Selections++
		}
	}
	assert.InDelta(t, iterations/2, provider10Selections, iterations*0.04)
}

func qualityCandidate(channelID, providerID int, priority int64, successRateBps int, ttftP95Ms int64) hubTierChannelCandidate {
	return hubTierChannelCandidate{
		ChannelID:             channelID,
		Provider:              providerID,
		Priority:              priority,
		Weight:                100,
		RealSampleCount:       hubRoutingQualityMinRealSamples,
		RealSuccessRateBps:    successRateBps,
		RealFirstTokenSamples: hubRoutingQualityMinRealSamples,
		RealFirstTokenP95Ms:   ttftP95Ms,
		HasRealFirstTokenP95:  true,
	}
}

func hubTierCandidateIDs(candidates []hubTierChannelCandidate) []int {
	ids := make([]int, 0, len(candidates))
	for _, candidate := range candidates {
		ids = append(ids, candidate.ChannelID)
	}
	return ids
}
