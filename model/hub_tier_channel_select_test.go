package model

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHubTierPrerequisites(t *testing.T) {
	_, _, priced := ratio_setting.GetModelRatioOrPrice("gpt-5")
	require.True(t, priced)
	tier, eligible := hub_routing_setting.ResolveServiceTier("openai", 0.15, 1)
	require.True(t, eligible)
	assert.Equal(t, hub_routing_setting.ServiceTierLow, tier)
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
