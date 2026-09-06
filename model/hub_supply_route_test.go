package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
)

func TestHubSupplyProbeKindForModelRequest(t *testing.T) {
	tests := []struct {
		name     string
		model    string
		path     string
		expected string
	}{
		{name: "images endpoint", model: "gpt-5", path: "/v1/images/generations", expected: HubSupplyProbeKindImage},
		{name: "codex image responses", model: "gpt-image-2", path: "/v1/responses", expected: HubSupplyProbeKindImage},
		{name: "codex image responses compact", model: "gpt-image-2", path: "/v1/responses/compact", expected: HubSupplyProbeKindImage},
		{name: "image model without path", model: "gpt-image-2", path: "", expected: HubSupplyProbeKindImage},
		{name: "text responses", model: "gpt-5", path: "/v1/responses", expected: HubSupplyProbeKindText},
		{name: "text chat", model: "claude-sonnet-5", path: "/v1/chat/completions", expected: HubSupplyProbeKindText},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, hubSupplyProbeKindForModelRequest(tt.model, tt.path))
		})
	}
}

func TestHubSupplyRoutingUsesImageProbeForCodexImageResponses(t *testing.T) {
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = originalMemoryCacheEnabled })
	now := time.Now().Unix()
	PublishHubRoutingProbeSignals([]HubRoutingProbeSignal{
		{ChannelID: 91, ModelName: "gpt-image-2", ProbeKind: HubSupplyProbeKindImage, Routable: true},
	})
	PublishHubRoutingRuntimeSignals(now, []HubRoutingRuntimeSignal{
		{ChannelID: 91, ModelName: "gpt-image-2", ProbeKind: HubSupplyProbeKindImage, RealHealthState: HubRoutingRealHealthHealthy},
	})
	t.Cleanup(func() {
		PublishHubRoutingProbeSignals(nil)
		PublishHubRoutingRuntimeSignals(time.Now().Unix(), nil)
	})

	decision := GetHubRoutingDecision(91, "gpt-image-2", "/v1/responses")
	assert.True(t, decision.HasProbeSignal)
	assert.True(t, decision.ProbeRoutable)
	assert.True(t, decision.HasRuntimeSignal)
	assert.Equal(t, HubRoutingRealHealthHealthy, decision.RuntimeSignal.RealHealthState)
	assert.False(t, decision.HardUnavailable)

	availability := hubSupplyChannelProbeKinds{
		91: {"gpt-image-2": {HubSupplyProbeKindImage: true}},
	}
	assert.True(t, hubSupplyChannelSupportsRequest(availability, 91, "gpt-image-2", "/v1/responses"))
	assert.False(t, hubSupplyChannelSupportsRequest(availability, 91, "gpt-image-2", "/v1/chat/completions"))
	PublishHubRoutingRuntimeSignals(now, nil)
	textOnly := hubSupplyChannelProbeKinds{
		91: {"gpt-image-2": {HubSupplyProbeKindText: true}},
	}
	assert.False(t, hubSupplyChannelSupportsRequest(textOnly, 91, "gpt-image-2", "/v1/responses"))
}

func TestHubSupplyRoutingHonorsManualTextProbeOverrideForImageModel(t *testing.T) {
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = originalMemoryCacheEnabled })
	PublishHubRoutingProbeSignals([]HubRoutingProbeSignal{
		{ChannelID: 92, ModelName: "gpt-image-2", ProbeKind: HubSupplyProbeKindText, Routable: true},
	})
	t.Cleanup(func() { PublishHubRoutingProbeSignals(nil) })

	availability := hubSupplyChannelProbeKinds{
		92: {"gpt-image-2": {HubSupplyProbeKindText: true}},
	}
	assert.True(t, hubSupplyChannelSupportsRequest(availability, 92, "gpt-image-2", "/v1/responses"))
}

func TestHubSupplyProbeRecoveryDelayUsesModelAwareProbeKind(t *testing.T) {
	assert.Equal(t, 30*60, int(HubSupplyProbeRecoveryDelaySecondsForModelRequest("gpt-image-2", "/v1/responses", 30)))
	assert.Equal(t, 10*60, int(HubSupplyProbeRecoveryDelaySecondsForModelRequest("gpt-5", "/v1/responses", 10)))
}
