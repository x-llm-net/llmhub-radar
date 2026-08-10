package perfmetrics

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestHubRoutingAtomicBucketAccumulatesAttempts(t *testing.T) {
	ttft := int64(240)
	bucket := &hubRoutingAtomicBucket{}
	bucket.add(HubRoutingAttempt{Success: true, LatencyMS: 1000, FirstTokenMS: &ttft})
	bucket.add(HubRoutingAttempt{Success: false, LatencyMS: 500})

	got := bucket.snapshot()
	assert.Equal(t, int64(2), got.requestCount)
	assert.Equal(t, int64(1), got.successCount)
	assert.Equal(t, int64(1500), got.latencySumMs)
	assert.Equal(t, int64(240), got.ttftSumMs)
	assert.Equal(t, int64(1), got.ttftCount)
}

func TestHubRoutingRedisBucketKeyRoundTrip(t *testing.T) {
	want := hubRoutingBucketKey{
		modelName: "model/with:punctuation", endpointType: "openai-response",
		providerID: 7, channelID: 9, bucketTs: 123,
	}
	got, ok := parseHubRoutingRedisBucketKey(hubRoutingRedisBucketKey(want))
	require.True(t, ok)
	assert.Equal(t, want, got)
}

func TestQueryHubRoutingMetricsAggregatesStoredRows(t *testing.T) {
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.HubRoutingMetric{}))
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })

	bucket := time.Now().Unix()
	bucket -= bucket % 3600
	require.NoError(t, db.Create(&model.HubRoutingMetric{
		ModelName: "gpt-5", EndpointType: "openai", ProviderId: 3, ChannelId: 11, BucketTs: bucket,
		RequestCount: 2, SuccessCount: 1, LatencySumMs: 1400, TtftSumMs: 300, TtftCount: 1,
	}).Error)
	require.NoError(t, db.Create(&model.HubRoutingMetric{
		ModelName: "gpt-5", EndpointType: "openai", ProviderId: 3, ChannelId: 11, BucketTs: bucket - 3600,
		RequestCount: 1, SuccessCount: 1, LatencySumMs: 800, TtftSumMs: 200, TtftCount: 1,
	}).Error)

	result, err := QueryHubRoutingMetrics(HubRoutingMetricQueryParams{Model: "gpt-5", Hours: 2})
	require.NoError(t, err)
	require.Len(t, result.Items, 1)
	item := result.Items[0]
	assert.Equal(t, int64(3), item.RequestCount)
	assert.Equal(t, int64(2), item.SuccessCount)
	assert.InDelta(t, 66.666, item.SuccessRate, 0.01)
	assert.Equal(t, int64(733), item.AvgLatencyMS)
	require.NotNil(t, item.AvgFirstTokenMS)
	assert.Equal(t, int64(250), *item.AvgFirstTokenMS)
}

func TestQueryHubRoutingWindowMetricsUsesSuccessOnlyPercentiles(t *testing.T) {
	previousRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	clearHubRoutingWindowBucketsForTest()
	t.Cleanup(func() {
		clearHubRoutingWindowBucketsForTest()
		common.RedisEnabled = previousRedisEnabled
	})

	now := hubRoutingWindowBucketStart(time.Now().Unix())
	recordHubRoutingWindow(HubRoutingAttempt{
		Model: "gpt-window", EndpointType: "openai", ProviderID: 3, ChannelID: 11,
		Success: true, LatencyMS: 900, FirstTokenMS: int64Pointer(300),
	}, now)
	recordHubRoutingWindow(HubRoutingAttempt{
		Model: "gpt-window", EndpointType: "openai", ProviderID: 3, ChannelID: 11,
		Success: true, LatencyMS: 2900, FirstTokenMS: int64Pointer(1800),
	}, now)
	recordHubRoutingWindow(HubRoutingAttempt{
		Model: "gpt-window", EndpointType: "openai", ProviderID: 3, ChannelID: 11,
		Success: false, LatencyMS: 7000,
	}, now)
	recordHubRoutingWindow(HubRoutingAttempt{
		Model: "gpt-window", EndpointType: "openai", ProviderID: 3, ChannelID: 11,
		Success: true, LatencyMS: 500,
	}, now-30*60)

	metrics := queryHubRoutingWindowMetrics(HubRoutingMetricQueryParams{
		Model: "gpt-window", WindowMinutes: 15,
	}, now+30)
	item, ok := metrics[hubRoutingDimensionKey{
		modelName: "gpt-window", endpointType: "openai", providerID: 3, channelID: 11,
	}]
	require.True(t, ok)
	assert.Equal(t, int64(3), item.requestCount5m)
	assert.Equal(t, int64(2), item.successCount5m)
	assert.Equal(t, int64(4), item.requestCount60m)
	assert.Equal(t, int64(3), item.successCount60m)
	assert.Equal(t, int64(2), hubRoutingHistogramCount(item.latencyHistogram))
	assert.Equal(t, int64(1000), *hubRoutingHistogramPercentile(item.latencyHistogram, 50))
	assert.Equal(t, int64(3000), *hubRoutingHistogramPercentile(item.latencyHistogram, 95))
	assert.Equal(t, int64(500), *hubRoutingHistogramPercentile(item.ttftHistogram, 50))
	assert.Equal(t, int64(2000), *hubRoutingHistogramPercentile(item.ttftHistogram, 95))
}

func TestHubRoutingWindowRedisBucketKeyRoundTrip(t *testing.T) {
	original := hubRoutingWindowBucketKey{
		modelName:    "model/name with spaces",
		endpointType: "endpoint:type",
		providerID:   3,
		channelID:    11,
		bucketTs:     1770000060,
	}

	parsed, ok := parseHubRoutingWindowRedisBucketKey(hubRoutingWindowRedisBucketKey(original))
	require.True(t, ok)
	assert.Equal(t, original, parsed)
}

func clearHubRoutingWindowBucketsForTest() {
	hubRoutingWindowBuckets.Range(func(key, _ any) bool {
		hubRoutingWindowBuckets.Delete(key)
		return true
	})
}

func int64Pointer(value int64) *int64 {
	return &value
}
