package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func resetHubRoutingSnapshotsForTest(t *testing.T) {
	t.Helper()
	PublishHubRoutingProbeSignals(nil)
	PublishHubRoutingRuntimeSignals(time.Now().Unix(), nil)
	t.Cleanup(func() {
		PublishHubRoutingProbeSignals(nil)
		PublishHubRoutingRuntimeSignals(time.Now().Unix(), nil)
	})
}

func TestHubRoutingDecisionCombinesProbeAndRealHealth(t *testing.T) {
	now := time.Now().Unix()
	t.Cleanup(func() {
		PublishHubRoutingProbeSignals(nil)
		PublishHubRoutingRuntimeSignals(time.Now().Unix(), nil)
	})
	PublishHubRoutingProbeSignals([]HubRoutingProbeSignal{
		{ChannelID: 1, ModelName: "gpt-runtime", ProbeKind: HubSupplyProbeKindText, Routable: true, ConsecutiveFailures: 1},
		{ChannelID: 2, ModelName: "gpt-runtime", ProbeKind: HubSupplyProbeKindText, Routable: false, ConsecutiveFailures: 2},
	})
	PublishHubRoutingRuntimeSignals(now, []HubRoutingRuntimeSignal{
		{ChannelID: 1, ModelName: "gpt-runtime", ProbeKind: HubSupplyProbeKindText, RealHealthState: HubRoutingRealHealthDegraded, RealAvailabilityFactorBps: 9_000},
		{ChannelID: 2, ModelName: "gpt-runtime", ProbeKind: HubSupplyProbeKindText, RealHealthState: HubRoutingRealHealthHealthy, RealAvailabilityFactorBps: 10_000},
	})

	degraded := GetHubRoutingDecision(1, "gpt-runtime", "/v1/chat/completions")
	assert.False(t, degraded.HardUnavailable)
	assert.Equal(t, 7_000, degraded.AvailabilityFactorBps)

	overridden := GetHubRoutingDecision(2, "gpt-runtime", "/v1/chat/completions")
	assert.False(t, overridden.HardUnavailable)
	assert.Equal(t, 10_000, overridden.AvailabilityFactorBps)

	PublishHubRoutingRuntimeSignals(now, []HubRoutingRuntimeSignal{
		{ChannelID: 2, ModelName: "gpt-runtime", ProbeKind: HubSupplyProbeKindText, RealHealthState: HubRoutingRealHealthQuarantined},
	})
	quarantined := GetHubRoutingDecision(2, "gpt-runtime", "/v1/chat/completions")
	assert.True(t, quarantined.HardUnavailable)
	assert.Zero(t, quarantined.AvailabilityFactorBps)
}

func TestHubRoutingDecisionWeightsTTFTByConfidence(t *testing.T) {
	now := time.Now().Unix()
	probeTTFT := int64(2_000)
	realP50 := int64(5_000)
	realP95 := int64(10_000)
	t.Cleanup(func() {
		PublishHubRoutingProbeSignals(nil)
		PublishHubRoutingRuntimeSignals(time.Now().Unix(), nil)
	})
	PublishHubRoutingProbeSignals([]HubRoutingProbeSignal{
		{ChannelID: 3, ModelName: "claude-runtime", ProbeKind: HubSupplyProbeKindText, Routable: true, LastFirstTokenMs: &probeTTFT},
	})
	PublishHubRoutingRuntimeSignals(now, []HubRoutingRuntimeSignal{
		{
			ChannelID: 3, ModelName: "claude-runtime", ProbeKind: HubSupplyProbeKindText,
			RealHealthState: HubRoutingRealHealthHealthy, RealAvailabilityFactorBps: 10_000,
			RealFirstTokenSampleCount: 100, RealFirstTokenP50Ms: &realP50, RealFirstTokenP95Ms: &realP95,
			RealFirstTokenScoreBps: hubRoutingTTFTScoreBps(&realP50, &realP95),
		},
	})
	decision := GetHubRoutingDecision(3, "claude-runtime", "/v1/messages")
	assert.Equal(t, 8_333, decision.ProbeLatencyScoreBps)
	assert.Equal(t, 5_000, decision.RealLatencyScoreBps)
	assert.Equal(t, 7_333, decision.LatencyFactorBps)
}

func TestHubRoutingDecisionTreatsExpiredRuntimeSnapshotAsNeutral(t *testing.T) {
	t.Cleanup(func() {
		PublishHubRoutingProbeSignals(nil)
		PublishHubRoutingRuntimeSignals(time.Now().Unix(), nil)
	})
	PublishHubRoutingProbeSignals([]HubRoutingProbeSignal{
		{ChannelID: 4, ModelName: "gemini-runtime", ProbeKind: HubSupplyProbeKindText, Routable: true},
	})
	PublishHubRoutingRuntimeSignals(time.Now().Unix()-HubRoutingRuntimeSnapshotMaxAgeSeconds-1, []HubRoutingRuntimeSignal{
		{
			ChannelID: 4, ModelName: "gemini-runtime", ProbeKind: HubSupplyProbeKindText,
			RealHealthState: HubRoutingRealHealthQuarantined, RealAvailabilityFactorBps: 0,
		},
	})

	decision := GetHubRoutingDecision(4, "gemini-runtime", "/v1/chat/completions")
	assert.False(t, decision.HasRuntimeSignal)
	assert.False(t, decision.HardUnavailable)
	assert.Equal(t, HubRoutingFactorNeutralBps, decision.AvailabilityFactorBps)
}

func TestSelectHubTierProviderChannelSkipsHardUnavailableCandidate(t *testing.T) {
	selected := selectHubTierProviderChannel([]hubTierChannelCandidate{
		{ChannelID: 1, Priority: 100, Weight: 100, HardUnavailable: true},
		{ChannelID: 2, Priority: 10, Weight: 0, AvailabilityFactorBps: 5_000, LatencyFactorBps: 5_000},
	})
	assert.Equal(t, 2, selected)
}
