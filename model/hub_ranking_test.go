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
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCalculateHubRankingScoreUsesLegacyWeights(t *testing.T) {
	p50 := int64(900)
	p95 := int64(1_800)

	assert.Equal(t, 9_785, calculateHubRankingScoreBps(9_900, &p50, &p95, 700, 56, 0))
	assert.Less(t, calculateHubRankingScoreBps(9_900, ptrInt64(5_000), ptrInt64(12_000), 700, 56, 0), 9_785)
}

func TestCalculateHubRankingScoreWithoutTTFTUsesAvailabilityAndConfidence(t *testing.T) {
	assert.Equal(t, 9_800, calculateHubRankingScoreBps(10_000, nil, nil, 350, 28, 0))
}

func TestHubRankingConfidenceUsesRoundedLegacyFormula(t *testing.T) {
	assert.Equal(t, 8_000, hubRankingConfidenceBps(350, 28))
	assert.Equal(t, 10_000, hubRankingConfidenceBps(700, 56))
	assert.Equal(t, 10_000, hubRankingConfidenceBps(1_400, 112))
}

func TestHubRankingPausePenaltyRampsToTenPercent(t *testing.T) {
	asOf := int64(1_800_000_000)
	assert.Equal(t, 500, hubRankingPausePenaltyBps(asOf-3*24*60*60-12*60*60, asOf))
	assert.Equal(t, 1_000, hubRankingPausePenaltyBps(asOf-8*24*60*60, asOf))
}

func TestHubRankingExcludesQuotaAndConfigurationSamples(t *testing.T) {
	assert.False(t, isHubRankingSample(hubRankingSample{ErrorCode: "insufficient_quota"}))
	assert.False(t, isHubRankingSample(hubRankingSample{ErrorCode: "model_price_error"}))
	assert.False(t, isHubRankingSample(hubRankingSample{ErrorCode: "bad_response", ErrorMessage: "invalid_api_key"}))
	assert.False(t, isHubRankingSample(hubRankingSample{ErrorCode: "hub_probe_observer_error"}))
	assert.True(t, isHubRankingSample(hubRankingSample{ErrorCode: "bad_response"}))
}

func TestHubRankingValidBucketsRequireEightyPercentOfExpectedProbes(t *testing.T) {
	var samples [hubRankingBucketCount]int
	var expected [hubRankingBucketCount]int
	expected[0] = 10
	expected[1] = 10
	samples[0] = 8
	samples[1] = 7

	assert.Equal(t, 1, hubRankingValidBucketCount(samples, expected))
	assert.Equal(t, 18, hubRankingExpectedSamplesForBucket(0, 3*60*60, 0, 10))
	assert.Equal(t, 3, hubRankingExpectedSamplesForBucket(0, 3*60*60, 150*60, 10))
}

func TestHubRankingQuotaPauseStartsAtLeadingQuotaFailure(t *testing.T) {
	assert.Equal(t, int64(1_799_999_400), hubRankingQuotaPauseStartedAt([]hubRankingSample{
		{ErrorCode: "insufficient_quota", ProbedAt: 1_799_999_900},
		{ErrorCode: "insufficient balance", ProbedAt: 1_799_999_400},
		{Success: true, ProbedAt: 1_799_998_800},
	}))
}

func TestHubRankingAggregatePauseStartsWhenLastSupplyPauses(t *testing.T) {
	assert.Equal(t, int64(1_799_999_700), hubRankingAllSuppliesPausedSince([][]hubRankingSample{
		{{ErrorCode: "insufficient_quota", ProbedAt: 1_799_999_100}},
		{{ErrorCode: "insufficient_quota", ProbedAt: 1_799_999_700}},
	}))
	assert.Zero(t, hubRankingAllSuppliesPausedSince([][]hubRankingSample{
		{{ErrorCode: "insufficient_quota", ProbedAt: 1_799_999_100}},
		{{Success: true, ProbedAt: 1_799_999_700}},
	}))
}

func ptrInt64(value int64) *int64 {
	return &value
}
