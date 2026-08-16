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
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupHubSupplyGroupControllerTestDB(t *testing.T) {
	t.Helper()
	savedModelRatios := ratio_setting.ModelRatio2JSONString()
	ratio_setting.InitRatioSettings()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedModelRatios))
	})
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.HubProvider{},
		&model.HubProviderOriginClaim{},
		&model.Channel{},
		&model.Ability{},
		&model.HubSupplyGroup{},
		&model.HubSupplyGroupRevision{},
		&model.HubSupplyGroupProbeTarget{},
		&model.HubSupplyGroupProbeSample{},
		&model.SystemTask{},
		&model.SystemTaskLock{},
	))
}

func seedHubProvider(t *testing.T, ownerUserID int) *model.HubProvider {
	t.Helper()
	provider := &model.HubProvider{OwnerUserId: ownerUserID, Name: "Acme AI"}
	require.NoError(t, model.CreateHubProvider(provider))
	return provider
}

func seedVerifiedHubProviderOriginClaim(t *testing.T, providerID int, rawURL string) {
	t.Helper()
	origin, hostname, err := model.NormalizeHubProviderOrigin(rawURL)
	require.NoError(t, err)
	require.NoError(t, model.DB.Create(&model.HubProviderOriginClaim{
		ProviderId:         providerID,
		Origin:             origin,
		Hostname:           hostname,
		VerificationMethod: model.HubProviderOriginClaimMethodDNS,
		VerificationToken:  "verified-test-token",
		Status:             model.HubProviderOriginClaimStatusVerified,
		VerifiedAt:         common.GetTimestamp(),
	}).Error)
}

func TestHubSupplyPricingPreflightRejectsBeforeUpstreamRequest(t *testing.T) {
	initModelListColumnNames(t)
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))

	savedModelRatios := ratio_setting.ModelRatio2JSONString()
	savedSelfUseMode := operation_setting.SelfUseModeEnabled
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedModelRatios))
		operation_setting.SelfUseModeEnabled = savedSelfUseMode
	})
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString("{}"))
	operation_setting.SelfUseModeEnabled = false

	user := &model.User{
		Id: 9001, Username: "probe-root", Password: "not-used", Role: common.RoleRootUser,
		Status: 1, Group: "default", Quota: 1_000_000,
	}
	require.NoError(t, db.Create(user).Error)

	var upstreamRequests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		upstreamRequests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(upstream.Close)
	baseURL := upstream.URL
	channel := &model.Channel{
		Id: 77, Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "unpriced",
		BaseURL: &baseURL, Models: "hub-unpriced-model", Group: "default", Status: common.ChannelStatusEnabled,
	}

	result := testChannelPricingPreflight(
		context.Background(), channel, user.Id, "hub-unpriced-model", string(constant.EndpointTypeOpenAI),
	)
	require.Error(t, result.localErr)
	require.NotNil(t, result.newAPIError)
	assert.Equal(t, types.ErrorCodeModelPriceError, result.newAPIError.GetErrorCode())
	assert.Zero(t, upstreamRequests.Load())
}

func TestRunImmediateHubSupplyModelProbesInParallel(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Log{}))

	savedModelRatios := ratio_setting.ModelRatio2JSONString()
	savedSelfUseMode := operation_setting.SelfUseModeEnabled
	savedStreamingTimeout := constant.StreamingTimeout
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedModelRatios))
		operation_setting.SelfUseModeEnabled = savedSelfUseMode
		constant.StreamingTimeout = savedStreamingTimeout
	})
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"hub-direct-a":1,"hub-direct-b":1}`))
	operation_setting.SelfUseModeEnabled = false
	constant.StreamingTimeout = 30

	user := &model.User{
		Id: 9002, Username: "probe-root-parallel", Password: "not-used",
		Role: common.RoleRootUser, Status: 1, Group: "default", Quota: 1_000_000,
	}
	require.NoError(t, model.DB.Create(user).Error)

	var activeProbes atomic.Int32
	var maxActiveProbes atomic.Int32
	var totalProbes atomic.Int32
	originalExecutor := immediateHubSupplyProbeExecutor
	t.Cleanup(func() { immediateHubSupplyProbeExecutor = originalExecutor })
	immediateHubSupplyProbeExecutor = func(_ context.Context, job model.HubSupplyProbeJob, _ int, _ time.Duration) hubSupplyProbeResult {
		totalProbes.Add(1)
		active := activeProbes.Add(1)
		defer activeProbes.Add(-1)
		for {
			maximum := maxActiveProbes.Load()
			if active <= maximum || maxActiveProbes.CompareAndSwap(maximum, active) {
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
		return hubSupplyProbeResult{job: job, success: true, latencyMs: 100}
	}

	baseURL := "https://upstream.example"
	provider := seedHubProvider(t, 9002)
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 1,
		PublishedModels:  "hub-direct-a,hub-direct-b",
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "parallel",
		BaseURL: &baseURL, Models: "hub-direct-a,hub-direct-b", Group: "default",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))

	var workers sync.WaitGroup
	errors := make(chan error, 2)
	for _, modelName := range []string{"hub-direct-a", "hub-direct-b"} {
		workers.Add(1)
		go func(modelName string) {
			defer workers.Done()
			available, err := runImmediateHubSupplyModelProbe(context.Background(), group.Id, modelName)
			if err == nil && !available {
				err = fmt.Errorf("model %s did not become available", modelName)
			}
			errors <- err
		}(modelName)
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	assert.Equal(t, int32(2), totalProbes.Load())
	assert.GreaterOrEqual(t, maxActiveProbes.Load(), int32(2))
}

func TestAlternateHubSupplyOpenAIEndpointOnlyRetriesProtocolErrors(t *testing.T) {
	job := model.HubSupplyProbeJob{ProbeKind: model.HubSupplyProbeKindText}
	assert.Equal(t, string(constant.EndpointTypeOpenAIResponse), alternateHubSupplyOpenAIEndpoint(job, string(constant.EndpointTypeOpenAI), http.StatusBadRequest))
	assert.Equal(t, string(constant.EndpointTypeOpenAI), alternateHubSupplyOpenAIEndpoint(job, string(constant.EndpointTypeOpenAIResponse), http.StatusNotFound))
	assert.Empty(t, alternateHubSupplyOpenAIEndpoint(job, string(constant.EndpointTypeOpenAI), http.StatusUnauthorized))
	job.ProbeKind = model.HubSupplyProbeKindImage
	assert.Empty(t, alternateHubSupplyOpenAIEndpoint(job, string(constant.EndpointTypeOpenAI), http.StatusBadRequest))
	job.ProbeKind = model.HubSupplyProbeKindText
	job.EndpointMode = string(constant.EndpointTypeOpenAI)
	assert.Empty(t, alternateHubSupplyOpenAIEndpoint(job, string(constant.EndpointTypeOpenAI), http.StatusBadRequest))
}

func TestBuildOpenAIResponsesTestRequestUsesMinimalCompatibleInput(t *testing.T) {
	request := buildOpenAIResponsesTestRequest("gpt-responses-only", false)
	body, err := common.Marshal(request)
	require.NoError(t, err)
	assert.JSONEq(t, `{"model":"gpt-responses-only","input":"hi","max_output_tokens":16}`, string(body))
}

func TestChannelTestTTFTRecognizesTextAcrossSupportedStreamFormats(t *testing.T) {
	tests := map[string]string{
		"chat content":   `{"choices":[{"delta":{"content":"hello"}}]}`,
		"chat reasoning": `{"choices":[{"delta":{"reasoning_content":"thinking"}}]}`,
		"responses":      `{"type":"response.output_text.delta","delta":"hello"}`,
		"anthropic":      `{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}`,
		"gemini":         `{"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}`,
	}
	for name, payload := range tests {
		t.Run(name, func(t *testing.T) {
			assert.True(t, hasMeaningfulTestStreamDelta([]byte(payload)))
		})
	}
	assert.False(t, hasMeaningfulTestStreamDelta([]byte(`{"choices":[{"delta":{"role":"assistant"}}]}`)))
	assert.False(t, hasMeaningfulTestStreamDelta([]byte(`{"type":"response.created"}`)))
	assert.False(t, hasMeaningfulTestStreamDelta([]byte(`[DONE]`)))
}

func TestChannelTestTTFTTrackerHandlesSplitSSEFrames(t *testing.T) {
	tracker := newTestProbeTTFTTracker(time.Now())
	tracker.observe([]byte("data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n"))
	assert.Nil(t, tracker.value())

	tracker.observe([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hel"))
	assert.Nil(t, tracker.value())
	tracker.observe([]byte("lo\"}}]}\n\n"))
	assert.NotNil(t, tracker.value())
}

func TestHubSupplyProbeStreamsOnlyTextGenerationEndpoints(t *testing.T) {
	textJob := model.HubSupplyProbeJob{ModelName: "gpt-5", ProbeKind: model.HubSupplyProbeKindText}
	assert.True(t, shouldStreamHubSupplyProbe(textJob, string(constant.EndpointTypeOpenAI)))
	assert.True(t, shouldStreamHubSupplyProbe(textJob, string(constant.EndpointTypeOpenAIResponse)))

	textJob.ModelName = "text-embedding-3-small"
	assert.False(t, shouldStreamHubSupplyProbe(textJob, string(constant.EndpointTypeEmbeddings)))
	imageJob := model.HubSupplyProbeJob{ModelName: "gpt-image-1", ProbeKind: model.HubSupplyProbeKindImage}
	assert.False(t, shouldStreamHubSupplyProbe(imageJob, string(constant.EndpointTypeImageGeneration)))
	compactJob := model.HubSupplyProbeJob{ModelName: "gpt-5-compact", ProbeKind: model.HubSupplyProbeKindText}
	assert.False(t, shouldStreamHubSupplyProbe(compactJob, string(constant.EndpointTypeOpenAIResponseCompact)))
}

func TestChannelTestResponseForLogOmitsImagesAndTruncatesText(t *testing.T) {
	imageBody := []byte("image-data")
	assert.Equal(t, "[image response omitted, 10 bytes]", channelTestResponseForLog(imageBody, relayconstant.RelayModeImagesGenerations))

	textBody := []byte(strings.Repeat("a", channelTestResponseLogLimit+10))
	formatted := channelTestResponseForLog(textBody, relayconstant.RelayModeChatCompletions)
	assert.Contains(t, formatted, "[response truncated, 4106 bytes total]")
	assert.Less(t, len(formatted), len(textBody)+100)
}

func TestGetHubProviderChannelProbesReturnsModelLevelRouteState(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	baseURL := "https://upstream.example"
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 1, PublishedModels: "gpt-5",
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "mixed",
		BaseURL: &baseURL, Models: "gpt-5,gpt-5-mini", Group: "default",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))

	var successfulTarget model.HubSupplyGroupProbeTarget
	require.NoError(t, model.DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").First(&successfulTarget).Error)
	firstTokenMs := int64(180)
	_, _, err := model.RecordHubSupplyProbeResultWithTTFT(successfulTarget.Id, true, 750, &firstTokenMs, "", "", "")
	require.NoError(t, err)

	partialCtx, partialRecorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/provider/channels/1/probes", nil, 42)
	partialCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	GetHubProviderChannelProbes(partialCtx)
	var partialResponse struct {
		Success bool                            `json:"success"`
		Data    hubProviderChannelProbeResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(partialRecorder.Body.Bytes(), &partialResponse))
	require.True(t, partialResponse.Success, partialRecorder.Body.String())
	assert.Equal(t, channel.Id, partialResponse.Data.ChannelId)
	assert.True(t, partialResponse.Data.Running)
	assert.Equal(t, model.HubSupplyProbeStatusAvailable, partialResponse.Data.Models[0].Status)
	assert.Equal(t, model.HubSupplyProbeStatusPending, partialResponse.Data.Models[1].Status)

	var failedTarget model.HubSupplyGroupProbeTarget
	require.NoError(t, model.DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5-mini").First(&failedTarget).Error)
	_, _, err = model.RecordHubSupplyProbeResult(failedTarget.Id, false, 1200, "model price missing", "model_price_error", "")
	require.NoError(t, err)
	require.NoError(t, model.ReconcileHubSupplyGroupRouteState(group.Id))

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/provider/channels/1/probes", nil, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	GetHubProviderChannelProbes(ctx)
	var response struct {
		Success bool                            `json:"success"`
		Data    hubProviderChannelProbeResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	require.Len(t, response.Data.Models, 2)
	assert.True(t, response.Data.Models[0].Published)
	assert.True(t, response.Data.Models[0].Online)
	assert.Equal(t, int64(750), response.Data.Models[0].Endpoints[0].LastLatencyMs)
	assert.Equal(t, &firstTokenMs, response.Data.Models[0].Endpoints[0].LastFirstTokenMs)
	assert.False(t, response.Data.Models[1].Published)
	assert.False(t, response.Data.Models[1].Online)
	assert.Equal(t, model.HubSupplyProbeStatusError, response.Data.Models[1].Status)
	assert.Equal(t, "model_price_error", response.Data.Models[1].Endpoints[0].LastErrorCode)
	var storedSample model.HubSupplyGroupProbeSample
	require.NoError(t, model.DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").First(&storedSample).Error)
	assert.Equal(t, &firstTokenMs, storedSample.FirstTokenMs)
}

func TestHubProviderModelAutoProbeSwitchReturnsSkippedState(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	baseURL := "https://upstream.example"
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 1, PublishedModels: "compact",
		AutoProbeDisabledModels: "compact", TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "compact supply",
		BaseURL: &baseURL, Models: "compact", Group: "default", Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))
	require.NoError(t, model.ReconcileHubSupplyGroupRouteState(group.Id))

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/provider/channels/1/probes", nil, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	GetHubProviderChannelProbes(ctx)
	var response struct {
		Success bool                            `json:"success"`
		Data    hubProviderChannelProbeResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	require.Len(t, response.Data.Models, 1)
	assert.False(t, response.Data.Models[0].AutoProbeEnabled)
	assert.Equal(t, model.HubSupplyProbeStatusSkipped, response.Data.Models[0].Status)
	assert.True(t, response.Data.Models[0].Online)

	updateCtx, updateRecorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/channels/1/model-auto-probe", map[string]any{
		"model_name": "compact", "enabled": true,
	}, 42)
	updateCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	UpdateHubProviderChannelModelAutoProbe(updateCtx)
	var updateResponse struct {
		Success bool `json:"success"`
		Data    struct {
			AutoProbeEnabled bool `json:"auto_probe_enabled"`
			Online           bool `json:"online"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(updateRecorder.Body.Bytes(), &updateResponse))
	require.True(t, updateResponse.Success, updateRecorder.Body.String())
	assert.True(t, updateResponse.Data.AutoProbeEnabled)
	assert.False(t, updateResponse.Data.Online)
}

func TestUpdateHubProviderChannelModelPublicationChecksOwnershipAndRouteState(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	seedHubProvider(t, 43)
	baseURL := "https://upstream.example"
	group := &model.HubSupplyGroup{ProviderId: provider.Id, PriceMultiplier: 1, TextProbeMinutes: 10, ImageProbeMinutes: 30}
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "manual-listing",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default", Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))
	var target model.HubSupplyGroupProbeTarget
	require.NoError(t, model.DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").First(&target).Error)
	_, _, err := model.RecordHubSupplyProbeResult(target.Id, true, 650, "", "", "")
	require.NoError(t, err)
	require.NoError(t, model.ReconcileHubSupplyGroupRouteState(group.Id))

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/channels/1/model-publication", map[string]any{
		"model_name": "gpt-5", "published": true,
	}, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	UpdateHubProviderChannelModelPublication(ctx)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Published bool `json:"published"`
			Online    bool `json:"online"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.True(t, response.Data.Published)
	assert.True(t, response.Data.Online)

	foreignCtx, foreignRecorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/channels/1/model-publication", map[string]any{
		"model_name": "gpt-5", "published": false,
	}, 43)
	foreignCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	UpdateHubProviderChannelModelPublication(foreignCtx)
	var foreignResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(foreignRecorder.Body.Bytes(), &foreignResponse))
	assert.False(t, foreignResponse.Success)

	updatedGroup, err := model.GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	assert.Equal(t, []string{"gpt-5"}, updatedGroup.GetPublishedModels(channel.Models))
}

func TestUpdateHubProviderChannelModelsPublicationChecksBatchAndOwnership(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	seedHubProvider(t, 43)
	baseURL := "https://upstream.example"
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 0.8,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "batch-listing",
		BaseURL: &baseURL, Models: "gpt-5,gpt-5-mini", Group: "default",
		Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))
	var target model.HubSupplyGroupProbeTarget
	require.NoError(t, model.DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").First(&target).Error)
	_, _, err := model.RecordHubSupplyProbeResult(target.Id, true, 650, "", "", "")
	require.NoError(t, err)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/channels/1/model-publication/batch", map[string]any{
		"model_names": []string{"gpt-5", "gpt-5-mini"}, "published": true,
	}, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	UpdateHubProviderChannelModelsPublication(ctx)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			ModelNames          []string `json:"model_names"`
			PublishedModelCount int      `json:"published_model_count"`
			OnlineModelCount    int      `json:"online_model_count"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, response.Data.ModelNames)
	assert.Equal(t, 2, response.Data.PublishedModelCount)
	assert.Equal(t, 1, response.Data.OnlineModelCount)
	var abilityModels []string
	require.NoError(t, model.DB.Model(&model.Ability{}).
		Where("channel_id = ? AND enabled = ?", channel.Id, true).
		Distinct("model").Order("model ASC").Pluck("model", &abilityModels).Error)
	assert.Equal(t, []string{"gpt-5"}, abilityModels)

	invalidCtx, invalidRecorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/channels/1/model-publication/batch", map[string]any{
		"model_names": []string{"gpt-5", "not-configured"}, "published": false,
	}, 42)
	invalidCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	UpdateHubProviderChannelModelsPublication(invalidCtx)
	var invalidResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(invalidRecorder.Body.Bytes(), &invalidResponse))
	assert.False(t, invalidResponse.Success)

	foreignCtx, foreignRecorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/channels/1/model-publication/batch", map[string]any{
		"model_names": []string{"gpt-5", "gpt-5-mini"}, "published": false,
	}, 43)
	foreignCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	UpdateHubProviderChannelModelsPublication(foreignCtx)
	var foreignResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(foreignRecorder.Body.Bytes(), &foreignResponse))
	assert.False(t, foreignResponse.Success)

	updatedGroup, err := model.GetHubSupplyGroupByChannelID(channel.Id)
	require.NoError(t, err)
	assert.Equal(t, []string{"gpt-5", "gpt-5-mini"}, updatedGroup.GetPublishedModels(channel.Models))
}

func TestUpdateHubProviderChannelModelProbeEndpointWaitsForManualTest(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	var upstreamRequests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		upstreamRequests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(upstream.Close)

	baseURL := upstream.URL
	group := &model.HubSupplyGroup{ProviderId: provider.Id, PriceMultiplier: 1, TextProbeMinutes: 10, ImageProbeMinutes: 30}
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "manual-endpoint",
		BaseURL: &baseURL, Models: "gpt-5.6-luna", Group: "default", Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/channels/1/probe-model-endpoint", map[string]any{
		"model_name": "gpt-5.6-luna", "endpoint_type": string(constant.EndpointTypeOpenAIResponse),
	}, 42)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	UpdateHubProviderChannelModelProbeEndpoint(ctx)

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			ModelStatus string `json:"model_status"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, model.HubSupplyProbeStatusWaiting, response.Data.ModelStatus)
	assert.Zero(t, upstreamRequests.Load())

	probeCtx, probeRecorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/provider/channels/1/probes", nil, 42)
	probeCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channel.Id)}}
	GetHubProviderChannelProbes(probeCtx)
	var probeResponse struct {
		Success bool                            `json:"success"`
		Data    hubProviderChannelProbeResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(probeRecorder.Body.Bytes(), &probeResponse))
	require.True(t, probeResponse.Success, probeRecorder.Body.String())
	assert.False(t, probeResponse.Data.Running)
	require.Len(t, probeResponse.Data.Models, 1)
	assert.Equal(t, model.HubSupplyProbeStatusWaiting, probeResponse.Data.Models[0].Status)
}

func TestExcludeHubSupplyChannelsUsesOwnershipDataNotNames(t *testing.T) {
	channels := []*model.Channel{
		{Id: 1, Name: "normal"},
		{Id: 2, Name: "provider channel without prefix"},
		{Id: 3, Name: "hub:ordinary-channel"},
	}
	filtered := excludeHubSupplyChannels(channels, map[int]struct{}{2: {}})
	require.Len(t, filtered, 2)
	assert.Equal(t, []int{1, 3}, []int{filtered[0].Id, filtered[1].Id})
}
