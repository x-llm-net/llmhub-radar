package model

import (
	"errors"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestHubProbeRetainsSuccessfulImageEndpointAcrossRefreshAndAutoMode(t *testing.T) {
	truncateTables(t)
	resetHubRoutingSnapshotsForTest(t)
	group := &HubSupplyGroup{ProviderId: 1, PriceMultiplier: 1, PublishedModels: "custom-model"}
	channel := &Channel{Type: constant.ChannelTypeOpenAI, Key: "test", Models: "custom-model", Group: "default"}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	require.NoError(t, UpdateHubSupplyGroupModelProbeEndpoint(group.Id, "custom-model", "image-generation"))
	require.NoError(t, UpdateHubSupplyGroupModelProbeEndpoint(group.Id, "custom-model", "auto"))
	unverified, err := GetHubSupplyGroupProbeTargets(group.Id, group.ConfigVersion)
	require.NoError(t, err)
	require.Len(t, unverified, 1)
	assert.Equal(t, "openai", unverified[0].EndpointType, "auto should reset an unverified manual choice")
	require.NoError(t, UpdateHubSupplyGroupModelProbeEndpoint(group.Id, "custom-model", "image-generation"))
	var before HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).First(&before).Error)
	_, _, err = RecordHubSupplyProbeResult(before.Id, true, 250, "", "", "image-generation")
	require.NoError(t, err)
	require.NoError(t, DB.First(&before, before.Id).Error)
	require.NoError(t, UpdateHubSupplyGroupModelProbeEndpoint(group.Id, "custom-model", "auto"))
	InvalidatePricingCache()
	require.NoError(t, EnsureHubSupplyGroupProbeTargets())
	targets, err := GetHubSupplyGroupProbeTargets(group.Id, group.ConfigVersion)
	require.NoError(t, err)
	require.Len(t, targets, 1)
	assert.Equal(t, before.Id, targets[0].Id)
	assert.Equal(t, before.LastSuccessAt, targets[0].LastSuccessAt)
	assert.Equal(t, "image-generation", targets[0].ResolvedEndpointType)
	assert.Equal(t, "auto", targets[0].EndpointMode)
	for _, cacheEnabled := range []bool{false, true} {
		previous := common.MemoryCacheEnabled
		common.MemoryCacheEnabled = cacheEnabled
		InitChannelCache()
		assert.True(t, IsHubSupplyChannelRoutableForRequest(channel.Id, "custom-model", "/v1/images/generations"))
		assert.False(t, IsHubSupplyChannelRoutableForRequest(channel.Id, "custom-model", "/v1/chat/completions"))
		common.MemoryCacheEnabled = previous
	}
}

func TestHubProbeDisablingSchedulePreservesSuccessButDoesNotAuthorizeNewConfig(t *testing.T) {
	truncateTables(t)
	resetHubRoutingSnapshotsForTest(t)
	prices := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"custom-model":1}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(prices)) })
	group := &HubSupplyGroup{ProviderId: 1, PriceMultiplier: 1, PublishedModels: "custom-model"}
	channel := &Channel{Type: constant.ChannelTypeOpenAI, Key: "test", Models: "custom-model", Group: "default"}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	var target HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).First(&target).Error)
	_, _, err := RecordHubSupplyProbeResult(target.Id, true, 250, "", "", "openai-response")
	require.NoError(t, err)
	require.NoError(t, UpdateHubSupplyGroupModelAutoProbe(group.Id, "custom-model", false))
	require.NoError(t, DB.First(&target, target.Id).Error)
	assert.Positive(t, target.LastSuccessAt)
	assert.Zero(t, target.NextProbeAt)
	assert.Equal(t, []string{"custom-model"}, getChannelAbilityModels(t, channel.Id))
	_, _, err = RecordHubSupplyProbeResult(target.Id, true, 300, "", "", "openai-response")
	require.NoError(t, err)
	require.NoError(t, DB.First(&target, target.Id).Error)
	assert.Zero(t, target.NextProbeAt, "a manual test must not re-enable the periodic schedule")

	// The old runtime signal must not admit a model whose new connection has
	// never passed a probe, even when periodic probes are disabled.
	PublishHubRoutingRuntimeSignals(time.Now().Unix(), []HubRoutingRuntimeSignal{{
		ChannelID: channel.Id, ModelName: "custom-model", ProbeKind: HubSupplyProbeKindText,
		RealHealthState: HubRoutingRealHealthHealthy,
	}})
	require.NoError(t, DB.Model(group).Update("config_version", group.ConfigVersion+1).Error)
	require.NoError(t, EnsureHubSupplyGroupProbeTargets())
	assert.Empty(t, getChannelAbilityModels(t, channel.Id))
	availability, _, err := loadHubSupplyChannelProbeKinds(DB, []int{channel.Id})
	require.NoError(t, err)
	assert.False(t, hubSupplyChannelSupportsRequest(availability, channel.Id, "custom-model", "/v1/responses"))
}

func TestHubProbeRestoresDeletedDisabledTargetsOnlyFromCurrentSuccessfulSamples(t *testing.T) {
	truncateTables(t)
	resetHubRoutingSnapshotsForTest(t)
	prices := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"image-ok":1}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(prices)) })
	group := &HubSupplyGroup{ProviderId: 1, PriceMultiplier: 1,
		PublishedModels:         "image-ok,never-tested,old-config,failed",
		AutoProbeDisabledModels: "image-ok,never-tested,old-config,failed"}
	channel := &Channel{Type: constant.ChannelTypeOpenAI, Key: "test", Models: group.PublishedModels, Group: "default"}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	require.NoError(t, DB.Where("group_id = ?", group.Id).Delete(&HubSupplyGroupProbeTarget{}).Error)
	now := common.GetTimestamp()
	for _, sample := range []HubSupplyGroupProbeSample{
		{GroupId: group.Id, ConfigVersion: group.ConfigVersion, ModelName: "image-ok", EndpointType: "image-generation", ProbeKind: HubSupplyProbeKindImage, Success: true, ProbedAt: now - 20},
		{GroupId: group.Id, ConfigVersion: group.ConfigVersion - 1, ModelName: "old-config", EndpointType: "openai", ProbeKind: HubSupplyProbeKindText, Success: true, ProbedAt: now - 10},
		{GroupId: group.Id, ConfigVersion: group.ConfigVersion, ModelName: "failed", EndpointType: "openai", ProbeKind: HubSupplyProbeKindText, Success: false, ProbedAt: now - 5},
	} {
		require.NoError(t, DB.Create(&sample).Error)
	}
	require.NoError(t, EnsureHubSupplyGroupProbeTargets())
	require.NoError(t, EnsureHubSupplyGroupProbeTargets())
	targets, err := GetHubSupplyGroupProbeTargets(group.Id, group.ConfigVersion)
	require.NoError(t, err)
	require.Len(t, targets, 4)
	for _, target := range targets {
		assert.Zero(t, target.NextProbeAt)
		if target.ModelName == "image-ok" {
			assert.Equal(t, HubSupplyProbeKindImage, target.ProbeKind)
			assert.Equal(t, "image-generation", target.ResolvedEndpointType)
			assert.Equal(t, now-20, target.LastSuccessAt)
		} else {
			assert.Zero(t, target.LastSuccessAt)
		}
	}
	assert.Equal(t, []string{"image-ok"}, getChannelAbilityModels(t, channel.Id))
}

func TestHubProbeMetadataReadFailureDoesNotDeleteExistingTargets(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&Model{}))
	group := &HubSupplyGroup{ProviderId: 1, PriceMultiplier: 1, PublishedModels: "existing"}
	channel := &Channel{Type: constant.ChannelTypeOpenAI, Key: "test", Models: "existing", Group: "default"}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	var before HubSupplyGroupProbeTarget
	require.NoError(t, DB.Where("group_id = ?", group.Id).First(&before).Error)
	require.NoError(t, DB.Model(channel).Update("models", "existing,new-model").Error)
	failure := errors.New("metadata read failed")
	callbackName := "test:hub_metadata_read_failure"
	require.NoError(t, DB.Callback().Query().Before("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "models" {
			tx.AddError(failure)
		}
	}))
	t.Cleanup(func() { require.NoError(t, DB.Callback().Query().Remove(callbackName)) })
	require.ErrorIs(t, EnsureHubSupplyGroupProbeTargets(), failure)
	var after HubSupplyGroupProbeTarget
	require.NoError(t, DB.First(&after, before.Id).Error)
	assert.Equal(t, before, after)
}

func TestHubProbePersistsEveryBuiltInManualEndpoint(t *testing.T) {
	truncateTables(t)
	group := &HubSupplyGroup{ProviderId: 1, PriceMultiplier: 1}
	channel := &Channel{Type: constant.ChannelTypeNewAPI, Key: "test", Models: "custom-model", Group: "default"}
	require.NoError(t, CreateHubSupplyGroup(group, channel))
	for _, endpoint := range []string{"openai", "openai-response", "openai-response-compact", "anthropic", "gemini", "jina-rerank", "image-generation", "embeddings"} {
		t.Run(endpoint, func(t *testing.T) {
			require.NoError(t, UpdateHubSupplyGroupModelProbeEndpoint(group.Id, "custom-model", endpoint))
			stored, err := GetHubSupplyGroupByChannelID(channel.Id)
			require.NoError(t, err)
			assert.Equal(t, endpoint, stored.GetProbeEndpointMode("custom-model", channel.Models))
			targets, err := GetHubSupplyGroupProbeTargets(group.Id, group.ConfigVersion)
			require.NoError(t, err)
			require.Len(t, targets, 1)
			assert.Equal(t, endpoint, targets[0].EndpointType)
			assert.Equal(t, endpoint, targets[0].EndpointMode)
		})
	}
}
