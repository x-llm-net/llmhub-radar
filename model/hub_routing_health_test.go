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
