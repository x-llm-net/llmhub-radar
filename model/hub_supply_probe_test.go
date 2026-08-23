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
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func getChannelAbilityModels(t *testing.T, channelID int) []string {
	t.Helper()
	models := make([]string, 0)
	require.NoError(t, DB.Model(&Ability{}).
		Where("channel_id = ? AND enabled = ?", channelID, true).
		Distinct("model").Order("model ASC").Pluck("model", &models).Error)
	return models
}

func TestHubSupplyProbeJobsQueryAvoidsMySQLReservedAliases(t *testing.T) {
	sql := DB.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return hubSupplyProbeJobsQuery(tx).
			Where("targets.next_probe_at <= ?", common.GetTimestamp()).
			Find(&[]HubSupplyProbeJob{})
	})
	assert.Contains(t, sql, "hub_supply_groups AS supply_groups")
	assert.NotContains(t, sql, "hub_supply_groups AS groups")
}

func TestHubSupplyProbeDefinitionsSeparateTextAndImage(t *testing.T) {
	modelSupportEndpointsLock.Lock()
	original := modelSupportEndpointTypes
	modelSupportEndpointTypes = map[string][]constant.EndpointType{
		"multimodal-model": {
			constant.EndpointTypeOpenAI,
			constant.EndpointTypeImageGeneration,
		},
	}
	modelSupportEndpointsLock.Unlock()
	t.Cleanup(func() {
		modelSupportEndpointsLock.Lock()
		modelSupportEndpointTypes = original
		modelSupportEndpointsLock.Unlock()
	})

	definitions := hubSupplyProbeDefinitions(constant.ChannelTypeOpenAI, []string{"multimodal-model"})
	require.Len(t, definitions, 2)
	assert.Equal(t, HubSupplyProbeKindText, definitions[0].ProbeKind)
	assert.Equal(t, string(constant.EndpointTypeOpenAI), definitions[0].EndpointType)
	assert.Equal(t, HubSupplyProbeKindImage, definitions[1].ProbeKind)
	assert.Equal(t, string(constant.EndpointTypeImageGeneration), definitions[1].EndpointType)
}

func TestHubSupplyProbeDefinitionsTreatGPTImageModelsAsImageOnly(t *testing.T) {
	definitions := hubSupplyProbeDefinitions(constant.ChannelTypeOpenAI, []string{
		"gpt-image-1",
		"gpt-image-2",
		"gpt-image-2-4K",
	})
	require.Len(t, definitions, 3)
	for _, definition := range definitions {
		assert.Equal(t, HubSupplyProbeKindImage, definition.ProbeKind)
		assert.Equal(t, string(constant.EndpointTypeImageGeneration), definition.EndpointType)
	}
}

func TestHubSupplyProbeDefinitionsHonorManualEndpointOverride(t *testing.T) {
	definitions := hubSupplyProbeDefinitionsWithOverrides(
		constant.ChannelTypeOpenAI,
		[]string{"gpt-image-2", "custom-response-model"},
		map[string]string{
			"gpt-image-2":           string(constant.EndpointTypeOpenAI),
			"custom-response-model": string(constant.EndpointTypeOpenAIResponse),
		},
	)
	require.Len(t, definitions, 2)
	assert.Equal(t, string(constant.EndpointTypeOpenAI), definitions[0].EndpointType)
	assert.Equal(t, HubSupplyProbeKindText, definitions[0].ProbeKind)
	assert.Equal(t, string(constant.EndpointTypeOpenAI), definitions[0].EndpointMode)
	assert.Equal(t, string(constant.EndpointTypeOpenAIResponse), definitions[1].EndpointType)
	assert.Equal(t, HubSupplyProbeKindText, definitions[1].ProbeKind)
	assert.Equal(t, string(constant.EndpointTypeOpenAIResponse), definitions[1].EndpointMode)
}

func TestHubSupplyRoutingIsolatesTextAndImageProbeKinds(t *testing.T) {
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		InitChannelCache()
	})
	truncateTables(t)

	modelSupportEndpointsLock.Lock()
	originalEndpoints := modelSupportEndpointTypes
	modelSupportEndpointTypes = map[string][]constant.EndpointType{
		"gpt-5": {constant.EndpointTypeOpenAI, constant.EndpointTypeImageGeneration},
	}
	modelSupportEndpointsLock.Unlock()
	t.Cleanup(func() {
		modelSupportEndpointsLock.Lock()
		modelSupportEndpointTypes = originalEndpoints
		modelSupportEndpointsLock.Unlock()
	})

	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 0.1, PublishedModels: "gpt-5",
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "multimodal supply",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default",
		Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	var targets []HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).Find(&targets).Error)
	require.Len(t, targets, 2)
	var textTarget, imageTarget HubSupplyGroupProbeTarget
	for _, target := range targets {
		switch target.ProbeKind {
		case HubSupplyProbeKindText:
			textTarget = target
		case HubSupplyProbeKindImage:
			imageTarget = target
		}
	}
	require.NotZero(t, textTarget.Id)
	require.NotZero(t, imageTarget.Id)

	_, _, err := RecordHubSupplyProbeResult(textTarget.Id, true, 500, "", "", "")
	require.NoError(t, err)
	_, _, err = RecordHubSupplyProbeResult(imageTarget.Id, false, 700, "image failed", "upstream_error", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))

	storedGroup, err := GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, storedGroup)
	assert.Equal(t, HubSupplyGroupStatusPartial, storedGroup.Status)
	assert.Equal(t, 1, storedGroup.AvailableModelCount)
	storedChannel, err := GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusEnabled, storedChannel.Status)
	assert.Contains(t, getChannelAbilityModels(t, channel.Id), "gpt-5")

	var ability Ability
	require.NoError(t, DB.Where("channel_id = ? AND model = ? AND enabled = ?", channel.Id, "gpt-5", true).First(&ability).Error)
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/chat/completions", true)
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/images/generations", false)

	require.NoError(t, MarkHubSupplyProbeTargetsTesting([]int{textTarget.Id}))
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/chat/completions", true)

	_, _, err = RecordHubSupplyProbeResult(textTarget.Id, false, 650, "text failed", "upstream_error", "")
	require.NoError(t, err)
	_, _, err = RecordHubSupplyProbeResult(imageTarget.Id, true, 600, "", "", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/chat/completions", true)
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/images/edits", true)
	require.NoError(t, DB.First(&textTarget, textTarget.Id).Error)
	assert.Equal(t, 1, textTarget.ConsecutiveFailures)

	_, _, err = RecordHubSupplyProbeResult(imageTarget.Id, false, 800, "image failed again", "upstream_error", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/chat/completions", true)
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/images/edits", true)
	storedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusEnabled, storedChannel.Status)

	_, _, err = RecordHubSupplyProbeResult(textTarget.Id, false, 900, "text failed twice", "upstream_error", "")
	require.NoError(t, err)
	_, _, err = RecordHubSupplyProbeResult(imageTarget.Id, false, 950, "image failed twice", "upstream_error", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/chat/completions", false)
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/images/edits", false)
	storedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusAutoDisabled, storedChannel.Status)
	assert.Empty(t, getChannelAbilityModels(t, channel.Id))

	_, _, err = RecordHubSupplyProbeResult(textTarget.Id, true, 500, "", "", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	require.NoError(t, DB.First(&textTarget, textTarget.Id).Error)
	assert.Zero(t, textTarget.ConsecutiveFailures)
	storedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusEnabled, storedChannel.Status)
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/chat/completions", true)
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/images/edits", false)
}

func TestInitChannelCacheReplacesConfiguredSupplyChannelSet(t *testing.T) {
	truncateTables(t)
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		InitChannelCache()
	})

	provider := &HubProvider{OwnerUserId: 99101, Name: "cache generation provider", Slug: "cache-generation-provider"}
	require.NoError(t, DB.Create(provider).Error)
	channel := &Channel{
		Name: "cache-generation-channel", Type: constant.ChannelTypeOpenAI,
		Key: "cache-generation-key", Models: "gpt-5", Group: "default",
		Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, DB.Create(channel).Error)
	group := &HubSupplyGroup{
		ProviderId: provider.Id, NewAPIChannelId: channel.Id,
		PriceMultiplier: 0.5, Status: HubSupplyGroupStatusAvailable,
	}
	require.NoError(t, DB.Create(group).Error)

	require.NoError(t, RefreshHubSupplyPricingCache())
	initial := CaptureHubSupplyPricingSnapshot(channel.Id)
	assert.True(t, initial.Found)
	assert.True(t, initial.Configured)

	require.NoError(t, DB.Delete(&HubSupplyGroup{}, group.Id).Error)
	InitChannelCache()

	refreshed := CaptureHubSupplyPricingSnapshot(channel.Id)
	assert.False(t, refreshed.Found)
	assert.False(t, refreshed.Configured)
}

func assertHubSupplyProbeKindSelection(t *testing.T, group string, channelID int, requestPath string, expected bool) {
	t.Helper()
	for _, memoryCacheEnabled := range []bool{false, true} {
		common.MemoryCacheEnabled = memoryCacheEnabled
		InitChannelCache()
		selected, err := GetRandomSatisfiedChannel(group, "gpt-5", 0, requestPath, nil)
		require.NoError(t, err)
		if expected {
			require.NotNil(t, selected, "memory_cache=%t path=%s", memoryCacheEnabled, requestPath)
			assert.Equal(t, channelID, selected.Id)
		} else {
			assert.Nil(t, selected, "memory_cache=%t path=%s", memoryCacheEnabled, requestPath)
		}
	}
}

func TestNativeChannelUpdateKeepsSupplyStateForMetadataAndResetsConnectionChanges(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1, PublishedModels: "gpt-5",
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "provider channel",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default",
		Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").First(&target).Error)
	_, _, err := RecordHubSupplyProbeResult(target.Id, true, 500, "", "", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))

	stored, err := GetChannelById(channel.Id, true)
	require.NoError(t, err)
	stored.Name = "renamed provider channel"
	require.NoError(t, stored.Update())
	metadataOnlyGroup, err := GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, metadataOnlyGroup)
	assert.Equal(t, 1, metadataOnlyGroup.ConfigVersion)
	assert.Equal(t, HubSupplyGroupStatusAvailable, metadataOnlyGroup.Status)
	assert.Equal(t, []string{"gpt-5"}, getChannelAbilityModels(t, channel.Id))

	stored, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	stored.Key = "replacement-secret"
	require.NoError(t, stored.Update())
	resetGroup, err := GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, resetGroup)
	assert.Equal(t, 2, resetGroup.ConfigVersion)
	assert.Equal(t, HubSupplyGroupStatusPending, resetGroup.Status)
	assert.Zero(t, resetGroup.AvailableModelCount)
	assert.Zero(t, resetGroup.LastProbeAt)
	assert.Empty(t, getChannelAbilityModels(t, channel.Id))

	updatedChannel, err := GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusAutoDisabled, updatedChannel.Status)
	var currentTargets []HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ? AND config_version = ?", group.Id, resetGroup.ConfigVersion).Find(&currentTargets).Error)
	require.Len(t, currentTargets, 1)
	assert.Equal(t, HubSupplyProbeStatusPending, currentTargets[0].Status)
}

func TestDeleteDisabledChannelsCleansSupplyExtension(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "pending provider channel",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	deleted, err := DeleteDisabledChannel()
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)
	for table, query := range map[string]*gorm.DB{
		"channel": DB.Model(&Channel{}).Where("id = ?", channel.Id),
		"supply":  DB.Model(&HubSupplyGroup{}).Where("id = ?", group.Id),
		"targets": DB.Model(&HubSupplyGroupProbeTarget{}).Where("group_id = ?", group.Id),
	} {
		var count int64
		require.NoError(t, query.Count(&count).Error, table)
		assert.Zero(t, count, table)
	}
}

func TestReconcileHubSupplyGroupRequiresPublicationAndAvailability(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId:        1,
		PriceMultiplier:   1,
		TextProbeMinutes:  10,
		ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:test",
		BaseURL: &baseURL, Models: "gpt-5,gpt-5-mini", Group: "hub_test",
		Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").First(&target).Error)
	groupID, current, err := RecordHubSupplyProbeResult(target.Id, true, 800, "", "", "")
	require.NoError(t, err)
	assert.True(t, current)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(groupID))

	updatedChannel, err := GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusAutoDisabled, updatedChannel.Status)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedChannel.GetModels(), "routing state must not rewrite channel configuration")
	assert.Empty(t, getChannelAbilityModels(t, channel.Id))

	updatedGroup, err := GetHubSupplyGroupByPublicID(group.ProviderId, group.PublicId)
	require.NoError(t, err)
	require.NotNil(t, updatedGroup)
	assert.Equal(t, HubSupplyGroupStatusPartial, updatedGroup.Status)
	assert.Equal(t, 1, updatedGroup.AvailableModelCount)
	assert.Equal(t, 1, updatedGroup.PendingModelCount)
	assert.Empty(t, updatedGroup.GetPublishedModels(updatedChannel.Models))

	require.NoError(t, UpdateHubSupplyGroupModelPublication(group.Id, "gpt-5-mini", true))
	updatedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedChannel.GetModels())
	assert.Empty(t, getChannelAbilityModels(t, channel.Id), "publication intent alone must not route an untested model")

	require.NoError(t, UpdateHubSupplyGroupModelPublication(group.Id, "gpt-5", true))
	updatedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusEnabled, updatedChannel.Status)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedChannel.GetModels())
	assert.Equal(t, []string{"gpt-5"}, getChannelAbilityModels(t, channel.Id))

	_, _, err = RecordHubSupplyProbeResult(target.Id, false, 1200, "upstream failed", "upstream_error", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	updatedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusEnabled, updatedChannel.Status)
	assert.Equal(t, []string{"gpt-5"}, getChannelAbilityModels(t, channel.Id), "the first transient failure must only degrade routing")

	_, _, err = RecordHubSupplyProbeResult(target.Id, false, 1300, "upstream failed again", "upstream_error", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	updatedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusAutoDisabled, updatedChannel.Status)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedChannel.GetModels())
	assert.Empty(t, getChannelAbilityModels(t, channel.Id), "a published model must leave routing after repeated failures")

	_, _, err = RecordHubSupplyProbeResult(target.Id, true, 900, "", "", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	updatedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedChannel.GetModels())
	assert.Equal(t, []string{"gpt-5"}, getChannelAbilityModels(t, channel.Id), "a published model must return after recovery")

	require.NoError(t, UpdateHubSupplyGroupModelPublication(group.Id, "gpt-5", false))
	updatedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusAutoDisabled, updatedChannel.Status)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedChannel.GetModels())
	assert.Empty(t, getChannelAbilityModels(t, channel.Id), "manual unlisting must override a healthy probe")
	_, _, err = FixAbility()
	require.NoError(t, err)
	assert.Empty(t, getChannelAbilityModels(t, channel.Id), "ability repair must preserve supply publication rules")
}

func TestMigrateHubSupplyProbeFailureCountsKeepsLegacyErrorsQuarantined(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	target := &HubSupplyGroupProbeTarget{
		GroupId: 1, ConfigVersion: 1, ModelName: "gpt-legacy-error",
		EndpointType: string(constant.EndpointTypeOpenAI), EndpointMode: HubSupplyProbeEndpointModeAuto,
		ProbeKind: HubSupplyProbeKindText, Status: HubSupplyProbeStatusError,
		LastProbeAt: now, LastSuccessAt: now - 600, CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, DB.Create(target).Error)
	suspendedTarget := &HubSupplyGroupProbeTarget{
		GroupId: 2, ConfigVersion: 1, ModelName: "gpt-legacy-suspended",
		EndpointType: string(constant.EndpointTypeOpenAI), EndpointMode: HubSupplyProbeEndpointModeAuto,
		ProbeKind: HubSupplyProbeKindText, Status: HubSupplyProbeStatusError,
		ConsecutiveFailures: HubSupplyProbeFailureSuspendLimit + 5,
		NextProbeAt:         now, LastProbeAt: now, CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, DB.Create(suspendedTarget).Error)
	require.NoError(t, migrateHubSupplyProbeFailureCounts())
	require.NoError(t, DB.First(target, target.Id).Error)
	assert.Equal(t, HubSupplyProbeFailureThreshold, target.ConsecutiveFailures)
	assert.False(t, hubSupplyProbeTargetRoutable(*target))
	require.NoError(t, DB.First(suspendedTarget, suspendedTarget.Id).Error)
	assert.Equal(t, HubSupplyProbeStatusSuspended, suspendedTarget.Status)
	assert.Zero(t, suspendedTarget.NextProbeAt)
	assert.NotZero(t, suspendedTarget.SuspendedAt)
	assert.Equal(t, HubSupplyProbeSuspensionReasonFailureLimit, suspendedTarget.SuspensionReason)
}

func TestReconcileHubSupplyGroupPreservesManualDisableAfterHealthyProbe(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 0.1, PublishedModels: "gpt-5",
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "manually disabled supply",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").First(&target).Error)
	_, _, err := RecordHubSupplyProbeResult(target.Id, true, 500, "", "", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))

	updatedChannel, err := GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, updatedChannel.Status)
	assert.Empty(t, getChannelAbilityModels(t, channel.Id))
}

func TestReconcileHubSupplyChannelRouteStatePreservesConcurrentManualDisable(t *testing.T) {
	truncateTables(t)
	priority := int64(0)
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "concurrent manual disable",
		Models: "gpt-5", Group: "default", Status: common.ChannelStatusAutoDisabled,
		Priority: &priority,
	}
	require.NoError(t, DB.Create(channel).Error)
	require.NoError(t, DB.Create(&Ability{
		Group: "default", Model: "gpt-5", ChannelId: channel.Id,
		Enabled: false, Priority: &priority,
	}).Error)

	// The route decision was made while the Channel was auto-disabled, but the
	// administrator disabled it manually before the recovery write reached DB.
	require.NoError(t, DB.Model(&Channel{}).
		Where("id = ?", channel.Id).
		Update("status", common.ChannelStatusManuallyDisabled).Error)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return reconcileHubSupplyChannelRouteStateTx(tx, channel.Id, common.ChannelStatusEnabled)
	}))

	stored, err := GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, stored.Status)
	var abilities []Ability
	require.NoError(t, DB.Where("channel_id = ?", channel.Id).Find(&abilities).Error)
	require.Len(t, abilities, 1)
	assert.False(t, abilities[0].Enabled)
}

func TestResolveHubSupplyServiceTiersAggregatesModelFamilies(t *testing.T) {
	original := hub_routing_setting.Snapshot()
	t.Cleanup(func() { require.NoError(t, hub_routing_setting.Publish(original)) })
	setting := original
	setting.Enabled = true
	setting.AllowOtherFamily = false
	setting.HighQualityProviderIDs = nil
	setting.FamilyTierCeilings = map[string]hub_routing_setting.FamilyTierCeilings{
		"openai":    {Special: 0.1, Low: 0.3, Medium: 0.8, High: 1},
		"anthropic": {Special: 0.2, Low: 0.4, Medium: 0.8, High: 1},
	}
	require.NoError(t, hub_routing_setting.Publish(setting))

	assert.Equal(
		t,
		[]string{hub_routing_setting.ServiceTierSpecial, hub_routing_setting.ServiceTierLow},
		ResolveHubSupplyServiceTiers("gpt-5,claude-opus-4-6", 0.15, 1),
	)
}

func TestUpdateHubSupplyGroupModelsPublicationIsAtomic(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:batch-publication",
		BaseURL: &baseURL, Models: "gpt-5,gpt-5-mini,gpt-5-nano", Group: "hub_test",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	require.NoError(t, UpdateHubSupplyGroupModelsPublication(group.Id, []string{"gpt-5", "gpt-5-mini"}, true))
	updatedGroup, err := GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, updatedGroup)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedGroup.GetPublishedModels(channel.Models))

	err = UpdateHubSupplyGroupModelsPublication(group.Id, []string{"gpt-5", "not-configured"}, false)
	require.ErrorIs(t, err, ErrHubSupplyProbeModelNotFound)
	updatedGroup, err = GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, updatedGroup)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedGroup.GetPublishedModels(channel.Models), "an invalid batch must not partially update publication state")
}

func TestUpdateHubSupplyGroupPublicationRollsBackWhenAbilityRefreshFails(t *testing.T) {
	newFixture := func(t *testing.T) (*HubSupplyGroup, *Channel) {
		t.Helper()
		truncateTables(t)
		baseURL := "https://upstream.example"
		group := &HubSupplyGroup{
			ProviderId: 1, PriceMultiplier: 0.1,
			TextProbeMinutes: 10, ImageProbeMinutes: 30,
		}
		channel := &Channel{
			Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:publication-rollback",
			BaseURL: &baseURL, Models: "gpt-5", Group: "default",
			Status: common.ChannelStatusAutoDisabled,
		}
		require.NoError(t, CreateHubSupplyGroup(group, channel))
		var target HubSupplyGroupProbeTarget
		require.NoError(t, DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").First(&target).Error)
		_, current, err := RecordHubSupplyProbeResult(target.Id, true, 500, "", "", "")
		require.NoError(t, err)
		require.True(t, current)
		return group, channel
	}

	t.Run("publish", func(t *testing.T) {
		group, channel := newFixture(t)
		callbackName := "test:fail-hub-ability-create"
		require.NoError(t, DB.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
			if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "abilities" {
				tx.AddError(errors.New("forced ability create failure"))
			}
		}))
		t.Cleanup(func() { require.NoError(t, DB.Callback().Create().Remove(callbackName)) })

		err := UpdateHubSupplyGroupModelPublication(group.Id, "gpt-5", true)
		require.ErrorContains(t, err, "forced ability create failure")

		storedGroup, getErr := GetHubSupplyGroupByChannelID(channel.Id)
		require.NoError(t, getErr)
		require.NotNil(t, storedGroup)
		assert.Empty(t, storedGroup.GetPublishedModels(channel.Models))
		storedChannel, getErr := GetChannelById(channel.Id, true)
		require.NoError(t, getErr)
		assert.Equal(t, common.ChannelStatusAutoDisabled, storedChannel.Status)
		assert.Empty(t, getChannelAbilityModels(t, channel.Id))
	})

	t.Run("unpublish", func(t *testing.T) {
		group, channel := newFixture(t)
		require.NoError(t, UpdateHubSupplyGroupModelPublication(group.Id, "gpt-5", true))
		abilitiesBefore := getChannelAbilityModels(t, channel.Id)
		require.NotEmpty(t, abilitiesBefore)

		callbackName := "test:fail-hub-ability-delete"
		require.NoError(t, DB.Callback().Delete().Before("gorm:delete").Register(callbackName, func(tx *gorm.DB) {
			if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "abilities" {
				tx.AddError(errors.New("forced ability delete failure"))
			}
		}))
		t.Cleanup(func() { require.NoError(t, DB.Callback().Delete().Remove(callbackName)) })

		err := UpdateHubSupplyGroupModelPublication(group.Id, "gpt-5", false)
		require.ErrorContains(t, err, "forced ability delete failure")

		storedGroup, getErr := GetHubSupplyGroupByChannelID(channel.Id)
		require.NoError(t, getErr)
		require.NotNil(t, storedGroup)
		assert.Equal(t, []string{"gpt-5"}, storedGroup.GetPublishedModels(channel.Models))
		storedChannel, getErr := GetChannelById(channel.Id, true)
		require.NoError(t, getErr)
		assert.Equal(t, common.ChannelStatusEnabled, storedChannel.Status)
		assert.Equal(t, abilitiesBefore, getChannelAbilityModels(t, channel.Id))
	})
}

func TestUpdateHubSupplyGroupDropsPublicationForRemovedModels(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1,
		PublishedModels:  "gpt-5,gpt-5-mini",
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:published",
		BaseURL: &baseURL, Models: "gpt-5,gpt-5-mini", Group: "hub_published",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	channel.Models = "gpt-5-mini"
	require.NoError(t, UpdateHubSupplyChannel(group, channel))

	updatedGroup, err := GetHubSupplyGroupByPublicID(group.ProviderId, group.PublicId)
	require.NoError(t, err)
	require.NotNil(t, updatedGroup)
	assert.Equal(t, []string{"gpt-5-mini"}, updatedGroup.GetPublishedModels(channel.Models))
}

func TestRequestImmediateHubSupplyGroupProbeEnforcesCooldown(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:manual",
		BaseURL: &baseURL, Models: "gpt-5", Group: "hub_manual",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	nextAllowedAt, err := RequestImmediateHubSupplyGroupProbe(group.Id)
	require.NoError(t, err)
	assert.Greater(t, nextAllowedAt, common.GetTimestamp())
	secondNextAllowedAt, err := RequestImmediateHubSupplyGroupProbe(group.Id)
	assert.ErrorIs(t, err, ErrHubSupplyProbeCooldown)
	assert.Equal(t, nextAllowedAt, secondNextAllowedAt)
}

func TestRequestImmediateHubSupplyGroupModelProbeOnlyQueuesSelectedModel(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&HubProvider{
		Id: 1, OwnerUserId: 1, Slot: 1, Name: "active provider", Slug: "active-provider",
		Status: HubProviderStatusActive,
	}).Error)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:targeted",
		BaseURL: &baseURL, Models: "gpt-5,gpt-5-mini", Group: "hub_targeted",
		Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	now := common.GetTimestamp()
	future := now + 3600
	require.NoError(t, DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("group_id = ?", group.Id).
		Updates(map[string]any{
			"status": HubSupplyProbeStatusAvailable, "last_probe_at": now, "next_probe_at": future,
		}).Error)

	_, err := RequestImmediateHubSupplyGroupModelProbe(group.Id, "gpt-5-mini")
	require.NoError(t, err)
	_, err = RequestImmediateHubSupplyGroupModelProbe(group.Id, "gpt-5-mini")
	require.NoError(t, err, "single-model retries must not inherit the group-wide cooldown")
	require.NoError(t, EnsureHubSupplyGroupProbeTargets())
	targets, err := GetHubSupplyGroupProbeTargets(group.Id, group.ConfigVersion)
	require.NoError(t, err)
	require.Len(t, targets, 2)
	for _, target := range targets {
		if target.ModelName == "gpt-5-mini" {
			assert.Equal(t, HubSupplyProbeStatusPending, target.Status)
			assert.LessOrEqual(t, target.NextProbeAt, common.GetTimestamp())
			continue
		}
		assert.Equal(t, HubSupplyProbeStatusAvailable, target.Status)
		assert.Greater(t, target.NextProbeAt, common.GetTimestamp())
	}

	dueJobs, err := GetDueHubSupplyProbeJobs(common.GetTimestamp(), 10)
	require.NoError(t, err)
	require.Len(t, dueJobs, 1)
	assert.Equal(t, "gpt-5-mini", dueJobs[0].ModelName)
	hasDue, err := HasDueHubSupplyProbeTargets(common.GetTimestamp())
	require.NoError(t, err)
	assert.True(t, hasDue)
}

func TestHubSupplyProbeNextProbeAtUsesFailureBackoff(t *testing.T) {
	now := common.GetTimestamp()
	group := &HubSupplyGroup{TextProbeMinutes: 60, ImageProbeMinutes: 120}
	textTarget := &HubSupplyGroupProbeTarget{ProbeKind: HubSupplyProbeKindText}
	imageTarget := &HubSupplyGroupProbeTarget{ProbeKind: HubSupplyProbeKindImage}

	assert.Equal(t, now+5*60, hubSupplyProbeNextProbeAt(group, textTarget, now, 1))
	assert.Equal(t, now+5*60, hubSupplyProbeNextProbeAt(group, textTarget, now, 9))
	assert.Equal(t, now+15*60, hubSupplyProbeNextProbeAt(group, textTarget, now, 10))
	assert.Equal(t, now+15*60, hubSupplyProbeNextProbeAt(group, textTarget, now, 29))
	assert.Equal(t, now+60*60, hubSupplyProbeNextProbeAt(group, textTarget, now, 30))
	assert.Equal(t, now+60*60, hubSupplyProbeNextProbeAt(group, textTarget, now, 99))
	assert.Zero(t, hubSupplyProbeNextProbeAt(group, textTarget, now, HubSupplyProbeFailureSuspendLimit))
	assert.Equal(t, now+5*60, hubSupplyProbeNextProbeAt(group, imageTarget, now, 1))
	group.TextProbeMinutes = 3
	assert.Equal(t, now+3*60, hubSupplyProbeNextProbeAt(group, textTarget, now, 30))
}

func TestHubSupplyProbeRecoveryDelayReusesFailureBackoff(t *testing.T) {
	assert.Equal(t, 5*60, int(HubSupplyProbeRecoveryDelaySeconds(1)))
	assert.Equal(t, 5*60, int(HubSupplyProbeRecoveryDelaySeconds(9)))
	assert.Equal(t, 10*60, int(HubSupplyProbeRecoveryDelaySeconds(10)))
	assert.Equal(t, 10*60, int(HubSupplyProbeRecoveryDelaySeconds(30)))
	assert.Equal(t, 10*60, int(HubSupplyProbeRecoveryDelaySeconds(HubSupplyProbeFailureSuspendLimit-1)))
	assert.Equal(t, 5*60, int(HubSupplyProbeRecoveryDelaySecondsForRequestPath("/v1/images/generations", 1)))
	assert.Equal(t, 15*60, int(HubSupplyProbeRecoveryDelaySecondsForRequestPath("/v1/images/generations", 10)))
	assert.Equal(t, 30*60, int(HubSupplyProbeRecoveryDelaySecondsForRequestPath("/v1/images/generations", 30)))
}

func TestRecordHubSupplyProbeResultSuspendsAtFailureLimitAndManualProbeResets(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{ProviderId: 1, PriceMultiplier: 1, TextProbeMinutes: 10, ImageProbeMinutes: 30}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:suspended",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default", Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	now := common.GetTimestamp()
	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).First(&target).Error)
	require.NoError(t, DB.Model(&target).Updates(map[string]any{
		"status": HubSupplyProbeStatusError, "last_success_at": now - 600,
		"last_probe_at": now - 1, "consecutive_failures": HubSupplyProbeFailureSuspendLimit - 1,
	}).Error)

	_, current, err := RecordHubSupplyProbeResult(target.Id, false, 1000, "upstream down", "503", "")
	require.NoError(t, err)
	assert.True(t, current)
	require.NoError(t, DB.First(&target, target.Id).Error)
	assert.Equal(t, HubSupplyProbeStatusSuspended, target.Status)
	assert.Equal(t, HubSupplyProbeFailureSuspendLimit, target.ConsecutiveFailures)
	assert.Zero(t, target.NextProbeAt)
	assert.Equal(t, HubSupplyProbeSuspensionReasonFailureLimit, target.SuspensionReason)
	assert.False(t, hubSupplyProbeTargetRoutable(target))
	due, dueErr := GetDueHubSupplyProbeJobs(common.GetTimestamp(), 10)
	require.NoError(t, dueErr)
	assert.Empty(t, due)
	hasDue, dueErr := HasDueHubSupplyProbeTargets(common.GetTimestamp())
	require.NoError(t, dueErr)
	assert.False(t, hasDue)

	_, err = RequestImmediateHubSupplyGroupModelProbe(group.Id, "gpt-5")
	require.NoError(t, err)
	require.NoError(t, DB.First(&target, target.Id).Error)
	assert.Equal(t, HubSupplyProbeStatusPending, target.Status)
	assert.Zero(t, target.ConsecutiveFailures)
	assert.Zero(t, target.SuspendedAt)
	assert.Empty(t, target.SuspensionReason)
	assert.LessOrEqual(t, target.NextProbeAt, common.GetTimestamp())
}

func TestHubSupplyProbeLeaseRejectsStaleResult(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{ProviderId: 1, PriceMultiplier: 1, TextProbeMinutes: 10, ImageProbeMinutes: 30}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:lease",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default", Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).First(&target).Error)

	firstLease, err := ClaimHubSupplyProbeTargetsTesting([]int{target.Id})
	require.NoError(t, err)
	unusedLease, err := ClaimHubSupplyProbeTargetsTesting([]int{target.Id})
	require.NoError(t, err)
	assert.NotEqual(t, firstLease, unusedLease)
	require.NoError(t, DB.First(&target, target.Id).Error)
	assert.Equal(t, firstLease, target.ProbeLeaseToken)
	require.NoError(t, ResetHubSupplyProbeTargetsForManualProbe([]int{target.Id}))
	secondLease, err := ClaimHubSupplyProbeTargetsTesting([]int{target.Id})
	require.NoError(t, err)
	assert.NotEqual(t, firstLease, secondLease)
	require.NoError(t, RequeueHubSupplyProbeTargetsWithLease([]int{target.Id}, firstLease))
	require.NoError(t, DB.First(&target, target.Id).Error)
	assert.Equal(t, HubSupplyProbeStatusTesting, target.Status)
	assert.Equal(t, secondLease, target.ProbeLeaseToken)

	_, _, err = RecordHubSupplyProbeResultWithLease(target.Id, firstLease, false, 1000, nil, "stale", "503", "")
	require.ErrorIs(t, err, ErrHubSupplyProbeLeaseLost)
	var staleSamples int64
	require.NoError(t, DB.Model(&HubSupplyGroupProbeSample{}).Count(&staleSamples).Error)
	assert.Zero(t, staleSamples)
	require.NoError(t, DB.First(&target, target.Id).Error)
	assert.Equal(t, HubSupplyProbeStatusTesting, target.Status)
	assert.Zero(t, target.ConsecutiveFailures)
	assert.Equal(t, secondLease, target.ProbeLeaseToken)

	_, _, err = RecordHubSupplyProbeResultWithLease(target.Id, secondLease, true, 500, nil, "", "", "")
	require.NoError(t, err)
	require.NoError(t, DB.First(&target, target.Id).Error)
	assert.Equal(t, HubSupplyProbeStatusAvailable, target.Status)
	assert.Empty(t, target.ProbeLeaseToken)
	assert.False(t, target.ManualProbeRequested)
}

func TestClaimHubSupplyProbeTargetsTestingRejectsStaleDueList(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	target := &HubSupplyGroupProbeTarget{
		GroupId: 1, ConfigVersion: 1, ModelName: "gpt-future",
		EndpointType: string(constant.EndpointTypeOpenAI), EndpointMode: HubSupplyProbeEndpointModeAuto,
		ProbeKind: HubSupplyProbeKindText, Status: HubSupplyProbeStatusAvailable,
		NextProbeAt: now + 600, LastProbeAt: now, LastSuccessAt: now,
		CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, DB.Create(target).Error)
	_, err := ClaimHubSupplyProbeTargetsTesting([]int{target.Id})
	require.NoError(t, err)
	var stored HubSupplyGroupProbeTarget
	require.NoError(t, DB.First(&stored, target.Id).Error)
	assert.Equal(t, HubSupplyProbeStatusAvailable, stored.Status)
	assert.Empty(t, stored.ProbeLeaseToken)
	assert.Equal(t, now+600, stored.NextProbeAt)
}

func TestRecordHubSupplyProbeResultAtomicallyReconcilesGroupAndChannel(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{OwnerUserId: 17, Slot: 1, Name: "atomic provider", Slug: "atomic-provider", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(provider).Error)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 1, PublishedModels: "gpt-atomic",
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:atomic",
		BaseURL: &baseURL, Models: "gpt-atomic", Group: "default", Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).First(&target).Error)
	lease, err := ClaimHubSupplyProbeTargetsTesting([]int{target.Id})
	require.NoError(t, err)
	_, current, err := RecordHubSupplyProbeResultWithLease(target.Id, lease, true, 400, nil, "", "", "")
	require.NoError(t, err)
	assert.True(t, current)
	var storedGroup HubSupplyGroup
	require.NoError(t, DB.First(&storedGroup, group.Id).Error)
	assert.Equal(t, HubSupplyGroupStatusAvailable, storedGroup.Status)
	var storedChannel Channel
	require.NoError(t, DB.First(&storedChannel, channel.Id).Error)
	assert.Equal(t, common.ChannelStatusEnabled, storedChannel.Status)
}

func TestRecordHubSupplyProbeResultRollsBackWhenFinalLeaseCASLoses(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{ProviderId: 1, PriceMultiplier: 1, TextProbeMinutes: 10, ImageProbeMinutes: 30}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:final-lease-cas",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default", Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).First(&target).Error)
	lease, err := ClaimHubSupplyProbeTargetsTesting([]int{target.Id})
	require.NoError(t, err)

	callbackName := "test_hub_supply_probe_final_lease_cas"
	forced := false
	require.NoError(t, DB.Callback().Update().Before("gorm:update").Register(callbackName, func(tx *gorm.DB) {
		if forced || tx.Statement.Schema == nil || tx.Statement.Schema.Table != "hub_supply_group_probe_targets" {
			return
		}
		updates, ok := tx.Statement.Dest.(map[string]any)
		if !ok {
			return
		}
		if _, isProbeResult := updates["last_probe_at"]; !isProbeResult {
			return
		}
		forced = true
		tx.Statement.AddClause(clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "1 = 0"}}})
	}))
	t.Cleanup(func() {
		require.NoError(t, DB.Callback().Update().Remove(callbackName))
	})

	_, _, err = RecordHubSupplyProbeResultWithLease(target.Id, lease, true, 500, nil, "", "", "")
	require.ErrorIs(t, err, ErrHubSupplyProbeLeaseLost)
	assert.True(t, forced)
	var stored HubSupplyGroupProbeTarget
	require.NoError(t, DB.First(&stored, target.Id).Error)
	assert.Equal(t, HubSupplyProbeStatusTesting, stored.Status)
	assert.Equal(t, lease, stored.ProbeLeaseToken)
	assert.Zero(t, stored.LastProbeAt)
	var samples int64
	require.NoError(t, DB.Model(&HubSupplyGroupProbeSample{}).Count(&samples).Error)
	assert.Zero(t, samples)
}

func TestReleaseSkippedHubSupplyProbeTargetRestoresPriorState(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	tests := []struct {
		name                string
		lastSuccessAt       int64
		consecutiveFailures int
		expectedStatus      string
	}{
		{name: "available", lastSuccessAt: now - 60, expectedStatus: HubSupplyProbeStatusAvailable},
		{name: "error", lastSuccessAt: now - 60, consecutiveFailures: 1, expectedStatus: HubSupplyProbeStatusError},
		{name: "pending", expectedStatus: HubSupplyProbeStatusPending},
	}
	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			target := &HubSupplyGroupProbeTarget{
				GroupId: index + 1, ConfigVersion: 1, ModelName: "gpt-5",
				EndpointType: string(constant.EndpointTypeOpenAI), EndpointMode: HubSupplyProbeEndpointModeAuto,
				ProbeKind: HubSupplyProbeKindText, Status: HubSupplyProbeStatusTesting,
				LastSuccessAt: test.lastSuccessAt, ConsecutiveFailures: test.consecutiveFailures,
				NextProbeAt: now + 300, ProbeLeaseToken: "current-lease", CreatedAt: now, UpdatedAt: now,
			}
			require.NoError(t, DB.Create(target).Error)
			require.NoError(t, ReleaseSkippedHubSupplyProbeTargetWithLease(target.Id, "current-lease"))
			var stored HubSupplyGroupProbeTarget
			require.NoError(t, DB.First(&stored, target.Id).Error)
			assert.Equal(t, test.expectedStatus, stored.Status)
			assert.Empty(t, stored.ProbeLeaseToken)
			assert.Greater(t, stored.NextProbeAt, int64(0))
		})
	}
}

func TestReleaseSkippedHubSupplyProbeTargetRejectsStaleLease(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	target := &HubSupplyGroupProbeTarget{
		GroupId: 1, ConfigVersion: 1, ModelName: "gpt-5",
		EndpointType: string(constant.EndpointTypeOpenAI), EndpointMode: HubSupplyProbeEndpointModeAuto,
		ProbeKind: HubSupplyProbeKindText, Status: HubSupplyProbeStatusTesting,
		NextProbeAt: now + 300, ProbeLeaseToken: "new-lease", CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, DB.Create(target).Error)
	require.NoError(t, ReleaseSkippedHubSupplyProbeTargetWithLease(target.Id, "old-lease"))
	var stored HubSupplyGroupProbeTarget
	require.NoError(t, DB.First(&stored, target.Id).Error)
	assert.Equal(t, HubSupplyProbeStatusTesting, stored.Status)
	assert.Equal(t, "new-lease", stored.ProbeLeaseToken)
	assert.Equal(t, now+300, stored.NextProbeAt)
}

func TestMigrateHubSupplyProbeFailureCountsPreservesExistingSuspensionTimestamp(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	target := &HubSupplyGroupProbeTarget{
		GroupId: 1, ConfigVersion: 1, ModelName: "gpt-suspended",
		EndpointType: string(constant.EndpointTypeOpenAI), EndpointMode: HubSupplyProbeEndpointModeAuto,
		ProbeKind: HubSupplyProbeKindText, Status: HubSupplyProbeStatusSuspended,
		ConsecutiveFailures: HubSupplyProbeFailureSuspendLimit, SuspendedAt: now - 600,
		SuspensionReason: HubSupplyProbeSuspensionReasonFailureLimit,
		CreatedAt:        now, UpdatedAt: now,
	}
	require.NoError(t, DB.Create(target).Error)
	require.NoError(t, migrateHubSupplyProbeFailureCounts())
	require.NoError(t, migrateHubSupplyProbeFailureCounts())
	var stored HubSupplyGroupProbeTarget
	require.NoError(t, DB.First(&stored, target.Id).Error)
	assert.Equal(t, now-600, stored.SuspendedAt)
}

func TestManualProbeCanRunWithoutReenablingManuallyDisabledChannel(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{OwnerUserId: 7, Slot: 1, Name: "manual provider", Slug: "manual-provider", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(provider).Error)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{ProviderId: provider.Id, PriceMultiplier: 1, TextProbeMinutes: 10, ImageProbeMinutes: 30}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:manual-probe",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default", Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	_, err := RequestImmediateHubSupplyGroupProbe(group.Id)
	require.NoError(t, err)
	jobs, err := GetDueHubSupplyProbeJobs(common.GetTimestamp(), 10)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.True(t, jobs[0].ManualProbeRequested)

	lease, err := ClaimHubSupplyProbeTargetsTesting([]int{jobs[0].TargetId})
	require.NoError(t, err)
	jobs[0].ProbeLeaseToken = lease
	assert.True(t, IsHubSupplyProbeJobExecutable(jobs[0]))
	_, _, err = RecordHubSupplyProbeResultWithLease(jobs[0].TargetId, lease, true, 500, nil, "", "", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	stored, err := GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, stored.Status)
}

func TestAutomaticProbeRechecksChannelStatusAfterClaim(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{OwnerUserId: 8, Slot: 1, Name: "race provider", Slug: "race-provider", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(provider).Error)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{ProviderId: provider.Id, PriceMultiplier: 1, TextProbeMinutes: 10, ImageProbeMinutes: 30}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:race-probe",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default", Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	jobs, err := GetDueHubSupplyProbeJobs(common.GetTimestamp(), 10)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	lease, err := ClaimHubSupplyProbeTargetsTesting([]int{jobs[0].TargetId})
	require.NoError(t, err)
	jobs[0].ProbeLeaseToken = lease
	assert.True(t, IsHubSupplyProbeJobExecutable(jobs[0]))

	require.NoError(t, DB.Model(&Channel{Id: channel.Id}).Update("status", common.ChannelStatusManuallyDisabled).Error)
	assert.False(t, IsHubSupplyProbeJobExecutable(jobs[0]))
}

func TestGetDueHubSupplyProbeJobsSkipsManualChannelsAndDisabledProviders(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	manualGroup := &HubSupplyGroup{ProviderId: 1, PriceMultiplier: 1}
	manualChannel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "manual", Name: "hub:manual",
		BaseURL: &baseURL, Models: "gpt-5", Group: "manual", Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(manualGroup, manualChannel))

	provider := &HubProvider{OwnerUserId: 99, Slot: 1, Name: "disabled provider", Slug: "disabled-provider", Status: HubProviderStatusDisabled}
	require.NoError(t, DB.Create(provider).Error)
	disabledGroup := &HubSupplyGroup{ProviderId: provider.Id, PriceMultiplier: 1}
	disabledChannel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "disabled", Name: "hub:disabled-provider",
		BaseURL: &baseURL, Models: "gpt-5", Group: "disabled", Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(disabledGroup, disabledChannel))

	due, err := GetDueHubSupplyProbeJobs(common.GetTimestamp(), 20)
	require.NoError(t, err)
	assert.Empty(t, due)
}

func TestHasDueHubSupplyProbeTargetsIgnoresSupersededConfiguration(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:stale-probe-target",
		BaseURL: &baseURL, Models: "gpt-5", Group: "hub_stale_probe_target",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	now := common.GetTimestamp()
	currentVersion := group.ConfigVersion + 1
	require.NoError(t, DB.Model(&HubSupplyGroup{Id: group.Id}).Update("config_version", currentVersion).Error)
	require.NoError(t, DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("group_id = ?", group.Id).
		Updates(map[string]any{
			"status": HubSupplyProbeStatusPending, "next_probe_at": now - 1,
		}).Error)
	require.NoError(t, DB.Create(&HubSupplyGroupProbeTarget{
		GroupId: group.Id, ConfigVersion: currentVersion,
		ModelName: "gpt-5", EndpointType: string(constant.EndpointTypeOpenAI),
		EndpointMode: HubSupplyProbeEndpointModeAuto, ProbeKind: HubSupplyProbeKindText,
		Status: HubSupplyProbeStatusAvailable, NextProbeAt: now + 600,
		CreatedAt: now, UpdatedAt: now,
	}).Error)

	dueJobs, err := GetDueHubSupplyProbeJobs(now, 10)
	require.NoError(t, err)
	assert.Empty(t, dueJobs)
	hasDue, err := HasDueHubSupplyProbeTargets(now)
	require.NoError(t, err)
	assert.False(t, hasDue)
}

func TestUpdateHubSupplyGroupModelAutoProbeControlsTargetsAndRouting(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1, PublishedModels: "gpt-5,gpt-5-mini",
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "auto probe control",
		BaseURL: &baseURL, Models: "gpt-5,gpt-5-mini", Group: "default",
		Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	require.NoError(t, UpdateHubSupplyGroupModelAutoProbe(group.Id, "gpt-5", false))
	storedGroup, err := GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, storedGroup)
	assert.Equal(t, []string{"gpt-5"}, storedGroup.GetAutoProbeDisabledModels(channel.Models))
	var skippedTargets int64
	require.NoError(t, DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").Count(&skippedTargets).Error)
	assert.Zero(t, skippedTargets)
	assert.Equal(t, []string{"gpt-5"}, getChannelAbilityModels(t, channel.Id))
	availability, _, err := loadHubSupplyChannelProbeKinds(DB, []int{channel.Id})
	require.NoError(t, err)
	assert.True(t, hubSupplyChannelSupportsRequest(availability, channel.Id, "gpt-5", "/v1/responses"))
	assert.False(t, hubSupplyChannelSupportsRequest(availability, channel.Id, "gpt-5", "/v1/images/generations"))

	require.NoError(t, UpdateHubSupplyGroupModelAutoProbe(group.Id, "gpt-5", true))
	storedGroup, err = GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, storedGroup)
	assert.Empty(t, storedGroup.GetAutoProbeDisabledModels(channel.Models))
	var restoredTarget HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").First(&restoredTarget).Error)
	assert.Equal(t, HubSupplyProbeStatusPending, restoredTarget.Status)
	assert.Empty(t, getChannelAbilityModels(t, channel.Id))
}

func TestRequeueExpiredHubSupplyProbeTargetsRecoversTestingLease(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{ProviderId: 1, PriceMultiplier: 1, TextProbeMinutes: 10, ImageProbeMinutes: 30}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "expired probe lease",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default", Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).First(&target).Error)
	require.NoError(t, MarkHubSupplyProbeTargetsTesting([]int{target.Id}))
	now := common.GetTimestamp()
	require.NoError(t, DB.Model(&HubSupplyGroupProbeTarget{Id: target.Id}).Update("next_probe_at", now-1).Error)

	require.NoError(t, RequeueExpiredHubSupplyProbeTargets(now))
	require.NoError(t, DB.First(&target, target.Id).Error)
	assert.Equal(t, HubSupplyProbeStatusPending, target.Status)
	assert.Equal(t, now, target.NextProbeAt)
}

func TestUpdateHubSupplyGroupModelProbeEndpointOnlyResetsSelectedModel(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:endpoint-override",
		BaseURL: &baseURL, Models: "gpt-custom,gpt-5-mini", Group: "hub_endpoint_override",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	now := common.GetTimestamp()
	require.NoError(t, DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("group_id = ?", group.Id).
		Updates(map[string]any{
			"status": HubSupplyProbeStatusAvailable, "last_probe_at": now, "next_probe_at": now + 3600,
		}).Error)
	for _, modelName := range channel.GetModels() {
		require.NoError(t, DB.Create(&HubSupplyGroupProbeSample{
			GroupId: group.Id, ConfigVersion: group.ConfigVersion, ModelName: modelName,
			EndpointType: string(constant.EndpointTypeOpenAI), ProbeKind: HubSupplyProbeKindText,
			Success: true, LatencyMs: 100, ProbedAt: now,
		}).Error)
	}

	require.NoError(t, UpdateHubSupplyGroupModelProbeEndpoint(
		group.Id, "gpt-custom", string(constant.EndpointTypeOpenAIResponse),
	))

	var updatedGroup HubSupplyGroup
	require.NoError(t, DB.First(&updatedGroup, group.Id).Error)
	assert.Equal(t, group.ConfigVersion, updatedGroup.ConfigVersion)
	assert.Equal(t, string(constant.EndpointTypeOpenAIResponse), updatedGroup.GetProbeEndpointMode("gpt-custom", channel.Models))
	assert.Equal(t, HubSupplyProbeEndpointModeAuto, updatedGroup.GetProbeEndpointMode("gpt-5-mini", channel.Models))

	targets, err := GetHubSupplyGroupProbeTargets(group.Id, group.ConfigVersion)
	require.NoError(t, err)
	require.Len(t, targets, 2)
	for _, target := range targets {
		if target.ModelName == "gpt-custom" {
			assert.Equal(t, string(constant.EndpointTypeOpenAIResponse), target.EndpointType)
			assert.Equal(t, string(constant.EndpointTypeOpenAIResponse), target.EndpointMode)
			assert.Equal(t, HubSupplyProbeStatusWaiting, target.Status)
			assert.GreaterOrEqual(t, target.NextProbeAt, now+int64(group.TextProbeMinutes*60))
			continue
		}
		assert.Equal(t, HubSupplyProbeStatusAvailable, target.Status)
		assert.Greater(t, target.NextProbeAt, now)
	}

	var selectedSamples int64
	require.NoError(t, DB.Model(&HubSupplyGroupProbeSample{}).
		Where("group_id = ? AND model_name = ?", group.Id, "gpt-custom").Count(&selectedSamples).Error)
	assert.Zero(t, selectedSamples)
	var untouchedSamples int64
	require.NoError(t, DB.Model(&HubSupplyGroupProbeSample{}).
		Where("group_id = ? AND model_name = ?", group.Id, "gpt-5-mini").Count(&untouchedSamples).Error)
	assert.Equal(t, int64(1), untouchedSamples)

	dueJobs, err := GetDueHubSupplyProbeJobs(common.GetTimestamp(), 10)
	require.NoError(t, err)
	assert.Empty(t, dueJobs, "changing an endpoint must not immediately schedule a probe")
}

func TestEnsureHubSupplyGroupProbeTargetsPreservesTestingLease(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:leased",
		BaseURL: &baseURL, Models: "gpt-5", Group: "hub_leased",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	now := common.GetTimestamp()
	leaseUntil := now + HubSupplyProbeTestingLeaseSeconds
	require.NoError(t, DB.Model(&HubSupplyGroupProbeTarget{}).
		Where("group_id = ?", group.Id).
		Updates(map[string]any{
			"status": HubSupplyProbeStatusTesting, "next_probe_at": leaseUntil,
		}).Error)

	require.NoError(t, EnsureHubSupplyGroupProbeTargets())
	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).First(&target).Error)
	assert.Equal(t, HubSupplyProbeStatusTesting, target.Status)
	assert.Equal(t, leaseUntil, target.NextProbeAt)

	dueJobs, err := GetDueHubSupplyProbeJobs(now, 10)
	require.NoError(t, err)
	assert.Empty(t, dueJobs)
}

func TestRecordHubSupplyProbeResultPersistsResolvedEndpoint(t *testing.T) {
	truncateTables(t)
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:responses",
		BaseURL: &baseURL, Models: "gpt-custom", Group: "hub_responses",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, CreateHubSupplyGroup(group, channel))

	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).First(&target).Error)
	resolvedEndpoint := string(constant.EndpointTypeOpenAIResponse)
	_, _, err := RecordHubSupplyProbeResult(target.Id, true, 900, "", "", resolvedEndpoint)
	require.NoError(t, err)

	require.NoError(t, DB.First(&target, target.Id).Error)
	assert.Equal(t, resolvedEndpoint, target.ResolvedEndpointType)
	jobs, err := GetHubSupplyGroupModelProbeJobs(group.Id, "gpt-custom")
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, resolvedEndpoint, jobs[0].ResolvedEndpointType)
}
