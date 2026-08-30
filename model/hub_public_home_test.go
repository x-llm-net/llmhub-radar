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
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/hub_public_home_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHubPublicHomeAggregatesPublishedModelsAcrossActiveProviders(t *testing.T) {
	truncateTables(t)
	resetHubRoutingSnapshotsForTest(t)
	now := int64(1_800_000_000)

	primaryProvider := &HubProvider{OwnerUserId: 71, Name: "Alpha Relay"}
	require.NoError(t, CreateHubProvider(primaryProvider))
	secondaryProvider := &HubProvider{OwnerUserId: 72, Name: "Beta Relay"}
	require.NoError(t, CreateHubProvider(secondaryProvider))
	disabledProvider := &HubProvider{OwnerUserId: 73, Name: "Hidden Relay"}
	require.NoError(t, CreateHubProvider(disabledProvider))
	require.NoError(t, DB.Model(&HubProvider{Id: disabledProvider.Id}).Update("status", HubProviderStatusDisabled).Error)

	primaryGroup, primaryChannel := createHubPublicHomeTestSupply(
		t,
		primaryProvider.Id,
		"Alpha supply",
		"gpt-alpha,gpt-private,gpt-retired",
		"gpt-alpha,gpt-retired",
		0.82,
	)
	secondaryGroup, secondaryChannel := createHubPublicHomeTestSupply(
		t,
		secondaryProvider.Id,
		"Beta supply",
		"gpt-alpha,claude-test",
		"gpt-alpha,claude-test",
		0.91,
	)
	require.NoError(t, DB.Model(&Channel{Id: primaryChannel.Id}).Update("status", common.ChannelStatusEnabled).Error)
	require.NoError(t, DB.Model(&Channel{Id: secondaryChannel.Id}).Update("status", common.ChannelStatusEnabled).Error)

	setHubPublicHomeTargetStatus(t, primaryGroup.Id, "gpt-alpha", HubSupplyProbeStatusAvailable, now-30)
	setHubPublicHomeTargetStatus(t, primaryGroup.Id, "gpt-retired", HubSupplyProbeStatusError, now-40)
	setHubPublicHomeTargetStatus(t, secondaryGroup.Id, "gpt-alpha", HubSupplyProbeStatusError, now-45)
	setHubPublicHomeTargetStatus(t, secondaryGroup.Id, "claude-test", HubSupplyProbeStatusAvailable, now-20)

	samples := []HubSupplyGroupProbeSample{
		{GroupId: primaryGroup.Id, ConfigVersion: primaryGroup.ConfigVersion, ModelName: "gpt-alpha", Success: true, LatencyMs: 700, ProbedAt: now - 300},
		{GroupId: primaryGroup.Id, ConfigVersion: primaryGroup.ConfigVersion, ModelName: "gpt-alpha", Success: true, LatencyMs: 900, ProbedAt: now - 120},
		{GroupId: secondaryGroup.Id, ConfigVersion: secondaryGroup.ConfigVersion, ModelName: "gpt-alpha", Success: false, LatencyMs: 5000, ProbedAt: now - 90},
		{GroupId: secondaryGroup.Id, ConfigVersion: secondaryGroup.ConfigVersion, ModelName: "claude-test", Success: true, LatencyMs: 1100, ProbedAt: now - 60},
		{GroupId: primaryGroup.Id, ConfigVersion: primaryGroup.ConfigVersion, ModelName: "gpt-retired", Success: false, LatencyMs: 5000, ProbedAt: now - 50},
		{GroupId: primaryGroup.Id, ConfigVersion: primaryGroup.ConfigVersion, ModelName: "gpt-private", Success: true, LatencyMs: 1, ProbedAt: now - 10},
	}
	require.NoError(t, DB.Create(&samples).Error)

	home, err := GetHubPublicHome(now)
	require.NoError(t, err)
	require.NotNil(t, home)
	assert.Equal(t, 2, home.ProviderCount)
	assert.Equal(t, 2, home.PublishedModelCount)
	assert.Equal(t, now-20, home.LastProbeAt)
	assert.Equal(t, now, home.GeneratedAt)

	openAIFamily := findHubPublicHomeFamily(t, home, "openai")
	require.Len(t, openAIFamily.Models, 1)
	gptModel := openAIFamily.Models[0]
	assert.Equal(t, "gpt-alpha", gptModel.ModelName)
	assert.Equal(t, 2, gptModel.ProviderCount)
	assert.Equal(t, 1, gptModel.OnlineProviderCount)
	require.Len(t, gptModel.Providers, 2)
	assert.Equal(t, primaryProvider.Id, gptModel.Providers[0].Provider.Id)
	assert.True(t, gptModel.Providers[0].Online)
	assert.InDelta(t, 100, gptModel.Providers[0].Stability7d, 0.001)
	assert.Equal(t, int64(800), gptModel.Providers[0].AverageLatencyMs)
	assert.InDelta(t, 0.82, gptModel.Providers[0].MinPriceMultiplier, 0.001)
	assert.Len(t, gptModel.Providers[0].Timeline, hubProviderPublicBucketCount)
	assert.Equal(t, secondaryProvider.Id, gptModel.Providers[1].Provider.Id)
	assert.False(t, gptModel.Providers[1].Online)

	anthropicFamily := findHubPublicHomeFamily(t, home, "anthropic")
	require.Len(t, anthropicFamily.Models, 1)
	assert.Equal(t, "claude-test", anthropicFamily.Models[0].ModelName)
	assert.Equal(t, 1, anthropicFamily.Models[0].OnlineProviderCount)
	for _, family := range home.Families {
		for _, model := range family.Models {
			assert.NotEqual(t, "gpt-private", model.ModelName)
		}
	}
}

func TestHubPublicHomeIsolatedByTenant(t *testing.T) {
	truncateTables(t)
	resetHubRoutingSnapshotsForTest(t)
	require.NoError(t, DB.AutoMigrate(&Tenant{}))
	now := int64(1_800_000_000)

	tenantA := &Tenant{Name: "Tenant A", Slug: "home-tenant-a", Status: TenantStatusActive}
	tenantB := &Tenant{Name: "Tenant B", Slug: "home-tenant-b", Status: TenantStatusActive}
	require.NoError(t, DB.Create(tenantA).Error)
	require.NoError(t, DB.Create(tenantB).Error)
	t.Cleanup(func() {
		DB.Delete(&Tenant{}, []int{tenantA.Id, tenantB.Id})
	})

	providerA := &HubProvider{OwnerUserId: 901, TenantId: &tenantA.Id, Name: "Tenant A Relay"}
	providerB := &HubProvider{OwnerUserId: 902, TenantId: &tenantB.Id, Name: "Tenant B Relay"}
	require.NoError(t, CreateHubProvider(providerA))
	require.NoError(t, CreateHubProvider(providerB))
	groupA, channelA := createHubPublicHomeTestSupply(t, providerA.Id, "A supply", "gpt-a", "gpt-a", 0.8)
	groupB, channelB := createHubPublicHomeTestSupply(t, providerB.Id, "B supply", "gpt-b", "gpt-b", 0.9)
	require.NoError(t, DB.Model(&Channel{Id: channelA.Id}).Update("status", common.ChannelStatusEnabled).Error)
	require.NoError(t, DB.Model(&Channel{Id: channelB.Id}).Update("status", common.ChannelStatusEnabled).Error)
	setHubPublicHomeTargetStatus(t, groupA.Id, "gpt-a", HubSupplyProbeStatusAvailable, now-30)
	setHubPublicHomeTargetStatus(t, groupB.Id, "gpt-b", HubSupplyProbeStatusAvailable, now-20)
	require.NoError(t, DB.Create([]HubSupplyGroupProbeSample{
		{GroupId: groupA.Id, ConfigVersion: groupA.ConfigVersion, ModelName: "gpt-a", Success: true, LatencyMs: 700, ProbedAt: now - 30},
		{GroupId: groupB.Id, ConfigVersion: groupB.ConfigVersion, ModelName: "gpt-b", Success: true, LatencyMs: 700, ProbedAt: now - 20},
	}).Error)

	homeA, err := GetHubPublicHomeForTenant(now, tenantA.Id)
	require.NoError(t, err)
	assert.Equal(t, 1, homeA.ProviderCount)
	assert.Equal(t, 1, homeA.PublishedModelCount)
	assert.Equal(t, "gpt-a", homeA.Families[0].Models[0].ModelName)
	assert.Equal(t, providerA.Id, homeA.Families[0].Models[0].Providers[0].Provider.Id)

	homeB, err := GetHubPublicHomeForTenant(now, tenantB.Id)
	require.NoError(t, err)
	assert.Equal(t, 1, homeB.ProviderCount)
	assert.Equal(t, 1, homeB.PublishedModelCount)
	assert.Equal(t, "gpt-b", homeB.Families[0].Models[0].ModelName)
	assert.Equal(t, providerB.Id, homeB.Families[0].Models[0].Providers[0].Provider.Id)
}

func TestHubPublicHomeFiltersBlacklistedModelsAndHydratesUploadedLogo(t *testing.T) {
	truncateTables(t)
	resetHubRoutingSnapshotsForTest(t)
	now := int64(1_800_000_000)

	provider := &HubProvider{
		OwnerUserId: 74,
		Name:        "Public Home Provider",
		LogoURL:     "https://old.example/logo.png",
		LogoAssetId: 17,
	}
	require.NoError(t, CreateHubProvider(provider))
	group, channel := createHubPublicHomeTestSupply(
		t,
		provider.Id,
		"public-home-blacklist",
		"gpt-visible,codex-auto-review",
		"gpt-visible,codex-auto-review",
		1,
	)
	require.NoError(t, DB.Model(&Channel{Id: channel.Id}).Update("status", common.ChannelStatusEnabled).Error)
	setHubPublicHomeTargetStatus(t, group.Id, "gpt-visible", HubSupplyProbeStatusAvailable, now-20)
	setHubPublicHomeTargetStatus(t, group.Id, "codex-auto-review", HubSupplyProbeStatusAvailable, now-10)
	require.NoError(t, DB.Create(&HubSupplyGroupProbeSample{
		GroupId: group.Id, ConfigVersion: group.ConfigVersion, ModelName: "gpt-visible",
		Success: true, LatencyMs: 700, ProbedAt: now - 20,
	}).Error)

	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	previous, existed := common.OptionMap[hub_public_home_setting.OptionKeyModelBlacklist]
	common.OptionMap[hub_public_home_setting.OptionKeyModelBlacklist] = `["codex-auto-review"]`
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if existed {
			common.OptionMap[hub_public_home_setting.OptionKeyModelBlacklist] = previous
		} else {
			delete(common.OptionMap, hub_public_home_setting.OptionKeyModelBlacklist)
		}
		common.OptionMapRWMutex.Unlock()
	})

	home, err := GetHubPublicHome(now)
	require.NoError(t, err)
	assert.Equal(t, 1, home.PublishedModelCount)
	openAI := findHubPublicHomeFamily(t, home, "openai")
	require.Len(t, openAI.Models, 1)
	assert.Equal(t, "gpt-visible", openAI.Models[0].ModelName)
	require.Len(t, openAI.Models[0].Providers, 1)
	assert.Equal(
		t,
		"/api/hub/public/providers/"+provider.Slug+"/logo?v=17",
		openAI.Models[0].Providers[0].Provider.LogoURL,
	)
}

func TestHubSupplyPublicModelRoutableAllowsAutoProbeDisabledModel(t *testing.T) {
	resetHubRoutingSnapshotsForTest(t)
	kinds := hubSupplyAutoProbeDisabledModelKinds(constant.ChannelTypeOpenAI, "gpt-internal", nil)
	assert.Equal(t, map[string]bool{HubSupplyProbeKindText: true}, kinds)
	assert.True(t, hubSupplyPublicModelRoutable(11, "gpt-internal", kinds, nil))
}

func TestHubSupplyPublicModelRoutableDoesNotUseFakeImageFallback(t *testing.T) {
	resetHubRoutingSnapshotsForTest(t)
	PublishHubRoutingRuntimeSignals(time.Now().Unix(), []HubRoutingRuntimeSignal{
		{
			ChannelID: 13, ModelName: "gpt-internal", ProbeKind: HubSupplyProbeKindText,
			RealHealthState: HubRoutingRealHealthQuarantined,
		},
	})
	kinds := hubSupplyAutoProbeDisabledModelKinds(constant.ChannelTypeOpenAI, "gpt-internal", nil)
	assert.False(t, hubSupplyPublicModelRoutable(13, "gpt-internal", kinds, nil))
}

func TestHubSupplyPublicModelRoutableRejectsRuntimeQuarantine(t *testing.T) {
	resetHubRoutingSnapshotsForTest(t)
	PublishHubRoutingRuntimeSignals(time.Now().Unix(), []HubRoutingRuntimeSignal{
		{
			ChannelID: 12, ModelName: "gpt-quarantined", ProbeKind: HubSupplyProbeKindText,
			RealHealthState: HubRoutingRealHealthQuarantined,
		},
	})
	targets := []HubSupplyGroupProbeTarget{{
		ModelName: "gpt-quarantined", ProbeKind: HubSupplyProbeKindText,
		Status: HubSupplyProbeStatusAvailable,
	}}
	assert.False(t, hubSupplyPublicModelRoutable(12, "gpt-quarantined", nil, targets))
}

func TestClassifyHubPublicHomeModel(t *testing.T) {
	tests := map[string]string{
		"claude-sonnet-4":        "anthropic",
		"gpt-5.6-luna":           "openai",
		"gpt-image-1":            "openai",
		"whisper-1":              "openai",
		"text-embedding-3-small": "openai",
		"text-moderation-latest": "openai",
		"gemini-3-pro-image":     "google",
		"nano-banana-pro":        "google",
		"text-embedding-004":     "google",
		"grok-4":                 "xai",
		"qwen3-max":              "alibaba",
		"custom-model":           "other",
	}
	for modelName, expected := range tests {
		t.Run(modelName, func(t *testing.T) {
			assert.Equal(t, expected, classifyHubPublicModelFamily(modelName))
		})
	}
}

func TestHubPublicHomeRanksProvidersByComprehensiveScore(t *testing.T) {
	truncateTables(t)
	now := int64(1_800_000_000)

	slowProvider := &HubProvider{OwnerUserId: 81, Name: "Alpha Slow"}
	require.NoError(t, CreateHubProvider(slowProvider))
	fastProvider := &HubProvider{OwnerUserId: 82, Name: "Zulu Fast"}
	require.NoError(t, CreateHubProvider(fastProvider))
	slowGroup, slowChannel := createHubPublicHomeTestSupply(t, slowProvider.Id, "slow", "gpt-score", "gpt-score", 1)
	fastGroup, fastChannel := createHubPublicHomeTestSupply(t, fastProvider.Id, "fast", "gpt-score", "gpt-score", 1)
	require.NoError(t, DB.Model(&Channel{Id: slowChannel.Id}).Update("status", common.ChannelStatusEnabled).Error)
	require.NoError(t, DB.Model(&Channel{Id: fastChannel.Id}).Update("status", common.ChannelStatusEnabled).Error)
	setHubPublicHomeTargetStatus(t, slowGroup.Id, "gpt-score", HubSupplyProbeStatusAvailable, now-20)
	setHubPublicHomeTargetStatus(t, fastGroup.Id, "gpt-score", HubSupplyProbeStatusAvailable, now-10)

	slowTTFT := int64(9_000)
	fastTTFT := int64(300)
	samples := make([]HubSupplyGroupProbeSample, 0, 8)
	for index := 0; index < 4; index++ {
		samples = append(samples,
			HubSupplyGroupProbeSample{
				GroupId: slowGroup.Id, ConfigVersion: slowGroup.ConfigVersion, ModelName: "gpt-score",
				Success: true, LatencyMs: 10_000, FirstTokenMs: &slowTTFT, ProbedAt: now - int64(600+index*60),
			},
			HubSupplyGroupProbeSample{
				GroupId: fastGroup.Id, ConfigVersion: fastGroup.ConfigVersion, ModelName: "gpt-score",
				Success: true, LatencyMs: 900, FirstTokenMs: &fastTTFT, ProbedAt: now - int64(600+index*60),
			},
		)
	}
	require.NoError(t, DB.Create(&samples).Error)

	home, err := GetHubPublicHome(now)
	require.NoError(t, err)
	openAI := findHubPublicHomeFamily(t, home, "openai")
	require.Len(t, openAI.Models, 1)
	require.Len(t, openAI.Models[0].Providers, 2)
	assert.Equal(t, fastProvider.Id, openAI.Models[0].Providers[0].Provider.Id)
	assert.Equal(t, &fastTTFT, openAI.Models[0].Providers[0].FirstTokenP50Ms)
	assert.Greater(t, openAI.Models[0].Providers[0].rankingScoreBps, openAI.Models[0].Providers[1].rankingScoreBps)
}

func createHubPublicHomeTestSupply(
	t *testing.T,
	providerID int,
	channelName string,
	models string,
	publishedModels string,
	multiplier float64,
) (*HubSupplyGroup, *Channel) {
	t.Helper()
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: providerID, PriceMultiplier: multiplier,
		PublishedModels: publishedModels, TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: channelName,
		BaseURL: &baseURL, Models: models, Group: "default",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	return group, channel
}

func setHubPublicHomeTargetStatus(t *testing.T, groupID int, modelName, status string, lastProbeAt int64) {
	t.Helper()
	result := DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("group_id = ? AND model_name = ?", groupID, modelName).
		Updates(map[string]any{"status": status, "last_probe_at": lastProbeAt})
	require.NoError(t, result.Error)
	require.Positive(t, result.RowsAffected)
}

func findHubPublicHomeFamily(t *testing.T, home *HubPublicHome, familyKey string) HubPublicHomeFamily {
	t.Helper()
	for _, family := range home.Families {
		if family.Key == familyKey {
			return family
		}
	}
	require.FailNow(t, "public home family not found", familyKey)
	return HubPublicHomeFamily{}
}
