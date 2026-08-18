package perfmetrics

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

const (
	hubRoutingRuntimeMinHealthSamples = int64(20)
	hubRoutingRuntimeMinTTFTSamples   = int64(20)
	hubRoutingRuntimeTTFTMinutes      = int64(15)
)

type hubRoutingRuntimeKey struct {
	channelID int
	modelName string
	probeKind string
}

type hubRoutingRuntimeAggregate struct {
	current       hubRoutingWindowCounters
	previous      hubRoutingWindowCounters
	ttftHistogram [hubRoutingHistogramBucketCount]int64
}

func refreshHubRoutingRuntimeSignals(nowTs int64) error {
	signals, err := buildHubRoutingRuntimeSignals(nowTs)
	if err != nil {
		return err
	}
	model.PublishHubRoutingRuntimeSignals(nowTs, signals)
	return nil
}

func buildHubRoutingRuntimeSignals(nowTs int64) ([]model.HubRoutingRuntimeSignal, error) {
	currentMinute := hubRoutingWindowBucketStart(nowTs)
	currentWindowStart := currentMinute - hubRoutingWindowBucketSeconds
	previousWindowStart := currentWindowStart - hubRoutingWindowBucketSeconds
	ttftStart := currentWindowStart - (hubRoutingRuntimeTTFTMinutes-1)*hubRoutingWindowBucketSeconds

	merged := make(map[hubRoutingWindowBucketKey]hubRoutingWindowCounters)
	hubRoutingWindowBuckets.Range(func(key, value any) bool {
		bucketKey := key.(hubRoutingWindowBucketKey)
		if bucketKey.bucketTs >= ttftStart && bucketKey.bucketTs <= currentWindowStart {
			merged[bucketKey] = value.(*hubRoutingWindowAtomicBucket).snapshot()
		}
		return true
	})
	if err := mergeHubRoutingWindowRedisChecked(merged, HubRoutingMetricQueryParams{}, ttftStart, currentWindowStart); err != nil {
		return nil, err
	}

	aggregates := make(map[hubRoutingRuntimeKey]hubRoutingRuntimeAggregate)
	for key, counters := range merged {
		runtimeKey := hubRoutingRuntimeKey{
			channelID: key.channelID,
			modelName: model.NormalizeHubRoutingRuntimeModelName(key.modelName),
			probeKind: hubRoutingRuntimeProbeKind(key.endpointType),
		}
		if runtimeKey.channelID <= 0 || runtimeKey.modelName == "" {
			continue
		}
		aggregate := aggregates[runtimeKey]
		switch key.bucketTs {
		case currentWindowStart:
			mergeHubRoutingWindowCounters(&aggregate.current, counters)
		case previousWindowStart:
			mergeHubRoutingWindowCounters(&aggregate.previous, counters)
		}
		mergeHubRoutingHistogram(&aggregate.ttftHistogram, counters.ttftHistogram)
		aggregates[runtimeKey] = aggregate
	}

	signals := make([]model.HubRoutingRuntimeSignal, 0, len(aggregates))
	for key, aggregate := range aggregates {
		currentRate := hubRoutingRuntimeRateBps(aggregate.current.switchableSuccessCount, aggregate.current.switchableRequestCount)
		previousRate := hubRoutingRuntimeRateBps(aggregate.previous.switchableSuccessCount, aggregate.previous.switchableRequestCount)
		currentState := hubRoutingRuntimeHealthState(aggregate.current.switchableRequestCount, currentRate)
		previousState := hubRoutingRuntimeHealthState(aggregate.previous.switchableRequestCount, previousRate)
		consecutiveUnhealthy := 0
		if currentState == model.HubRoutingRealHealthUnhealthy {
			consecutiveUnhealthy = 1
			if previousState == model.HubRoutingRealHealthUnhealthy {
				consecutiveUnhealthy = 2
				currentState = model.HubRoutingRealHealthQuarantined
			}
		}
		availabilityFactor := hubRoutingRuntimeAvailabilityFactor(currentState, currentRate)
		ttftCount := hubRoutingHistogramCount(aggregate.ttftHistogram)
		p50 := hubRoutingHistogramPercentile(aggregate.ttftHistogram, 50)
		p95 := hubRoutingHistogramPercentile(aggregate.ttftHistogram, 95)
		ttftScore := model.HubRoutingFactorNeutralBps
		if ttftCount >= hubRoutingRuntimeMinTTFTSamples {
			ttftScore = hubRoutingRuntimeTTFTScoreBps(p50, p95)
		}
		signals = append(signals, model.HubRoutingRuntimeSignal{
			ChannelID: key.channelID, ModelName: key.modelName, ProbeKind: key.probeKind,
			RealHealthState:             currentState,
			RealWindowStartedAt:         currentWindowStart,
			RealSampleCount:             aggregate.current.switchableRequestCount,
			RealSuccessRateBps:          currentRate,
			PreviousRealWindowStartedAt: previousWindowStart,
			PreviousRealSampleCount:     aggregate.previous.switchableRequestCount,
			PreviousRealSuccessRateBps:  previousRate,
			ConsecutiveUnhealthyWindows: consecutiveUnhealthy,
			RealAvailabilityFactorBps:   availabilityFactor,
			RealFirstTokenSampleCount:   ttftCount,
			RealFirstTokenP50Ms:         p50,
			RealFirstTokenP95Ms:         p95,
			RealFirstTokenScoreBps:      ttftScore,
			GeneratedAt:                 nowTs,
		})
	}
	return signals, nil
}

func hubRoutingRuntimeProbeKind(endpointType string) string {
	if endpointType == string(constant.EndpointTypeImageGeneration) {
		return model.HubSupplyProbeKindImage
	}
	return model.HubSupplyProbeKindText
}

func mergeHubRoutingWindowCounters(target *hubRoutingWindowCounters, source hubRoutingWindowCounters) {
	target.requestCount += source.requestCount
	target.successCount += source.successCount
	target.switchableRequestCount += source.switchableRequestCount
	target.switchableSuccessCount += source.switchableSuccessCount
	for index := range hubRoutingFailureClassCount {
		target.failureCounts[index] += source.failureCounts[index]
	}
	mergeHubRoutingHistogram(&target.latencyHistogram, source.latencyHistogram)
	mergeHubRoutingHistogram(&target.ttftHistogram, source.ttftHistogram)
}

func hubRoutingRuntimeRateBps(successCount, requestCount int64) int {
	if requestCount <= 0 {
		return 0
	}
	return int((successCount*10_000 + requestCount/2) / requestCount)
}

func hubRoutingRuntimeHealthState(sampleCount int64, successRateBps int) string {
	if sampleCount < hubRoutingRuntimeMinHealthSamples {
		return model.HubRoutingRealHealthUnknown
	}
	if successRateBps >= 9_500 {
		return model.HubRoutingRealHealthHealthy
	}
	if successRateBps >= 8_000 {
		return model.HubRoutingRealHealthDegraded
	}
	return model.HubRoutingRealHealthUnhealthy
}

func hubRoutingRuntimeAvailabilityFactor(state string, successRateBps int) int {
	switch state {
	case model.HubRoutingRealHealthDegraded:
		return successRateBps
	case model.HubRoutingRealHealthUnhealthy:
		if successRateBps < 2_500 {
			return 2_500
		}
		return successRateBps
	case model.HubRoutingRealHealthQuarantined:
		return 0
	default:
		return model.HubRoutingFactorNeutralBps
	}
}

func hubRoutingRuntimeTTFTScoreBps(p50Ms, p95Ms *int64) int {
	p50 := hubRoutingRuntimeLatencyScoreBps(p50Ms, 10_000)
	p95 := hubRoutingRuntimeLatencyScoreBps(p95Ms, 20_000)
	return (p50*2 + p95 + 1) / 3
}

func hubRoutingRuntimeLatencyScoreBps(value *int64, zeroAtMs int64) int {
	if value == nil || *value < 0 {
		return model.HubRoutingFactorNeutralBps
	}
	score := int((zeroAtMs - *value) * 10_000 / zeroAtMs)
	if score < 0 {
		return 0
	}
	if score > 10_000 {
		return 10_000
	}
	return score
}

func hubRoutingRuntimeRefreshLoop() {
	if err := refreshHubRoutingRuntimeSignals(time.Now().Unix()); err != nil {
		common.SysError("failed to refresh Hub routing runtime signals: " + err.Error())
	}
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for now := range ticker.C {
		if err := refreshHubRoutingRuntimeSignals(now.Unix()); err != nil {
			common.SysError("failed to refresh Hub routing runtime signals: " + err.Error())
		}
	}
}
