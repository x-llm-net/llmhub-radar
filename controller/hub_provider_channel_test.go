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
package controller

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/setting/hub_provider_setting"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type hubProviderChannelAPIResponse struct {
	Success bool                       `json:"success"`
	Message string                     `json:"message"`
	Data    hubProviderChannelResponse `json:"data"`
}

func TestValidateHubSupplySettingsNormalizesToRoutingPrecision(t *testing.T) {
	req := &hubSupplySettingsRequest{
		PriceMultiplier:   5.5555,
		TextProbeMinutes:  10,
		ImageProbeMinutes: 30,
	}
	require.NoError(t, validateHubSupplySettings(req, nil))
	assert.Equal(t, 5.556, req.PriceMultiplier)
}

func TestValidateHubSupplySettingsRequiresExplicitMultiplierOnCreate(t *testing.T) {
	req := &hubSupplySettingsRequest{}
	require.ErrorContains(t, validateHubSupplySettings(req, nil), "price multiplier")
	assert.Equal(t, hubProviderChannelDefaultTextMinutes, req.TextProbeMinutes)
	assert.Equal(t, hubProviderChannelDefaultImageMinutes, req.ImageProbeMinutes)
}

func TestHubSupplyChannelPricingFeedsBillingMultiplier(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "priced supply",
		Models: "gpt-5", Group: "default", Status: common.ChannelStatusEnabled,
	}
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 0.4,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))

	pricing, err := helper.ApplyHubSupplyPricing(
		hosttypes.GroupRatioInfo{GroupRatio: 1.5},
		channel.Id,
	)
	require.NoError(t, err)
	assert.True(t, pricing.HasSupplyPricing)
	assert.InDelta(t, 1.5, pricing.BaseGroupRatio, 0.000001)
	assert.InDelta(t, 0.4, pricing.SupplyMultiplier, 0.000001)
	assert.InDelta(t, 0.6, pricing.GroupRatio, 0.000001)
	assert.Equal(t, group.Id, pricing.SupplyGroupId)
	assert.Equal(t, provider.Id, pricing.SupplyProviderId)

	retryChannel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "retry-secret", Name: "retry supply",
		Models: "gpt-5", Group: "default", Status: common.ChannelStatusEnabled,
	}
	retryGroup := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 0.9,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	require.NoError(t, model.CreateHubSupplyGroup(retryGroup, retryChannel))

	retryPricing, err := helper.ApplyHubSupplyPricing(
		hosttypes.GroupRatioInfo{GroupRatio: 1.5},
		retryChannel.Id,
	)
	require.NoError(t, err)
	assert.True(t, retryPricing.HasSupplyPricing)
	assert.InDelta(t, 1.5, retryPricing.BaseGroupRatio, 0.000001)
	assert.InDelta(t, 0.9, retryPricing.SupplyMultiplier, 0.000001)
	assert.InDelta(t, 1.35, retryPricing.GroupRatio, 0.000001)
	assert.Equal(t, retryGroup.Id, retryPricing.SupplyGroupId)
	assert.Equal(t, provider.Id, retryPricing.SupplyProviderId)
}

func TestCreateHubProviderChannelUsesNativeChannelConfiguration(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	seedVerifiedHubProviderOriginClaim(t, provider.Id, "https://upstream.example/v1")

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider/channels", map[string]any{
		"mode":           "multi_to_single",
		"multi_key_mode": "polling",
		"channel": map[string]any{
			"name": "Claude Pro", "type": constant.ChannelTypeOpenAI,
			"base_url": "https://upstream.example/v1", "key": "key-a\nkey-b",
			"models": "claude-sonnet-4,gpt-5", "group": "attacker-group",
			"priority": 999, "weight": 999, "status": common.ChannelStatusEnabled,
			"model_mapping":   `{"gpt-5":"gpt-5-upstream"}`,
			"header_override": `{"X-Supply":"yes"}`,
			"param_override":  `{"temperature":0}`,
			"setting":         `{"http_protocol":"http1"}`,
			"settings":        `{}`,
		},
		"supply": map[string]any{
			"price_multiplier": 0.8, "text_probe_minutes": 10, "image_probe_minutes": 30,
		},
	}, 42)
	CreateHubProviderChannel(ctx)

	var response struct {
		Success bool                         `json:"success"`
		Message string                       `json:"message"`
		Data    []hubProviderChannelResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	require.Len(t, response.Data, 1)
	assert.Empty(t, response.Data[0].Channel.Key)
	assert.Equal(t, 0.8, response.Data[0].Supply.PriceMultiplier)

	groups, err := model.GetHubSupplyGroupsByProviderID(provider.Id)
	require.NoError(t, err)
	require.Len(t, groups, 1)
	channel, err := model.GetChannelById(groups[0].NewAPIChannelId, true)
	require.NoError(t, err)
	assert.Equal(t, "Claude Pro", channel.Name)
	assert.Equal(t, "key-a\nkey-b", channel.Key)
	assert.Equal(t, "claude-sonnet-4,gpt-5", channel.Models)
	assert.Equal(t, "default", channel.Group)
	assert.Equal(t, int64(0), channel.GetPriority())
	assert.Equal(t, 0, channel.GetWeight())
	assert.Equal(t, common.ChannelStatusAutoDisabled, channel.Status)
	assert.True(t, channel.ChannelInfo.IsMultiKey)
	assert.Equal(t, 2, channel.ChannelInfo.MultiKeySize)
	assert.Equal(t, constant.MultiKeyModePolling, channel.ChannelInfo.MultiKeyMode)
	assert.Equal(t, `{"gpt-5":"gpt-5-upstream"}`, channel.GetModelMapping())
	assert.Equal(t, `{"X-Supply":"yes"}`, stringValue(channel.HeaderOverride))
	assert.Equal(t, `{"temperature":0}`, stringValue(channel.ParamOverride))
	assert.Equal(t, []string{"claude-sonnet-4", "gpt-5"}, response.Data[0].Supply.PublishedModels)

	var abilityCount int64
	require.NoError(t, model.DB.Model(&model.Ability{}).Where("channel_id = ?", channel.Id).Count(&abilityCount).Error)
	assert.Zero(t, abilityCount, "a new supply channel must not route before a successful probe")
	activeTask, err := model.GetActiveSystemTask(model.SystemTaskTypeHubSupplyProbe)
	require.NoError(t, err)
	require.NotNil(t, activeTask, "channel creation must enqueue the first probe run")
}

func TestPendingHubProviderCannotCreateChannel(t *testing.T) {
	require.NoError(t, i18n.Init())
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	require.NoError(t, model.DB.Model(&model.HubProvider{Id: provider.Id}).Update(
		"status", model.HubProviderStatusPending,
	).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider/channels", map[string]any{}, 42)
	CreateHubProviderChannel(ctx)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	var count int64
	require.NoError(t, model.DB.Model(&model.HubSupplyGroup{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestCreateHubProviderChannelRequiresVerifiedOriginClaim(t *testing.T) {
	require.NoError(t, i18n.Init())
	setupHubSupplyGroupControllerTestDB(t)
	seedHubProvider(t, 42)
	settings := hub_provider_setting.Get()
	originalEnabled := settings.OriginVerificationEnabled
	settings.OriginVerificationEnabled = true
	t.Cleanup(func() {
		settings.OriginVerificationEnabled = originalEnabled
	})

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider/channels", map[string]any{
		"mode": "single",
		"channel": map[string]any{
			"name": "Unverified upstream", "type": constant.ChannelTypeOpenAI,
			"base_url": "https://unverified.example/v1", "key": "secret",
			"models": "gpt-5", "setting": `{}`, "settings": `{}`,
		},
		"supply": map[string]any{
			"price_multiplier": 1, "text_probe_minutes": 10, "image_probe_minutes": 30,
		},
	}, 42)
	CreateHubProviderChannel(ctx)

	var response struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.Equal(t, hubProviderOriginRequiredCode, response.Code)
	assert.Equal(t, "Verify ownership of this custom upstream site before using it in a supply channel", response.Message)
	var count int64
	require.NoError(t, model.DB.Model(&model.HubSupplyGroup{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestCreateHubProviderChannelAllowsUnverifiedOriginWhenVerificationDisabled(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	seedHubProvider(t, 42)
	settings := hub_provider_setting.Get()
	originalEnabled := settings.OriginVerificationEnabled
	settings.OriginVerificationEnabled = false
	t.Cleanup(func() {
		settings.OriginVerificationEnabled = originalEnabled
	})

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider/channels", map[string]any{
		"mode": "single",
		"channel": map[string]any{
			"name": "Shared upstream", "type": constant.ChannelTypeOpenAI,
			"base_url": "https://shared.example/v1", "key": "secret",
			"models": "gpt-5", "setting": `{}`, "settings": `{}`,
		},
		"supply": map[string]any{
			"price_multiplier": 1, "text_probe_minutes": 10, "image_probe_minutes": 30,
		},
	}, 42)
	CreateHubProviderChannel(ctx)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success, recorder.Body.String())
	var count int64
	require.NoError(t, model.DB.Model(&model.HubSupplyGroup{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

func TestCreateHubProviderChannelRejectsProxy(t *testing.T) {
	require.NoError(t, i18n.Init())
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	seedVerifiedHubProviderOriginClaim(t, provider.Id, "https://upstream.example")

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider/channels", map[string]any{
		"mode": "single",
		"channel": map[string]any{
			"name": "Proxy supply", "type": constant.ChannelTypeOpenAI,
			"base_url": "https://upstream.example", "key": "secret", "models": "gpt-5",
			"setting": `{"proxy":"http://127.0.0.1:8080"}`, "settings": `{}`,
		},
		"supply": map[string]any{
			"price_multiplier": 1, "text_probe_minutes": 10, "image_probe_minutes": 30,
		},
	}, 42)
	CreateHubProviderChannel(ctx)

	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.Equal(t, "Provider supply channels cannot use a proxy", response.Message)
}

func TestCreateHubProviderChannelRejectsHostOverride(t *testing.T) {
	require.NoError(t, i18n.Init())
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	seedVerifiedHubProviderOriginClaim(t, provider.Id, "https://upstream.example")

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider/channels", map[string]any{
		"mode": "single",
		"channel": map[string]any{
			"name": "Host override supply", "type": constant.ChannelTypeOpenAI,
			"base_url": "https://upstream.example", "key": "secret", "models": "gpt-5",
			"header_override": `{"Host":"internal.example"}`, "setting": `{}`, "settings": `{}`,
		},
		"supply": map[string]any{
			"price_multiplier": 1, "text_probe_minutes": 10, "image_probe_minutes": 30,
		},
	}, 42)
	CreateHubProviderChannel(ctx)

	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.Equal(t, "Provider supply channels cannot override the Host header", response.Message)
}

func TestCreateHubProviderChannelRejectsUnsupportedType(t *testing.T) {
	require.NoError(t, i18n.Init())
	setupHubSupplyGroupControllerTestDB(t)
	seedHubProvider(t, 42)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider/channels", map[string]any{
		"mode": "single",
		"channel": map[string]any{
			"name": "Midjourney supply", "type": constant.ChannelTypeMidjourney,
			"key": "secret", "models": "midjourney", "setting": `{}`, "settings": `{}`,
		},
		"supply": map[string]any{
			"price_multiplier": 1, "text_probe_minutes": 10, "image_probe_minutes": 30,
		},
	}, 42)
	CreateHubProviderChannel(ctx)

	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.Equal(t, "Provider supply channels do not support Midjourney yet", response.Message)
}

func TestUpdateHubProviderChannelPreservesOwnershipAndLockedRoutingFields(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	seedHubProvider(t, 43)
	baseURL := "https://upstream.example"
	seedVerifiedHubProviderOriginClaim(t, provider.Id, baseURL)
	priority := int64(7)
	weight := uint(8)
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "existing-secret", Name: "Plus",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default",
		Priority: &priority, Weight: &weight, Status: common.ChannelStatusManuallyDisabled,
	}
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/channels/1", map[string]any{
		"name": "Plus Updated", "type": constant.ChannelTypeOpenAI,
		"base_url": baseURL, "models": "gpt-5,gpt-5-mini",
		"group": "forbidden", "priority": 999, "weight": 999,
		"status":        common.ChannelStatusEnabled,
		"model_mapping": `{"gpt-5-mini":"gpt-5-mini-upstream"}`,
		"setting":       `{}`, "settings": `{}`,
		"supply": map[string]any{
			"price_multiplier": 0.75, "text_probe_minutes": 30, "image_probe_minutes": 60,
		},
	}, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	UpdateHubProviderChannel(ctx)

	var response hubProviderChannelAPIResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, "Plus Updated", response.Data.Channel.Name)
	assert.Equal(t, 0.75, response.Data.Supply.PriceMultiplier)

	updatedChannel, err := model.GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, "existing-secret", updatedChannel.Key)
	assert.Equal(t, "gpt-5,gpt-5-mini", updatedChannel.Models)
	assert.Equal(t, "default", updatedChannel.Group)
	assert.Equal(t, int64(7), updatedChannel.GetPriority())
	assert.Equal(t, 8, updatedChannel.GetWeight())
	assert.Equal(t, common.ChannelStatusManuallyDisabled, updatedChannel.Status)
	assert.Equal(t, `{"gpt-5-mini":"gpt-5-mini-upstream"}`, updatedChannel.GetModelMapping())

	var targetCount int64
	updatedGroup, err := model.GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, updatedGroup)
	require.NoError(t, model.DB.Model(&model.HubSupplyGroupProbeTarget{}).
		Where("group_id = ? AND config_version = ?", group.Id, updatedGroup.ConfigVersion).Count(&targetCount).Error)
	assert.Equal(t, int64(2), targetCount)

	foreignCtx, foreignRecorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/channels/1", map[string]any{
		"name": "stolen", "type": constant.ChannelTypeOpenAI, "models": "gpt-5",
		"supply": map[string]any{"price_multiplier": 1, "text_probe_minutes": 10, "image_probe_minutes": 30},
	}, 43)
	foreignCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	UpdateHubProviderChannel(foreignCtx)
	var foreignResponse hubProviderChannelAPIResponse
	require.NoError(t, common.Unmarshal(foreignRecorder.Body.Bytes(), &foreignResponse))
	assert.False(t, foreignResponse.Success)
}

func TestUpdateHubProviderChannelAppendsMultiKeys(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	baseURL := "https://upstream.example"
	seedVerifiedHubProviderOriginClaim(t, provider.Id, baseURL)
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "key-a\nkey-b", Name: "Multi key",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default",
		Status: common.ChannelStatusManuallyDisabled,
		ChannelInfo: model.ChannelInfo{
			IsMultiKey: true, MultiKeySize: 2,
			MultiKeyMode: constant.MultiKeyModeRandom,
		},
	}
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/channels/1", map[string]any{
		"name": "Multi key", "type": constant.ChannelTypeOpenAI,
		"base_url": baseURL, "models": "gpt-5", "key": "key-b\nkey-c",
		"key_mode": "append", "multi_key_mode": "polling",
		"setting": `{}`, "settings": `{}`,
		"supply": map[string]any{
			"price_multiplier": 1, "text_probe_minutes": 10, "image_probe_minutes": 30,
		},
	}, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	UpdateHubProviderChannel(ctx)

	var response hubProviderChannelAPIResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	updatedChannel, err := model.GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, "key-a\nkey-b\nkey-c", updatedChannel.Key)
	assert.Equal(t, 3, updatedChannel.ChannelInfo.MultiKeySize)
	assert.Equal(t, constant.MultiKeyModePolling, updatedChannel.ChannelInfo.MultiKeyMode)
}

func TestDeleteHubProviderChannelCleansSupplyState(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	baseURL := "https://upstream.example"
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "Delete me",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default",
		Status: common.ChannelStatusManuallyDisabled,
	}
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))

	ctx, recorder := newAuthenticatedContext(t, http.MethodDelete, "/api/hub/provider/channels/1", nil, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	DeleteHubProviderChannel(ctx)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	var channelCount, groupCount, targetCount, revisionCount int64
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", channel.Id).Count(&channelCount).Error)
	require.NoError(t, model.DB.Model(&model.HubSupplyGroup{}).Where("id = ?", group.Id).Count(&groupCount).Error)
	require.NoError(t, model.DB.Model(&model.HubSupplyGroupProbeTarget{}).Where("group_id = ?", group.Id).Count(&targetCount).Error)
	require.NoError(t, model.DB.Model(&model.HubSupplyGroupRevision{}).Where("group_id = ?", group.Id).Count(&revisionCount).Error)
	assert.Zero(t, channelCount)
	assert.Zero(t, groupCount)
	assert.Zero(t, targetCount)
	assert.Zero(t, revisionCount)
}

func TestGetHubProviderChannelsPaginatesFiltersAndScopesOwnership(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	foreignProvider := seedHubProvider(t, 43)
	baseURL := "https://upstream.example"

	fixtures := []struct {
		providerID  int
		name        string
		channelType int
	}{
		{providerID: provider.Id, name: "Alpha", channelType: constant.ChannelTypeOpenAI},
		{providerID: provider.Id, name: "Beta", channelType: constant.ChannelTypeAnthropic},
		{providerID: provider.Id, name: "Gamma", channelType: constant.ChannelTypeOpenAI},
		{providerID: foreignProvider.Id, name: "External", channelType: constant.ChannelTypeOpenAI},
	}
	for _, fixture := range fixtures {
		group := &model.HubSupplyGroup{
			ProviderId: fixture.providerID, PriceMultiplier: 1,
			TextProbeMinutes: 10, ImageProbeMinutes: 30,
		}
		channel := &model.Channel{
			Type: fixture.channelType, Key: "secret", Name: fixture.name,
			BaseURL: &baseURL, Models: "shared-model", Group: "default",
			Status: common.ChannelStatusManuallyDisabled,
		}
		require.NoError(t, model.CreateHubSupplyGroup(group, channel))
		require.NoError(t, model.DB.Model(&model.HubSupplyGroup{Id: group.Id}).Update("status", model.HubSupplyGroupStatusAvailable).Error)
	}

	ctx, recorder := newAuthenticatedContext(
		t,
		http.MethodGet,
		"/api/hub/provider/channels?model=shared-model&status=available&type=1&sort_by=name&sort_order=asc&p=2&page_size=1",
		nil,
		42,
	)
	GetHubProviderChannels(ctx)

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items      []hubProviderChannelResponse `json:"items"`
			Total      int64                        `json:"total"`
			Page       int                          `json:"page"`
			PageSize   int                          `json:"page_size"`
			TypeCounts map[int]int64                `json:"type_counts"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, int64(2), response.Data.Total)
	assert.Equal(t, 2, response.Data.Page)
	assert.Equal(t, 1, response.Data.PageSize)
	require.Len(t, response.Data.Items, 1)
	assert.Equal(t, "Gamma", response.Data.Items[0].Channel.Name)
	assert.Equal(t, int64(2), response.Data.TypeCounts[constant.ChannelTypeOpenAI])
	assert.Equal(t, int64(1), response.Data.TypeCounts[constant.ChannelTypeAnthropic])

	foreignCtx, foreignRecorder := newAuthenticatedContext(
		t,
		http.MethodGet,
		"/api/hub/provider/channels?keyword=External",
		nil,
		42,
	)
	GetHubProviderChannels(foreignCtx)
	var foreignResponse struct {
		Success bool `json:"success"`
		Data    struct {
			Items []hubProviderChannelResponse `json:"items"`
			Total int64                        `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(foreignRecorder.Body.Bytes(), &foreignResponse))
	require.True(t, foreignResponse.Success, foreignRecorder.Body.String())
	assert.Zero(t, foreignResponse.Data.Total)
	assert.Empty(t, foreignResponse.Data.Items)
}
