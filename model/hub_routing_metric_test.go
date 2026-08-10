package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpsertHubRoutingMetricAggregatesSameBucket(t *testing.T) {
	truncateTables(t)

	first := &HubRoutingMetric{
		ModelName: "gpt-5", EndpointType: "openai", ProviderId: 3, ChannelId: 11, BucketTs: 100,
		RequestCount: 1, SuccessCount: 1, LatencySumMs: 1200, TtftSumMs: 300, TtftCount: 1,
	}
	second := &HubRoutingMetric{
		ModelName: "gpt-5", EndpointType: "openai", ProviderId: 3, ChannelId: 11, BucketTs: 100,
		RequestCount: 2, SuccessCount: 1, LatencySumMs: 1800, TtftSumMs: 500, TtftCount: 1,
	}

	require.NoError(t, UpsertHubRoutingMetric(first))
	require.NoError(t, UpsertHubRoutingMetric(second))

	var got HubRoutingMetric
	require.NoError(t, DB.Where("model_name = ? AND endpoint_type = ? AND provider_id = ? AND channel_id = ? AND bucket_ts = ?", "gpt-5", "openai", 3, 11, 100).First(&got).Error)
	assert.Equal(t, int64(3), got.RequestCount)
	assert.Equal(t, int64(2), got.SuccessCount)
	assert.Equal(t, int64(3000), got.LatencySumMs)
	assert.Equal(t, int64(800), got.TtftSumMs)
	assert.Equal(t, int64(2), got.TtftCount)
}

func TestGetHubRoutingMetricsFiltersPlatformProvider(t *testing.T) {
	truncateTables(t)
	require.NoError(t, UpsertHubRoutingMetric(&HubRoutingMetric{
		ModelName: "claude-opus-5", EndpointType: "anthropic", ProviderId: 0, ChannelId: 20, BucketTs: 200,
		RequestCount: 1,
	}))
	require.NoError(t, UpsertHubRoutingMetric(&HubRoutingMetric{
		ModelName: "claude-opus-5", EndpointType: "anthropic", ProviderId: 4, ChannelId: 21, BucketTs: 200,
		RequestCount: 1,
	}))

	providerID := 0
	rows, err := GetHubRoutingMetrics("claude-opus-5", "anthropic", &providerID, nil, 200, 200)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Zero(t, rows[0].ProviderId)
	assert.Equal(t, 20, rows[0].ChannelId)
}
