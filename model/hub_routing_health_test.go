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
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListHubRoutingHealthIncludesUnavailableRowsAndReusesRankingRules(t *testing.T) {
	truncateTables(t)
	now := int64(1_800_000_000)

	provider := &HubProvider{OwnerUserId: 501, Name: "Health Relay", Slug: "health-relay"}
	require.NoError(t, CreateHubProvider(provider))
	baseURL := "https://health.example"
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "Provider supply",
		BaseURL: &baseURL, Models: "gpt-health,gpt-hidden", Group: "default", Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, DB.Create(channel).Error)
	group := &HubSupplyGroup{
		ProviderId: provider.Id, NewAPIChannelId: channel.Id, PriceMultiplier: 0.08,
		PublishedModels: "gpt-health", ConfigVersion: 1, TextProbeMinutes: 10,
		ImageProbeMinutes: 30, Status: HubSupplyGroupStatusPartial,
	}
	require.NoError(t, DB.Create(group).Error)
	target := &HubSupplyGroupProbeTarget{
		GroupId: group.Id, ConfigVersion: group.ConfigVersion, ModelName: "gpt-health",
		EndpointType: string(constant.EndpointTypeOpenAI), EndpointMode: HubSupplyProbeEndpointModeAuto,
		ResolvedEndpointType: string(constant.EndpointTypeOpenAIResponse),
		ProbeKind:            HubSupplyProbeKindText, Status: HubSupplyProbeStatusAvailable,
		LastProbeAt: now - 5, LastSuccessAt: now - 5, LastLatencyMs: 900,
		CreatedAt: now - 1, UpdatedAt: now - 1,
	}
	require.NoError(t, DB.Create(target).Error)
	priority := int64(0)
	require.NoError(t, DB.Create(&Ability{
		Group: hub_routing_setting.ServiceTierSpecial, Model: "gpt-health", ChannelId: channel.Id,
		Enabled: true, Priority: &priority, Weight: 10,
	}).Error)

	ttft100, ttft200, ttft300 := int64(100), int64(200), int64(300)
	samples := []HubSupplyGroupProbeSample{
		{GroupId: group.Id, ConfigVersion: 1, ModelName: "gpt-health", EndpointType: string(constant.EndpointTypeOpenAIResponse), ProbeKind: HubSupplyProbeKindText, Success: true, LatencyMs: 500, FirstTokenMs: &ttft100, ProbedAt: now - 4},
		{GroupId: group.Id, ConfigVersion: 1, ModelName: "gpt-health", EndpointType: string(constant.EndpointTypeOpenAIResponse), ProbeKind: HubSupplyProbeKindText, Success: true, LatencyMs: 700, FirstTokenMs: &ttft200, ProbedAt: now - 3},
		{GroupId: group.Id, ConfigVersion: 1, ModelName: "gpt-health", EndpointType: string(constant.EndpointTypeOpenAIResponse), ProbeKind: HubSupplyProbeKindText, Success: true, LatencyMs: 900, FirstTokenMs: &ttft300, ProbedAt: now - 2},
		{GroupId: group.Id, ConfigVersion: 1, ModelName: "gpt-health", EndpointType: string(constant.EndpointTypeOpenAI), ProbeKind: HubSupplyProbeKindText, Success: false, LatencyMs: 1200, ErrorCode: "upstream_error", ProbedAt: now - 1},
		{GroupId: group.Id, ConfigVersion: 1, ModelName: "gpt-health", EndpointType: string(constant.EndpointTypeOpenAI), ProbeKind: HubSupplyProbeKindText, Success: false, ErrorCode: "insufficient_quota", ProbedAt: now - 1},
		{GroupId: group.Id, ConfigVersion: 1, ModelName: "gpt-health", EndpointType: string(constant.EndpointTypeOpenAI), ProbeKind: HubSupplyProbeKindText, Success: false, ErrorCode: "model_price_error", ProbedAt: now - 1},
	}
	require.NoError(t, DB.Create(&samples).Error)

	platformChannel := &Channel{
		Type: constant.ChannelTypeAnthropic, Key: "platform-secret", Name: "Platform fallback",
		Models: "claude-platform", Group: "default", Status: common.ChannelStatusManuallyDisabled,
	}
	platformChannel.SetOtherInfo(map[string]interface{}{"status_reason": "manual maintenance"})
	require.NoError(t, DB.Create(platformChannel).Error)

	rows, total, err := ListHubRoutingHealth(HubRoutingHealthListOptions{Limit: 20}, now)
	require.NoError(t, err)
	assert.Equal(t, 3, total)
	require.Len(t, rows, 3)

	health := findHubRoutingHealthRow(t, rows, channel.Id, "gpt-health")
	assert.Equal(t, provider.Id, health.ProviderID)
	assert.Equal(t, string(constant.EndpointTypeOpenAIResponse), health.ResolvedEndpointType)
	assert.Contains(t, health.EligibleServiceTiers, hub_routing_setting.ServiceTierSpecial)
	assert.Equal(t, []string{hub_routing_setting.ServiceTierSpecial}, health.RoutableServiceTiers)
	assert.True(t, health.RoutingRoutable)
	assert.True(t, health.ServiceTierRoutable)
	assert.Equal(t, 4, health.SampleCount7d)
	require.NotNil(t, health.SuccessRate7d)
	assert.InDelta(t, 75, *health.SuccessRate7d, 0.001)
	assert.Equal(t, int64(700), *health.LatencyP50Ms)
	assert.Equal(t, int64(900), *health.LatencyP95Ms)
	assert.Equal(t, int64(200), *health.FirstTokenP50Ms)
	assert.Equal(t, int64(300), *health.FirstTokenP95Ms)
	assert.NotNil(t, health.ConfidenceBps)
	assert.NotNil(t, health.RankingScoreBps)
	assert.True(t, health.ProbeRoutable)
	assert.Empty(t, health.SkipReasonCodes)

	hidden := findHubRoutingHealthRow(t, rows, channel.Id, "gpt-hidden")
	assert.False(t, hidden.Published)
	assert.Equal(t, HubRoutingHealthProbeStatusUnmonitored, hidden.ProbeStatus)
	assert.Contains(t, hidden.SkipReasonCodes, HubRoutingHealthReasonModelUnpublished)
	assert.Contains(t, hidden.SkipReasonCodes, HubRoutingHealthReasonProbeUnmonitored)

	platform := findHubRoutingHealthRow(t, rows, platformChannel.Id, "claude-platform")
	assert.Zero(t, platform.ProviderID)
	assert.Nil(t, platform.PriceMultiplier)
	assert.Equal(t, "manual maintenance", platform.ChannelStatusReason)
	assert.Contains(t, platform.SkipReasonCodes, HubRoutingHealthReasonChannelManualDisabled)
	assert.Contains(t, platform.SkipReasonCodes, HubRoutingHealthReasonProbeUnmonitored)

	require.NoError(t, DB.Model(&Channel{Id: channel.Id}).Update("status", common.ChannelStatusManuallyDisabled).Error)
	disabledRows, _, err := ListHubRoutingHealth(HubRoutingHealthListOptions{ProviderID: &provider.Id, Limit: 20}, now)
	require.NoError(t, err)
	disabledHealth := findHubRoutingHealthRow(t, disabledRows, channel.Id, "gpt-health")
	assert.False(t, disabledHealth.ServiceTierRoutable)
	assert.False(t, disabledHealth.RoutingRoutable)
	assert.Empty(t, disabledHealth.RoutableServiceTiers)
	assert.Contains(t, disabledHealth.SkipReasonCodes, HubRoutingHealthReasonChannelManualDisabled)
	assert.NotContains(t, disabledHealth.SkipReasonCodes, HubRoutingHealthReasonNoRoutableAbility)

	platformID := 0
	filtered, filteredTotal, err := ListHubRoutingHealth(HubRoutingHealthListOptions{
		ProviderID: &platformID, ChannelStatus: common.ChannelStatusManuallyDisabled, Limit: 20,
	}, now)
	require.NoError(t, err)
	assert.Equal(t, 1, filteredTotal)
	require.Len(t, filtered, 1)
	assert.Equal(t, platformChannel.Id, filtered[0].ChannelID)
}

func TestListHubRoutingHealthShowsAutoProbeDisabledModelAsRoutable(t *testing.T) {
	truncateTables(t)
	resetHubRoutingSnapshotsForTest(t)
	now := common.GetTimestamp()
	provider := &HubProvider{OwnerUserId: 502, Name: "Unmonitored Relay", Slug: "unmonitored-relay"}
	require.NoError(t, CreateHubProvider(provider))
	baseURL := "https://unmonitored.example"
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "Unmonitored supply",
		BaseURL: &baseURL, Models: "gpt-unmonitored", Group: "default", Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, DB.Create(channel).Error)
	group := &HubSupplyGroup{
		ProviderId: provider.Id, NewAPIChannelId: channel.Id, PriceMultiplier: 0.08,
		PublishedModels: "gpt-unmonitored", AutoProbeDisabledModels: "gpt-unmonitored",
		ConfigVersion: 1, TextProbeMinutes: 10, ImageProbeMinutes: 30, Status: HubSupplyGroupStatusAvailable,
	}
	require.NoError(t, DB.Create(group).Error)
	priority := int64(0)
	require.NoError(t, DB.Create(&Ability{
		Group: hub_routing_setting.ServiceTierSpecial, Model: "gpt-unmonitored", ChannelId: channel.Id,
		Enabled: true, Priority: &priority, Weight: 10,
	}).Error)

	rows, _, err := ListHubRoutingHealth(HubRoutingHealthListOptions{ProviderID: &provider.Id, Limit: 20}, now)
	require.NoError(t, err)
	row := findHubRoutingHealthRow(t, rows, channel.Id, "gpt-unmonitored")
	assert.Equal(t, HubSupplyProbeStatusSkipped, row.ProbeStatus)
	assert.True(t, row.ServiceTierRoutable)
	assert.NotContains(t, row.SkipReasonCodes, HubRoutingHealthReasonProbeUnmonitored)
}

func TestSortHubRoutingHealthTreatsInternalPolicyAbilityAsRoutable(t *testing.T) {
	truncateTables(t)
	resetHubRoutingSnapshotsForTest(t)
	now := common.GetTimestamp()
	priority := int64(0)
	channels := []*Channel{
		{Type: constant.ChannelTypeOpenAI, Key: "unroutable-secret", Name: "A unroutable", Models: "gpt-policy-rank", Group: "default", Status: common.ChannelStatusEnabled},
		{Type: constant.ChannelTypeOpenAI, Key: "policy-secret", Name: "Z policy routable", Models: "gpt-policy-rank", Group: "default", Status: common.ChannelStatusEnabled},
	}
	for _, channel := range channels {
		require.NoError(t, DB.Create(channel).Error)
	}
	require.NoError(t, DB.Create(&Ability{
		Group: HubTokenRoutingAbilityGroup, Model: "gpt-policy-rank", ChannelId: channels[1].Id,
		Enabled: true, Priority: &priority, Weight: 100,
	}).Error)

	rows, _, err := ListHubRoutingHealth(HubRoutingHealthListOptions{Limit: 10}, now)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	assert.Equal(t, "Z policy routable", rows[0].ChannelName)
	assert.True(t, rows[0].RoutingRoutable)
	assert.False(t, rows[0].ServiceTierRoutable)
	assert.False(t, rows[1].RoutingRoutable)
}

func TestSortHubRoutingHealthKeepsStableChannelAheadOfFasterDegradedChannel(t *testing.T) {
	fastP95, stableP95 := int64(300), int64(1_000)
	rows := []HubRoutingHealthRow{
		{
			ChannelID: 1, ChannelName: "Fast degraded", RoutingRoutable: true,
			RealHealthState: HubRoutingRealHealthDegraded, RealSampleCount: 20, RealSuccessRateBps: 9_000,
			RealFirstTokenSampleCount: 20, RealFirstTokenP95Ms: &fastP95,
		},
		{
			ChannelID: 2, ChannelName: "Stable", RoutingRoutable: true,
			RealHealthState: HubRoutingRealHealthHealthy, RealSampleCount: 20, RealSuccessRateBps: 9_900,
			RealFirstTokenSampleCount: 20, RealFirstTokenP95Ms: &stableP95,
		},
	}

	sortHubRoutingHealthRows(rows)
	assert.Equal(t, "Stable", rows[0].ChannelName)
}

func TestListHubRoutingHealthRanksCompleteResultBeforePagination(t *testing.T) {
	truncateTables(t)
	resetHubRoutingSnapshotsForTest(t)
	now := common.GetTimestamp()
	priority := int64(0)
	channels := []*Channel{
		{Type: constant.ChannelTypeOpenAI, Key: "slow-secret", Name: "A slow channel", Models: "gpt-global-rank", Group: "default", Status: common.ChannelStatusEnabled},
		{Type: constant.ChannelTypeOpenAI, Key: "fast-secret", Name: "Z fast channel", Models: "gpt-global-rank", Group: "default", Status: common.ChannelStatusEnabled},
	}
	for _, channel := range channels {
		require.NoError(t, DB.Create(channel).Error)
		require.NoError(t, DB.Create(&Ability{
			Group: hub_routing_setting.ServiceTierSpecial, Model: "gpt-global-rank", ChannelId: channel.Id,
			Enabled: true, Priority: &priority, Weight: 100,
		}).Error)
	}
	fastP50, fastP95 := int64(500), int64(1_000)
	slowP50, slowP95 := int64(1_000), int64(3_000)
	PublishHubRoutingRuntimeSignals(now, []HubRoutingRuntimeSignal{
		{
			ChannelID: channels[0].Id, ModelName: "gpt-global-rank", ProbeKind: HubSupplyProbeKindText,
			RealHealthState: HubRoutingRealHealthHealthy, RealSampleCount: 20, RealSuccessRateBps: 9_900,
			RealAvailabilityFactorBps: HubRoutingFactorNeutralBps, RealFirstTokenSampleCount: 20,
			RealFirstTokenP50Ms: &slowP50, RealFirstTokenP95Ms: &slowP95,
		},
		{
			ChannelID: channels[1].Id, ModelName: "gpt-global-rank", ProbeKind: HubSupplyProbeKindText,
			RealHealthState: HubRoutingRealHealthHealthy, RealSampleCount: 20, RealSuccessRateBps: 9_900,
			RealAvailabilityFactorBps: HubRoutingFactorNeutralBps, RealFirstTokenSampleCount: 20,
			RealFirstTokenP50Ms: &fastP50, RealFirstTokenP95Ms: &fastP95,
		},
	})

	firstPage, total, err := ListHubRoutingHealth(HubRoutingHealthListOptions{Limit: 1}, now)
	require.NoError(t, err)
	assert.Equal(t, 2, total)
	require.Len(t, firstPage, 1)
	assert.Equal(t, "Z fast channel", firstPage[0].ChannelName)
	assert.Equal(t, 1, firstPage[0].GlobalRank)

	secondPage, _, err := ListHubRoutingHealth(HubRoutingHealthListOptions{Offset: 1, Limit: 1}, now)
	require.NoError(t, err)
	require.Len(t, secondPage, 1)
	assert.Equal(t, "A slow channel", secondPage[0].ChannelName)
	assert.Equal(t, 2, secondPage[0].GlobalRank)
}

func findHubRoutingHealthRow(t *testing.T, rows []HubRoutingHealthRow, channelID int, modelName string) HubRoutingHealthRow {
	t.Helper()
	for _, row := range rows {
		if row.ChannelID == channelID && row.ModelName == modelName {
			return row
		}
	}
	require.FailNow(t, "routing health row not found", "channel=%d model=%s", channelID, modelName)
	return HubRoutingHealthRow{}
}
