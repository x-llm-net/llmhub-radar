package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDirectImageProbeRequiresImageResult(t *testing.T) {
	initModelListColumnNames(t)
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Log{}))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"probe-image-result":1}`))
	user := &model.User{
		Id: 9037, Username: "image-probe", Password: "unused", Role: common.RoleRootUser,
		Status: common.UserStatusEnabled, Group: "default", Quota: 1_000_000,
	}
	require.NoError(t, model.DB.Create(user).Error)

	cases := []struct {
		name    string
		body    string
		success bool
	}{
		{name: "empty object", body: `{}`},
		{name: "empty images", body: `{"data":[]}`},
		{name: "empty image item", body: `{"data":[{}]}`},
		{name: "blank image fields", body: `{"data":[{"b64_json":"  ","url":""}]}`},
		{name: "non-string image field", body: `{"data":[{"b64_json":123}]}`},
		{name: "invalid data shape", body: `{"data":{"b64_json":"aW1hZ2U="}}`},
		{name: "base64 result", body: `{"data":[{"b64_json":"aW1hZ2U="}]}`, success: true},
		{name: "URL result", body: `{"data":[{"url":"https://images.invalid/probe.png"}]}`, success: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var requests atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				assert.Equal(t, "/v1/images/generations", r.URL.Path)
				var request dto.ImageRequest
				assert.NoError(t, common.DecodeJson(r.Body, &request))
				assert.Equal(t, "probe-image-result", request.Model)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.body))
			}))
			t.Cleanup(upstream.Close)
			baseURL := upstream.URL
			channel := &model.Channel{
				Id: 9037, Type: constant.ChannelTypeOpenAI, Key: "unused", Name: "image-probe",
				BaseURL: &baseURL, Models: "probe-image-result", Group: "default", Status: common.ChannelStatusEnabled,
			}
			result := testChannel(context.Background(), channel, user.Id, "probe-image-result", string(constant.EndpointTypeImageGeneration), false)
			assert.Equal(t, int32(1), requests.Load())
			if tc.success {
				assert.NoError(t, result.localErr)
				assert.Nil(t, result.newAPIError)
			} else {
				require.ErrorContains(t, result.localErr, "image response does not contain")
				require.NotNil(t, result.newAPIError)
				assert.Equal(t, types.ErrorCodeBadResponseBody, result.newAPIError.GetErrorCode())
			}
		})
	}
}

func TestHubImageProbeDoesNotSwitchCodexToResponses(t *testing.T) {
	initModelListColumnNames(t)
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"probe-direct-image":1}`))
	user := &model.User{
		Id: 9038, Username: "codex-image-probe", Password: "unused", Role: common.RoleRootUser,
		Status: common.UserStatusEnabled, Group: "default", Quota: 1_000_000,
	}
	require.NoError(t, model.DB.Create(user).Error)
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	t.Cleanup(upstream.Close)
	baseURL := upstream.URL
	channel := &model.Channel{
		Id: 9038, Type: constant.ChannelTypeCodex, Key: "unused", Name: "codex-images-unsupported",
		BaseURL: &baseURL, Models: "probe-direct-image", Group: "default", Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, model.DB.Create(channel).Error)
	provider := seedHubProvider(t, user.Id)
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, NewAPIChannelId: channel.Id, ConfigVersion: 1,
		PublicId: "codex-image-probe", PriceMultiplier: 1, Status: model.HubSupplyGroupStatusTesting,
	}
	require.NoError(t, model.DB.Create(group).Error)
	target := &model.HubSupplyGroupProbeTarget{
		GroupId: group.Id, ConfigVersion: group.ConfigVersion, ModelName: "probe-direct-image",
		EndpointType: string(constant.EndpointTypeImageGeneration), ProbeKind: model.HubSupplyProbeKindImage,
		Status: model.HubSupplyProbeStatusTesting,
	}
	require.NoError(t, model.DB.Create(target).Error)
	result := executeHubSupplyProbe(context.Background(), model.HubSupplyProbeJob{
		TargetId: target.Id, GroupId: group.Id, ConfigVersion: group.ConfigVersion,
		NewAPIChannelId: channel.Id, ModelName: "probe-direct-image", ConfiguredModels: channel.Models,
		EndpointType: string(constant.EndpointTypeImageGeneration), ProbeKind: model.HubSupplyProbeKindImage,
	}, user.Id, 5*time.Second)
	assert.False(t, result.success)
	require.Error(t, result.err)
	assert.Equal(t, string(types.ErrorCodeChannelEndpointUnsupported), result.errorCode)
	assert.Zero(t, requests.Load(), "unsupported Images requests must not be rewritten as a Responses tool probe")
}

func TestResponsesProbeDoesNotRequireImageResult(t *testing.T) {
	request := buildTestRequest("probe-model", string(constant.EndpointTypeOpenAIResponse), &model.Channel{Type: constant.ChannelTypeOpenAI}, false)
	responses, ok := request.(*dto.OpenAIResponsesRequest)
	require.True(t, ok)
	assert.Empty(t, responses.Tools)
	assert.NoError(t, validateTestResponseBody([]byte(`{"output":[{"type":"message","content":[{"type":"output_text","text":"hi"}]}]}`), false, relayconstant.RelayModeResponses))
}
