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
	"sort"
	"strings"
)

const (
	hubRankingBucketCount       = 56
	hubRankingMinSamples        = 4
	hubRankingMinBucketCoverage = 8_000
	hubRankingSampleFullCount   = 700
	hubRankingP50ZeroMs         = int64(10_000)
	hubRankingP95ZeroMs         = int64(20_000)
	hubRankingConfidenceFloor   = 6_000
	hubRankingConfidenceRange   = 4_000
	hubRankingPausePenaltyMax   = 1_000
	hubRankingPauseFullAfterSec = int64(7 * 24 * 60 * 60)
)

type hubRankingSample struct {
	Success      bool
	LatencyMs    int64
	FirstTokenMs *int64
	ErrorCode    string
	ErrorMessage string
	ProbedAt     int64
}

func hubRankingPercentile(values []int64, percentile int) *int64 {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	index := (percentile*len(sorted)+99)/100 - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	value := sorted[index]
	return &value
}

func hubRankingRoundRatio(numerator, denominator int64) int {
	if numerator <= 0 || denominator <= 0 {
		return 0
	}
	return int((numerator + denominator/2) / denominator)
}

func hubRankingLatencyScoreBps(latencyMs *int64, zeroAtMs int64) int {
	if latencyMs == nil || *latencyMs < 0 || zeroAtMs <= 0 {
		return 0
	}
	score := hubRankingRoundRatio((zeroAtMs-*latencyMs)*10_000, zeroAtMs)
	if score < 0 {
		return 0
	}
	if score > 10_000 {
		return 10_000
	}
	return score
}

func hubRankingConfidenceBps(sampleCount, validBucketCount int) int {
	if sampleCount < 0 {
		sampleCount = 0
	}
	if validBucketCount < 0 {
		validBucketCount = 0
	}
	sampleScore := hubRankingRoundRatio(int64(sampleCount)*10_000, hubRankingSampleFullCount)
	if sampleScore > 10_000 {
		sampleScore = 10_000
	}
	bucketScore := hubRankingRoundRatio(int64(validBucketCount)*10_000, hubRankingBucketCount)
	if bucketScore > 10_000 {
		bucketScore = 10_000
	}
	raw := hubRankingRoundRatio(int64(sampleScore*4+bucketScore*6), 10)
	return hubRankingConfidenceFloor + hubRankingRoundRatio(int64(raw*hubRankingConfidenceRange), 10_000)
}

func calculateHubRankingScoreBps(availabilityBps int, firstTokenP50Ms, firstTokenP95Ms *int64, sampleCount, validBucketCount, pausePenaltyBps int) int {
	confidence := hubRankingConfidenceBps(sampleCount, validBucketCount)
	var raw int
	if firstTokenP50Ms == nil || firstTokenP95Ms == nil {
		// Image, embedding and other non-stream probes have no TTFT. Keep their
		// ranking meaningful instead of treating a missing metric as zero speed.
		raw = hubRankingRoundRatio(int64(availabilityBps*90+confidence*10), 100)
	} else {
		p50 := hubRankingLatencyScoreBps(firstTokenP50Ms, hubRankingP50ZeroMs)
		p95 := hubRankingLatencyScoreBps(firstTokenP95Ms, hubRankingP95ZeroMs)
		raw = hubRankingRoundRatio(int64(availabilityBps*80+p50*10+p95*5+confidence*5), 100)
	}
	if pausePenaltyBps < 0 {
		pausePenaltyBps = 0
	}
	score := raw - pausePenaltyBps
	if score < 0 {
		return 0
	}
	if score > 10_000 {
		return 10_000
	}
	return score
}

func hubRankingPausePenaltyBps(pausedSince, asOf int64) int {
	if pausedSince <= 0 || asOf <= pausedSince {
		return 0
	}
	penalty := hubRankingRoundRatio((asOf-pausedSince)*hubRankingPausePenaltyMax, hubRankingPauseFullAfterSec)
	if penalty > hubRankingPausePenaltyMax {
		return hubRankingPausePenaltyMax
	}
	return penalty
}

func hubRankingExpectedSamplesForBucket(bucketStart, bucketEnd, activeAt int64, intervalMinutes int) int {
	if bucketEnd <= bucketStart || activeAt >= bucketEnd || intervalMinutes <= 0 {
		return 0
	}
	if activeAt < bucketStart {
		activeAt = bucketStart
	}
	intervalSeconds := int64(intervalMinutes * 60)
	duration := bucketEnd - activeAt
	return int((duration + intervalSeconds - 1) / intervalSeconds)
}

func hubRankingValidBucketCount(sampleCounts, expectedCounts [hubRankingBucketCount]int) int {
	valid := 0
	for index, expected := range expectedCounts {
		if expected <= 0 {
			continue
		}
		if int64(sampleCounts[index])*10_000 >= int64(expected)*hubRankingMinBucketCoverage {
			valid++
		}
	}
	return valid
}

func isHubQuotaProbeSample(sample hubRankingSample) bool {
	text := strings.ToLower(sample.ErrorCode + " " + sample.ErrorMessage)
	for _, signal := range []string{
		"insufficient_quota", "insufficient quota", "quota exceeded",
		"exceeded your current quota", "billing",
		"insufficient_balance", "insufficient balance", "balance exhausted",
		"insufficient account balance", "account balance insufficient",
		"not enough balance", "no balance", "balance is 0",
		"insufficient credit", "not enough credit", "no credit", "credits exhausted",
		"recharge", "top up", "余额不足", "余额为0", "余额为 0",
		"可用余额", "额度不足", "欠费", "充值",
	} {
		if strings.Contains(text, signal) {
			return true
		}
	}
	return false
}

func isHubConfigurationSample(sample hubRankingSample) bool {
	switch strings.ToLower(strings.TrimSpace(sample.ErrorCode)) {
	case "model_price_error", "invalid_api_type", "gen_relay_info_failed",
		"json_marshal_failed", "convert_request_failed", "bad_request_body",
		"read_request_body_failed", "channel:model_mapped_error",
		"channel:param_override_invalid", "channel:header_override_invalid",
		"hub_probe_observer_error":
		return true
	}
	text := strings.ToLower(sample.ErrorCode + " " + sample.ErrorMessage)
	for _, signal := range []string{
		"invalid_api_key", "authentication_error", "incorrect api key",
		"invalid api key", "unauthorized", "model_not_found", "model not found",
		"model does not exist", "模型不存在",
	} {
		if strings.Contains(text, signal) {
			return true
		}
	}
	return false
}

func isHubRankingSample(sample hubRankingSample) bool {
	return !isHubQuotaProbeSample(sample) && !isHubConfigurationSample(sample)
}

func hubRankingQuotaPauseStartedAt(samples []hubRankingSample) int64 {
	if len(samples) == 0 {
		return 0
	}
	sorted := append([]hubRankingSample(nil), samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ProbedAt > sorted[j].ProbedAt })
	if !isHubQuotaProbeSample(sorted[0]) {
		return 0
	}
	pausedSince := sorted[0].ProbedAt
	for _, sample := range sorted {
		if !isHubQuotaProbeSample(sample) {
			break
		}
		pausedSince = sample.ProbedAt
	}
	return pausedSince
}

func hubRankingAllSuppliesPausedSince(groupSamples [][]hubRankingSample) int64 {
	if len(groupSamples) == 0 {
		return 0
	}
	pausedSince := int64(0)
	for _, samples := range groupSamples {
		groupPausedSince := hubRankingQuotaPauseStartedAt(samples)
		if groupPausedSince == 0 {
			return 0
		}
		if groupPausedSince > pausedSince {
			pausedSince = groupPausedSince
		}
	}
	return pausedSince
}
