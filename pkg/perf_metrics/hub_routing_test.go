package perfmetrics

import (
	"testing"
	"time"

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
