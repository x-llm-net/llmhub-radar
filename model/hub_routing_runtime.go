package model

import (
	"strings"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

const (
	HubRoutingRealHealthUnknown     = "unknown"
	HubRoutingRealHealthHealthy     = "healthy"
	HubRoutingRealHealthDegraded    = "degraded"
	HubRoutingRealHealthUnhealthy   = "unhealthy"
	HubRoutingRealHealthQuarantined = "quarantined"

	HubRoutingRuntimeSnapshotMaxAgeSeconds = int64(3 * 60)
	HubRoutingFactorNeutralBps             = 10_000
	HubRoutingLatencyFactorFloorBps        = 2_000
)

type HubRoutingRuntimeSignal struct {
	ChannelID                   int    `json:"channel_id"`
	ModelName                   string `json:"model_name"`
	ProbeKind                   string `json:"probe_kind"`
	RealHealthState             string `json:"real_health_state"`
	RealWindowStartedAt         int64  `json:"real_window_started_at"`
	RealSampleCount             int64  `json:"real_sample_count"`
	RealSuccessRateBps          int    `json:"real_success_rate_bps"`
	PreviousRealWindowStartedAt int64  `json:"previous_real_window_started_at"`
	PreviousRealSampleCount     int64  `json:"previous_real_sample_count"`
	PreviousRealSuccessRateBps  int    `json:"previous_real_success_rate_bps"`
	ConsecutiveUnhealthyWindows int    `json:"consecutive_unhealthy_windows"`
	RealAvailabilityFactorBps   int    `json:"real_availability_factor_bps"`
	RealFirstTokenSampleCount   int64  `json:"real_first_token_sample_count"`
	RealFirstTokenP50Ms         *int64 `json:"real_first_token_p50_ms"`
	RealFirstTokenP95Ms         *int64 `json:"real_first_token_p95_ms"`
	RealFirstTokenScoreBps      int    `json:"real_first_token_score_bps"`
	GeneratedAt                 int64  `json:"generated_at"`
}

type HubRoutingProbeSignal struct {
	ChannelID           int
	ModelName           string
	ProbeKind           string
	Routable            bool
	ConsecutiveFailures int
	LastFirstTokenMs    *int64
}

type HubRoutingDecision struct {
	RuntimeSignal              HubRoutingRuntimeSignal
	HasRuntimeSignal           bool
	HasProbeSignal             bool
	ProbeRoutable              bool
	ProbeFailures              int
	HardUnavailable            bool
	ProbeAvailabilityFactorBps int
	AvailabilityFactorBps      int
	ProbeLatencyScoreBps       int
	RealLatencyScoreBps        int
	LatencyFactorBps           int
}

type hubRoutingRuntimeKey struct {
	channelID int
	modelName string
	probeKind string
}

type hubRoutingRuntimeSnapshot struct {
	generatedAt int64
	signals     map[hubRoutingRuntimeKey]HubRoutingRuntimeSignal
}

type hubRoutingProbeSnapshot struct {
	signals map[hubRoutingRuntimeKey]HubRoutingProbeSignal
}

var hubRoutingRuntimeSnapshotValue atomic.Pointer[hubRoutingRuntimeSnapshot]
var hubRoutingProbeSnapshotValue atomic.Pointer[hubRoutingProbeSnapshot]

func NormalizeHubRoutingRuntimeModelName(modelName string) string {
	modelName = strings.TrimSpace(modelName)
	if normalized := strings.TrimSpace(ratio_setting.FormatMatchingModelName(modelName)); normalized != "" {
		return normalized
	}
	return modelName
}

func PublishHubRoutingRuntimeSignals(generatedAt int64, signals []HubRoutingRuntimeSignal) {
	if generatedAt <= 0 {
		generatedAt = time.Now().Unix()
	}
	published := &hubRoutingRuntimeSnapshot{
		generatedAt: generatedAt,
		signals:     make(map[hubRoutingRuntimeKey]HubRoutingRuntimeSignal, len(signals)),
	}
	for _, signal := range signals {
		key := newHubRoutingRuntimeKey(signal.ChannelID, signal.ModelName, signal.ProbeKind)
		if key.channelID <= 0 || key.modelName == "" || key.probeKind == "" {
			continue
		}
		signal.ModelName = key.modelName
		signal.ProbeKind = key.probeKind
		signal.GeneratedAt = generatedAt
		published.signals[key] = cloneHubRoutingRuntimeSignal(signal)
	}
	hubRoutingRuntimeSnapshotValue.Store(published)
}

func PublishHubRoutingProbeSignals(signals []HubRoutingProbeSignal) {
	published := &hubRoutingProbeSnapshot{signals: make(map[hubRoutingRuntimeKey]HubRoutingProbeSignal, len(signals))}
	initialized := make(map[hubRoutingRuntimeKey]bool, len(signals))
	for _, signal := range signals {
		key := newHubRoutingRuntimeKey(signal.ChannelID, signal.ModelName, signal.ProbeKind)
		if key.channelID <= 0 || key.modelName == "" || key.probeKind == "" {
			continue
		}
		signal.ModelName = key.modelName
		signal.ProbeKind = key.probeKind
		if current, ok := published.signals[key]; ok && initialized[key] {
			current.Routable = current.Routable && signal.Routable
			if signal.ConsecutiveFailures > current.ConsecutiveFailures {
				current.ConsecutiveFailures = signal.ConsecutiveFailures
			}
			if signal.LastFirstTokenMs != nil && (current.LastFirstTokenMs == nil || *signal.LastFirstTokenMs > *current.LastFirstTokenMs) {
				value := *signal.LastFirstTokenMs
				current.LastFirstTokenMs = &value
			}
			published.signals[key] = current
			continue
		}
		if signal.LastFirstTokenMs != nil {
			value := *signal.LastFirstTokenMs
			signal.LastFirstTokenMs = &value
		}
		published.signals[key] = signal
		initialized[key] = true
	}
	hubRoutingProbeSnapshotValue.Store(published)
}

func GetHubRoutingRuntimeSignal(channelID int, modelName, requestPath string) (HubRoutingRuntimeSignal, bool) {
	snapshot := hubRoutingRuntimeSnapshotValue.Load()
	if snapshot == nil || snapshot.generatedAt <= 0 || time.Now().Unix()-snapshot.generatedAt > HubRoutingRuntimeSnapshotMaxAgeSeconds {
		return HubRoutingRuntimeSignal{}, false
	}
	signal, ok := snapshot.signals[newHubRoutingRuntimeKey(channelID, modelName, hubSupplyProbeKindForRequestPath(requestPath))]
	if !ok {
		return HubRoutingRuntimeSignal{}, false
	}
	return cloneHubRoutingRuntimeSignal(signal), true
}

func GetHubRoutingDecision(channelID int, modelName, requestPath string) HubRoutingDecision {
	decision := HubRoutingDecision{
		AvailabilityFactorBps: HubRoutingFactorNeutralBps,
		ProbeLatencyScoreBps:  HubRoutingFactorNeutralBps,
		RealLatencyScoreBps:   HubRoutingFactorNeutralBps,
		LatencyFactorBps:      HubRoutingFactorNeutralBps,
	}
	key := newHubRoutingRuntimeKey(channelID, modelName, hubSupplyProbeKindForRequestPath(requestPath))
	if probes := hubRoutingProbeSnapshotValue.Load(); probes != nil {
		if probe, ok := probes.signals[key]; ok {
			decision.HasProbeSignal = true
			decision.ProbeRoutable = probe.Routable
			decision.ProbeFailures = probe.ConsecutiveFailures
			if probe.LastFirstTokenMs != nil {
				decision.ProbeLatencyScoreBps = hubRoutingTTFTScoreBps(probe.LastFirstTokenMs, probe.LastFirstTokenMs)
			}
		}
	}
	if runtimeSignal, ok := GetHubRoutingRuntimeSignal(channelID, modelName, requestPath); ok {
		decision.RuntimeSignal = runtimeSignal
		decision.HasRuntimeSignal = true
		if runtimeSignal.RealFirstTokenSampleCount >= 20 {
			decision.RealLatencyScoreBps = runtimeSignal.RealFirstTokenScoreBps
		}
	}

	probeAvailability := HubRoutingFactorNeutralBps
	if decision.HasProbeSignal {
		switch {
		case !decision.ProbeRoutable:
			probeAvailability = 0
		case decision.ProbeFailures == 1:
			probeAvailability = 7_000
		}
	}
	decision.ProbeAvailabilityFactorBps = probeAvailability
	realAvailability := HubRoutingFactorNeutralBps
	if decision.HasRuntimeSignal && decision.RuntimeSignal.RealAvailabilityFactorBps > 0 {
		realAvailability = decision.RuntimeSignal.RealAvailabilityFactorBps
	}
	if decision.HasRuntimeSignal && decision.RuntimeSignal.RealHealthState == HubRoutingRealHealthHealthy {
		decision.AvailabilityFactorBps = HubRoutingFactorNeutralBps
	} else {
		decision.AvailabilityFactorBps = minHubRoutingFactor(probeAvailability, realAvailability)
	}
	if decision.HasRuntimeSignal && decision.RuntimeSignal.RealHealthState == HubRoutingRealHealthQuarantined {
		decision.HardUnavailable = true
		decision.AvailabilityFactorBps = 0
	} else if decision.HasProbeSignal && !decision.ProbeRoutable &&
		(!decision.HasRuntimeSignal || decision.RuntimeSignal.RealHealthState != HubRoutingRealHealthHealthy) {
		decision.HardUnavailable = true
		decision.AvailabilityFactorBps = 0
	}

	realConfidenceBps := 0
	if decision.HasRuntimeSignal && decision.RuntimeSignal.RealFirstTokenSampleCount >= 20 {
		realConfidenceBps = int(decision.RuntimeSignal.RealFirstTokenSampleCount * 100)
		if realConfidenceBps > HubRoutingFactorNeutralBps {
			realConfidenceBps = HubRoutingFactorNeutralBps
		}
	}
	realAdjusted := HubRoutingFactorNeutralBps +
		(decision.RealLatencyScoreBps-HubRoutingFactorNeutralBps)*realConfidenceBps/HubRoutingFactorNeutralBps
	decision.LatencyFactorBps = (decision.ProbeLatencyScoreBps*70 + realAdjusted*30 + 50) / 100
	if decision.LatencyFactorBps < HubRoutingLatencyFactorFloorBps {
		decision.LatencyFactorBps = HubRoutingLatencyFactorFloorBps
	}
	return decision
}

func CalculateHubRoutingEffectiveWeight(baseWeight, availabilityFactorBps, latencyFactorBps int) int {
	if baseWeight <= 0 || availabilityFactorBps <= 0 || latencyFactorBps <= 0 {
		return 0
	}
	effective := int((int64(baseWeight)*int64(availabilityFactorBps)*int64(latencyFactorBps) + 50_000_000) / 100_000_000)
	if effective == 0 {
		return 1
	}
	return effective
}

func HubRoutingRuntimeHealthy(channelID int, modelName, probeKind string) bool {
	snapshot := hubRoutingRuntimeSnapshotValue.Load()
	if snapshot == nil || snapshot.generatedAt <= 0 || time.Now().Unix()-snapshot.generatedAt > HubRoutingRuntimeSnapshotMaxAgeSeconds {
		return false
	}
	signal, ok := snapshot.signals[newHubRoutingRuntimeKey(channelID, modelName, probeKind)]
	return ok && signal.RealHealthState == HubRoutingRealHealthHealthy
}

func hubRoutingTTFTScoreBps(p50Ms, p95Ms *int64) int {
	p50 := hubRoutingLatencyScoreBps(p50Ms, 10_000)
	p95 := hubRoutingLatencyScoreBps(p95Ms, 20_000)
	return (p50*2 + p95 + 1) / 3
}

func hubRoutingLatencyScoreBps(value *int64, zeroAtMs int64) int {
	if value == nil || *value < 0 || zeroAtMs <= 0 {
		return HubRoutingFactorNeutralBps
	}
	score := int((zeroAtMs - *value) * HubRoutingFactorNeutralBps / zeroAtMs)
	if score < 0 {
		return 0
	}
	if score > HubRoutingFactorNeutralBps {
		return HubRoutingFactorNeutralBps
	}
	return score
}

func newHubRoutingRuntimeKey(channelID int, modelName, probeKind string) hubRoutingRuntimeKey {
	return hubRoutingRuntimeKey{
		channelID: channelID,
		modelName: NormalizeHubRoutingRuntimeModelName(modelName),
		probeKind: strings.TrimSpace(probeKind),
	}
}

func cloneHubRoutingRuntimeSignal(signal HubRoutingRuntimeSignal) HubRoutingRuntimeSignal {
	if signal.RealFirstTokenP50Ms != nil {
		value := *signal.RealFirstTokenP50Ms
		signal.RealFirstTokenP50Ms = &value
	}
	if signal.RealFirstTokenP95Ms != nil {
		value := *signal.RealFirstTokenP95Ms
		signal.RealFirstTokenP95Ms = &value
	}
	return signal
}

func minHubRoutingFactor(left, right int) int {
	if left < right {
		return left
	}
	return right
}
