package perfmetrics

import (
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildHubRoutingRuntimeSignalsUsesCompletedMinuteWindows(t *testing.T) {
	hubRoutingWindowBuckets = sync.Map{}
	t.Cleanup(func() { hubRoutingWindowBuckets = sync.Map{} })
	now := int64(1_800_000_030)
	currentMinute := hubRoutingWindowBucketStart(now)
	currentWindow := currentMinute - 60
	previousWindow := currentWindow - 60

	recordRuntimeAttempts("gpt-runtime", 11, previousWindow+10, 10, 10, nil)
	recordRuntimeAttempts("gpt-runtime", 11, currentWindow+10, 19, 1, ptrRuntimeInt64(1_500))
	// The active minute must not turn the last completed minute into a second
	// unhealthy signal, even if refresh runs more than once during that minute.
	recordRuntimeAttempts("gpt-runtime", 11, currentMinute+10, 0, 100, nil)

	signals, err := buildHubRoutingRuntimeSignals(now)
	require.NoError(t, err)
	require.Len(t, signals, 1)
	signal := signals[0]
	assert.Equal(t, model.HubRoutingRealHealthHealthy, signal.RealHealthState)
	assert.Equal(t, int64(20), signal.RealSampleCount)
	assert.Equal(t, 9_500, signal.RealSuccessRateBps)
	assert.Equal(t, 0, signal.ConsecutiveUnhealthyWindows)
	assert.Equal(t, int64(19), signal.RealFirstTokenSampleCount)
	assert.Equal(t, model.HubRoutingFactorNeutralBps, signal.RealFirstTokenScoreBps)
}

func TestBuildHubRoutingRuntimeSignalsQuarantinesTwoConsecutiveUnhealthyMinutes(t *testing.T) {
	hubRoutingWindowBuckets = sync.Map{}
	t.Cleanup(func() { hubRoutingWindowBuckets = sync.Map{} })
	now := int64(1_800_000_030)
	currentWindow := hubRoutingWindowBucketStart(now) - 60
	previousWindow := currentWindow - 60

	recordRuntimeAttempts("claude-runtime", 12, previousWindow+5, 15, 5, ptrRuntimeInt64(2_000))
	recordRuntimeAttempts("claude-runtime", 12, currentWindow+5, 15, 5, ptrRuntimeInt64(3_000))

	signals, err := buildHubRoutingRuntimeSignals(now)
	require.NoError(t, err)
	require.Len(t, signals, 1)
	assert.Equal(t, model.HubRoutingRealHealthQuarantined, signals[0].RealHealthState)
	assert.Equal(t, 2, signals[0].ConsecutiveUnhealthyWindows)
	assert.Zero(t, signals[0].RealAvailabilityFactorBps)
	assert.Equal(t, int64(30), signals[0].RealFirstTokenSampleCount)
}

func TestHubRoutingRuntimeHealthThresholds(t *testing.T) {
	assert.Equal(t, model.HubRoutingRealHealthUnknown, hubRoutingRuntimeHealthState(19, 10_000))
	assert.Equal(t, model.HubRoutingRealHealthHealthy, hubRoutingRuntimeHealthState(20, 9_500))
	assert.Equal(t, model.HubRoutingRealHealthDegraded, hubRoutingRuntimeHealthState(20, 9_499))
	assert.Equal(t, model.HubRoutingRealHealthDegraded, hubRoutingRuntimeHealthState(20, 8_000))
	assert.Equal(t, model.HubRoutingRealHealthUnhealthy, hubRoutingRuntimeHealthState(20, 7_999))
}

func recordRuntimeAttempts(modelName string, channelID int, timestamp int64, successes, failures int, ttft *int64) {
	for index := 0; index < successes; index++ {
		recordHubRoutingWindow(HubRoutingAttempt{
			Model: modelName, EndpointType: "openai", ChannelID: channelID,
			Success: true, HealthEligible: true, LatencyMS: 1_000, FirstTokenMS: ttft,
		}, timestamp)
	}
	for index := 0; index < failures; index++ {
		recordHubRoutingWindow(HubRoutingAttempt{
			Model: modelName, EndpointType: "openai", ChannelID: channelID,
			FailureClass: "upstream", HealthEligible: true, LatencyMS: 1_000,
		}, timestamp)
	}
}

func ptrRuntimeInt64(value int64) *int64 {
	return &value
}
