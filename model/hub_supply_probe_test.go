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
	"gorm.io/gorm"
)

func getChannelAbilityModels(t *testing.T, channelID int) []string {
	t.Helper()
	models := make([]string, 0)
	require.NoError(t, DB.Model(&Ability{}).
		Where("channel_id = ? AND enabled = ?", channelID, true).
		Order("model ASC").Pluck("model", &models).Error)
	return models
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

	_, _, err = RecordHubSupplyProbeResult(textTarget.Id, false, 650, "text failed", "upstream_error", "")
	require.NoError(t, err)
	_, _, err = RecordHubSupplyProbeResult(imageTarget.Id, true, 600, "", "", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/chat/completions", false)
	assertHubSupplyProbeKindSelection(t, ability.Group, channel.Id, "/v1/images/edits", true)

	_, _, err = RecordHubSupplyProbeResult(imageTarget.Id, false, 800, "image failed again", "upstream_error", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	storedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusAutoDisabled, storedChannel.Status)
	assert.Empty(t, getChannelAbilityModels(t, channel.Id))
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
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	updatedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedChannel.GetModels())
	assert.Empty(t, getChannelAbilityModels(t, channel.Id), "publication intent alone must not route an untested model")

	require.NoError(t, UpdateHubSupplyGroupModelPublication(group.Id, "gpt-5", true))
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
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
	assert.Equal(t, common.ChannelStatusAutoDisabled, updatedChannel.Status)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedChannel.GetModels())
	assert.Empty(t, getChannelAbilityModels(t, channel.Id), "a published model must leave routing while unhealthy")

	_, _, err = RecordHubSupplyProbeResult(target.Id, true, 900, "", "", "")
	require.NoError(t, err)
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	updatedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedChannel.GetModels())
	assert.Equal(t, []string{"gpt-5"}, getChannelAbilityModels(t, channel.Id), "a published model must return after recovery")

	require.NoError(t, UpdateHubSupplyGroupModelPublication(group.Id, "gpt-5", false))
	require.NoError(t, ReconcileHubSupplyGroupRouteState(group.Id))
	updatedChannel, err = GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusAutoDisabled, updatedChannel.Status)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedChannel.GetModels())
	assert.Empty(t, getChannelAbilityModels(t, channel.Id), "manual unlisting must override a healthy probe")
	_, _, err = FixAbility()
	require.NoError(t, err)
	assert.Empty(t, getChannelAbilityModels(t, channel.Id), "ability repair must preserve supply publication rules")
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
	baseURL := "https://upstream.example"
	group := &HubSupplyGroup{
		ProviderId: 1, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "hub:targeted",
		BaseURL: &baseURL, Models: "gpt-5,gpt-5-mini", Group: "hub_targeted",
		Status: common.ChannelStatusManuallyDisabled,
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
