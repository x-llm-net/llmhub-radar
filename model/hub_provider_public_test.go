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
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHubProviderSlugValidationAndUniqueness(t *testing.T) {
	truncateTables(t)

	tests := []struct {
		value string
		valid bool
	}{
		{value: "llm-routers", valid: true},
		{value: "LLM-ROUTERS", valid: true},
		{value: "api", valid: false},
		{value: "-routers", valid: false},
		{value: "路由", valid: false},
	}
	for _, test := range tests {
		_, err := NormalizeHubProviderSlug(test.value)
		assert.Equal(t, test.valid, err == nil, test.value)
	}

	primary := &HubProvider{OwnerUserId: 1001, Name: "LLM Routers", Slug: "llm-routers"}
	require.NoError(t, CreateHubProvider(primary))
	assert.Equal(t, "llm-routers", primary.Slug)

	duplicate := &HubProvider{OwnerUserId: 1002, Name: "Another", Slug: "llm-routers"}
	assert.True(t, errors.Is(CreateHubProvider(duplicate), ErrHubProviderSlugAlreadyExists))
}

func TestHubProviderPublicProfileAggregatesCurrentPublishedSupply(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{OwnerUserId: 51, Name: "Acme AI", Description: "Reliable supply"}
	require.NoError(t, CreateHubProvider(provider))

	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 0.8,
		PublishedModels: "gpt-fast,gpt-slow", TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "Acme primary",
		BaseURL: &baseURL, Models: "gpt-fast,gpt-slow", Group: "default",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	require.NoError(t, DB.Model(&Channel{Id: channel.Id}).Update("status", common.ChannelStatusEnabled).Error)

	var targets []HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ? AND config_version = ?", group.Id, group.ConfigVersion).Find(&targets).Error)
	require.Len(t, targets, 2)
	now := int64(1_800_000_000)
	for _, target := range targets {
		status := HubSupplyProbeStatusError
		if target.ModelName == "gpt-fast" {
			status = HubSupplyProbeStatusAvailable
		}
		require.NoError(t, DB.Model(&HubSupplyGroupProbeTarget{Id: target.Id}).Updates(map[string]any{
			"status": status, "last_probe_at": now - 60,
		}).Error)
	}

	samples := []HubSupplyGroupProbeSample{
		{GroupId: group.Id, ConfigVersion: group.ConfigVersion, ModelName: "gpt-fast", Success: true, LatencyMs: 900, ProbedAt: now - 600},
		{GroupId: group.Id, ConfigVersion: group.ConfigVersion, ModelName: "gpt-fast", Success: false, LatencyMs: 3000, ProbedAt: now - 300},
		{GroupId: group.Id, ConfigVersion: group.ConfigVersion, ModelName: "gpt-slow", Success: false, LatencyMs: 5000, ProbedAt: now - 120},
		{GroupId: group.Id, ConfigVersion: group.ConfigVersion - 1, ModelName: "gpt-fast", Success: true, LatencyMs: 1, ProbedAt: now - 100},
	}
	require.NoError(t, DB.Create(&samples).Error)

	profile, err := GetHubProviderPublicProfile(provider.Slug, now)
	require.NoError(t, err)
	require.NotNil(t, profile)
	require.Len(t, profile.Models, 2)
	assert.Equal(t, "gpt-fast", profile.Models[0].ModelName)
	assert.Equal(t, "openai", profile.Models[0].FamilyKey)
	assert.True(t, profile.Models[0].Online)
	assert.Equal(t, 2, profile.Models[0].SampleCount)
	assert.InDelta(t, 50, profile.Models[0].Stability7d, 0.001)
	assert.Equal(t, int64(900), profile.Models[0].AverageLatencyMs)
	assert.Equal(t, "gpt-slow", profile.Models[1].ModelName)
	assert.Equal(t, "openai", profile.Models[1].FamilyKey)
	assert.False(t, profile.Models[1].Online)
	assert.Equal(t, 3, profile.Stats.SampleCount)
	assert.InDelta(t, 100.0/3.0, profile.Stats.Stability7d, 0.001)
	assert.Equal(t, 1, profile.Stats.OnlineModelCount)
	assert.Len(t, profile.Models[0].Timeline, hubProviderPublicBucketCount)
}

func TestHubPublicModelsUseStableFamilyOrdering(t *testing.T) {
	models := []HubProviderPublicModel{
		{ModelName: "gpt-5.6-luna", FamilyKey: "openai", Online: true, Stability7d: 99},
		{ModelName: "claude-haiku-4-5", FamilyKey: "anthropic", Online: false, Stability7d: 100},
		{ModelName: "gpt-image-1", FamilyKey: "openai", Online: true, Stability7d: 100},
		{ModelName: "claude-opus-4-6", FamilyKey: "anthropic", Online: true, Stability7d: 20},
		{ModelName: "claude-sonnet-4-6", FamilyKey: "anthropic", Online: true, Stability7d: 100},
	}

	sortHubPublicModels(models)

	assert.Equal(t, []string{
		"claude-opus-4-6",
		"claude-sonnet-4-6",
		"claude-haiku-4-5",
		"gpt-5.6-luna",
		"gpt-image-1",
	}, []string{
		models[0].ModelName,
		models[1].ModelName,
		models[2].ModelName,
		models[3].ModelName,
		models[4].ModelName,
	})
}

func TestHubProviderPublicProfileHidesDisabledProvider(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{OwnerUserId: 52, Name: "Paused AI"}
	require.NoError(t, CreateHubProvider(provider))
	require.NoError(t, DB.Model(&HubProvider{Id: provider.Id}).Update("status", HubProviderStatusDisabled).Error)

	profile, err := GetHubProviderPublicProfile(provider.Slug, common.GetTimestamp())
	require.NoError(t, err)
	assert.Nil(t, profile)
}
