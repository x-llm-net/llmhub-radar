package perfmetrics

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
)

// HubRoutingAttempt is the minimal real-request sample used by the routing
// observer. Failed attempts are included because they are part of the route
// decision, but they never affect the existing billing or selection paths.
type HubRoutingAttempt struct {
	Model        string
	EndpointType string
	ProviderID   int
	ChannelID    int
	Success      bool
	LatencyMS    int64
	FirstTokenMS *int64
}

type HubRoutingMetricQueryParams struct {
	Model         string
	EndpointType  string
	ProviderID    *int
	ChannelID     *int
	Hours         int
	WindowMinutes int
	Limit         int
}

type HubRoutingMetricQueryResult struct {
	Hours         int                         `json:"hours"`
	WindowMinutes int                         `json:"window_minutes"`
	StartTs       int64                       `json:"start_ts"`
	EndTs         int64                       `json:"end_ts"`
	Items         []HubRoutingMetricAggregate `json:"items"`
}

type HubRoutingMetricAggregate struct {
	ModelName             string   `json:"model_name"`
	EndpointType          string   `json:"endpoint_type"`
	ProviderID            int      `json:"provider_id"`
	ChannelID             int      `json:"channel_id"`
	RequestCount          int64    `json:"request_count"`
	SuccessCount          int64    `json:"success_count"`
	SuccessRate           float64  `json:"success_rate"`
	AvgLatencyMS          int64    `json:"avg_latency_ms"`
	AvgFirstTokenMS       *int64   `json:"avg_first_token_ms,omitempty"`
	RequestCount5m        int64    `json:"request_count_5m"`
	SuccessRate5m         *float64 `json:"success_rate_5m,omitempty"`
	RequestCount60m       int64    `json:"request_count_60m"`
	SuccessRate60m        *float64 `json:"success_rate_60m,omitempty"`
	LatencySampleCount    int64    `json:"latency_sample_count"`
	LatencyP50MS          *int64   `json:"latency_p50_ms,omitempty"`
	LatencyP95MS          *int64   `json:"latency_p95_ms,omitempty"`
	FirstTokenSampleCount int64    `json:"first_token_sample_count"`
	FirstTokenP50MS       *int64   `json:"first_token_p50_ms,omitempty"`
	FirstTokenP95MS       *int64   `json:"first_token_p95_ms,omitempty"`
}

type hubRoutingBucketKey struct {
	modelName    string
	endpointType string
	providerID   int
	channelID    int
	bucketTs     int64
}

type hubRoutingDimensionKey struct {
	modelName    string
	endpointType string
	providerID   int
	channelID    int
}

type hubRoutingCounters struct {
	requestCount int64
	successCount int64
	latencySumMs int64
	ttftSumMs    int64
	ttftCount    int64
}

type hubRoutingAtomicBucket struct {
	requestCount atomic.Int64
	successCount atomic.Int64
	latencySumMs atomic.Int64
	ttftSumMs    atomic.Int64
	ttftCount    atomic.Int64
}

func (a *hubRoutingAtomicBucket) add(sample HubRoutingAttempt) {
	a.requestCount.Add(1)
	if sample.Success {
		a.successCount.Add(1)
	}
	if sample.LatencyMS > 0 {
		a.latencySumMs.Add(sample.LatencyMS)
	}
	if sample.FirstTokenMS != nil && *sample.FirstTokenMS >= 0 {
		a.ttftSumMs.Add(*sample.FirstTokenMS)
		a.ttftCount.Add(1)
	}
}

func (a *hubRoutingAtomicBucket) snapshot() hubRoutingCounters {
	return hubRoutingCounters{
		requestCount: a.requestCount.Load(),
		successCount: a.successCount.Load(),
		latencySumMs: a.latencySumMs.Load(),
		ttftSumMs:    a.ttftSumMs.Load(),
		ttftCount:    a.ttftCount.Load(),
	}
}

func (a *hubRoutingAtomicBucket) drain() hubRoutingCounters {
	return hubRoutingCounters{
		requestCount: a.requestCount.Swap(0),
		successCount: a.successCount.Swap(0),
		latencySumMs: a.latencySumMs.Swap(0),
		ttftSumMs:    a.ttftSumMs.Swap(0),
		ttftCount:    a.ttftCount.Swap(0),
	}
}

func (a *hubRoutingAtomicBucket) addCounters(c hubRoutingCounters) {
	a.requestCount.Add(c.requestCount)
	a.successCount.Add(c.successCount)
	a.latencySumMs.Add(c.latencySumMs)
	a.ttftSumMs.Add(c.ttftSumMs)
	a.ttftCount.Add(c.ttftCount)
}

var hubRoutingBuckets sync.Map

func RecordHubRoutingAttempts(attempts []HubRoutingAttempt) {
	if !perf_metrics_setting.GetSetting().Enabled {
		return
	}
	now := time.Now().Unix()
	for _, attempt := range attempts {
		if attempt.Model == "" || attempt.EndpointType == "" || attempt.ChannelID <= 0 {
			continue
		}
		key := hubRoutingBucketKey{
			modelName:    attempt.Model,
			endpointType: attempt.EndpointType,
			providerID:   attempt.ProviderID,
			channelID:    attempt.ChannelID,
			bucketTs:     bucketStart(now),
		}
		actual, _ := hubRoutingBuckets.LoadOrStore(key, &hubRoutingAtomicBucket{})
		actual.(*hubRoutingAtomicBucket).add(attempt)
		recordHubRoutingWindow(attempt, now)
		recordHubRoutingRedis(key, attempt, now)
	}
}

func QueryHubRoutingMetrics(params HubRoutingMetricQueryParams) (HubRoutingMetricQueryResult, error) {
	if params.Hours <= 0 {
		params.Hours = 24
	}
	if params.Hours > 24*30 {
		params.Hours = 24 * 30
	}
	if params.Limit <= 0 {
		params.Limit = 100
	}
	if params.Limit > 1000 {
		params.Limit = 1000
	}
	if params.WindowMinutes <= 0 {
		params.WindowMinutes = hubRoutingDefaultWindowMinutes
	}
	if params.WindowMinutes > hubRoutingMaxWindowMinutes {
		params.WindowMinutes = hubRoutingMaxWindowMinutes
	}

	endTs := time.Now().Unix()
	startTs := endTs - int64(params.Hours)*3600
	merged := map[hubRoutingBucketKey]hubRoutingCounters{}
	rows, err := model.GetHubRoutingMetrics(params.Model, params.EndpointType, params.ProviderID, params.ChannelID, startTs, endTs)
	if err != nil {
		return HubRoutingMetricQueryResult{}, err
	}
	for _, row := range rows {
		mergeHubRoutingCounters(merged, hubRoutingBucketKey{
			modelName:    row.ModelName,
			endpointType: row.EndpointType,
			providerID:   row.ProviderId,
			channelID:    row.ChannelId,
			bucketTs:     row.BucketTs,
		}, hubRoutingCounters{
			requestCount: row.RequestCount,
			successCount: row.SuccessCount,
			latencySumMs: row.LatencySumMs,
			ttftSumMs:    row.TtftSumMs,
			ttftCount:    row.TtftCount,
		})
	}

	activeBucket := bucketStart(time.Now().Unix())
	hubRoutingBuckets.Range(func(key, value any) bool {
		k := key.(hubRoutingBucketKey)
		if k.bucketTs < startTs || k.bucketTs > endTs || k.bucketTs != activeBucket || !matchesHubRoutingQuery(k, params) {
			return true
		}
		mergeHubRoutingCounters(merged, k, value.(*hubRoutingAtomicBucket).snapshot())
		return true
	})
	mergeHubRoutingRedisActiveBuckets(merged, params, startTs, endTs)

	dimensions := map[hubRoutingDimensionKey]hubRoutingCounters{}
	for key, value := range merged {
		dimensionKey := hubRoutingDimensionKey{
			modelName:    key.modelName,
			endpointType: key.endpointType,
			providerID:   key.providerID,
			channelID:    key.channelID,
		}
		mergeHubRoutingDimensionCounters(dimensions, dimensionKey, value)
	}

	recent := queryHubRoutingWindowMetrics(params, endTs)
	items := make([]HubRoutingMetricAggregate, 0, len(dimensions))
	for key, value := range dimensions {
		if value.requestCount <= 0 {
			continue
		}
		item := HubRoutingMetricAggregate{
			ModelName:    key.modelName,
			EndpointType: key.endpointType,
			ProviderID:   key.providerID,
			ChannelID:    key.channelID,
			RequestCount: value.requestCount,
			SuccessCount: value.successCount,
			SuccessRate:  float64(value.successCount) / float64(value.requestCount) * 100,
			AvgLatencyMS: value.latencySumMs / value.requestCount,
		}
		if value.ttftCount > 0 {
			avg := value.ttftSumMs / value.ttftCount
			item.AvgFirstTokenMS = &avg
		}
		if window, ok := recent[key]; ok {
			item.RequestCount5m = window.requestCount5m
			item.SuccessRate5m = hubRoutingSuccessRate(window.successCount5m, window.requestCount5m)
			item.RequestCount60m = window.requestCount60m
			item.SuccessRate60m = hubRoutingSuccessRate(window.successCount60m, window.requestCount60m)
			item.LatencySampleCount = hubRoutingHistogramCount(window.latencyHistogram)
			item.LatencyP50MS = hubRoutingHistogramPercentile(window.latencyHistogram, 50)
			item.LatencyP95MS = hubRoutingHistogramPercentile(window.latencyHistogram, 95)
			item.FirstTokenSampleCount = hubRoutingHistogramCount(window.ttftHistogram)
			item.FirstTokenP50MS = hubRoutingHistogramPercentile(window.ttftHistogram, 50)
			item.FirstTokenP95MS = hubRoutingHistogramPercentile(window.ttftHistogram, 95)
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].RequestCount != items[j].RequestCount {
			return items[i].RequestCount > items[j].RequestCount
		}
		if items[i].ModelName != items[j].ModelName {
			return items[i].ModelName < items[j].ModelName
		}
		if items[i].EndpointType != items[j].EndpointType {
			return items[i].EndpointType < items[j].EndpointType
		}
		if items[i].ProviderID != items[j].ProviderID {
			return items[i].ProviderID < items[j].ProviderID
		}
		return items[i].ChannelID < items[j].ChannelID
	})
	if len(items) > params.Limit {
		items = items[:params.Limit]
	}
	return HubRoutingMetricQueryResult{
		Hours: params.Hours, WindowMinutes: params.WindowMinutes,
		StartTs: startTs, EndTs: endTs, Items: items,
	}, nil
}

func matchesHubRoutingQuery(key hubRoutingBucketKey, params HubRoutingMetricQueryParams) bool {
	if params.Model != "" && key.modelName != params.Model {
		return false
	}
	if params.EndpointType != "" && key.endpointType != params.EndpointType {
		return false
	}
	if params.ProviderID != nil && key.providerID != *params.ProviderID {
		return false
	}
	if params.ChannelID != nil && key.channelID != *params.ChannelID {
		return false
	}
	return true
}

func mergeHubRoutingCounters(merged map[hubRoutingBucketKey]hubRoutingCounters, key hubRoutingBucketKey, value hubRoutingCounters) {
	current := merged[key]
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.latencySumMs += value.latencySumMs
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	merged[key] = current
}

func mergeHubRoutingDimensionCounters(merged map[hubRoutingDimensionKey]hubRoutingCounters, key hubRoutingDimensionKey, value hubRoutingCounters) {
	current := merged[key]
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.latencySumMs += value.latencySumMs
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	merged[key] = current
}

func flushHubRoutingBuckets() {
	cleanupHubRoutingWindowBuckets(time.Now().Unix())
	currentBucket := bucketStart(time.Now().Unix())
	hubRoutingBuckets.Range(func(key, value any) bool {
		k := key.(hubRoutingBucketKey)
		if k.bucketTs >= currentBucket {
			return true
		}
		bucket := value.(*hubRoutingAtomicBucket)
		drained := bucket.drain()
		if drained.requestCount == 0 {
			deleteOldHubRoutingBucket(k, key)
			return true
		}
		err := model.UpsertHubRoutingMetric(&model.HubRoutingMetric{
			ModelName:    k.modelName,
			EndpointType: k.endpointType,
			ProviderId:   k.providerID,
			ChannelId:    k.channelID,
			BucketTs:     k.bucketTs,
			RequestCount: drained.requestCount,
			SuccessCount: drained.successCount,
			LatencySumMs: drained.latencySumMs,
			TtftSumMs:    drained.ttftSumMs,
			TtftCount:    drained.ttftCount,
		})
		if err != nil {
			bucket.addCounters(drained)
			common.SysError(fmt.Sprintf("failed to flush hub routing metric model=%s endpoint=%s provider=%d channel=%d bucket=%d: %s", k.modelName, k.endpointType, k.providerID, k.channelID, k.bucketTs, err.Error()))
			return true
		}
		deleteOldHubRoutingBucket(k, key)
		return true
	})
}

func deleteOldHubRoutingBucket(k hubRoutingBucketKey, rawKey any) {
	if k.bucketTs < bucketStart(time.Now().Add(-24*time.Hour).Unix()) {
		hubRoutingBuckets.Delete(rawKey)
	}
}

func recordHubRoutingRedis(key hubRoutingBucketKey, sample HubRoutingAttempt, nowTs int64) {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	redisKey := hubRoutingRedisBucketKey(key)
	pipe := common.RDB.TxPipeline()
	pipe.HIncrBy(ctx, redisKey, "req", 1)
	if sample.Success {
		pipe.HIncrBy(ctx, redisKey, "ok", 1)
	}
	if sample.LatencyMS > 0 {
		pipe.HIncrBy(ctx, redisKey, "lat", sample.LatencyMS)
	}
	if sample.FirstTokenMS != nil && *sample.FirstTokenMS >= 0 {
		pipe.HIncrBy(ctx, redisKey, "ttft", *sample.FirstTokenMS)
		pipe.HIncrBy(ctx, redisKey, "ttft_n", 1)
	}
	pipe.Expire(ctx, redisKey, 2*time.Hour)
	appendHubRoutingWindowRedis(ctx, pipe, key, sample, nowTs)
	_, _ = pipe.Exec(ctx)
}

func mergeHubRoutingRedisActiveBuckets(merged map[hubRoutingBucketKey]hubRoutingCounters, params HubRoutingMetricQueryParams, startTs, endTs int64) {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	activeBucket := bucketStart(time.Now().Unix())
	if activeBucket < startTs || activeBucket > endTs {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var cursor uint64
	for {
		keys, next, err := common.RDB.Scan(ctx, cursor, "hub-routing:*", 100).Result()
		if err != nil {
			return
		}
		for _, rawKey := range keys {
			key, ok := parseHubRoutingRedisBucketKey(rawKey)
			if !ok || key.bucketTs != activeBucket || !matchesHubRoutingQuery(key, params) {
				continue
			}
			values, err := common.RDB.HGetAll(ctx, rawKey).Result()
			if err != nil {
				continue
			}
			// Redis contains local and remote instances. Replace the local hot
			// bucket instead of adding it, otherwise active samples are doubled.
			merged[key] = hubRoutingCounters{
				requestCount: parseRedisInt(values["req"]),
				successCount: parseRedisInt(values["ok"]),
				latencySumMs: parseRedisInt(values["lat"]),
				ttftSumMs:    parseRedisInt(values["ttft"]),
				ttftCount:    parseRedisInt(values["ttft_n"]),
			}
		}
		cursor = next
		if cursor == 0 {
			return
		}
	}
}

func hubRoutingRedisBucketKey(key hubRoutingBucketKey) string {
	return fmt.Sprintf("hub-routing:%d:%d:%d:%s:%s", key.providerID, key.channelID, key.bucketTs, url.QueryEscape(key.modelName), url.QueryEscape(key.endpointType))
}

func parseHubRoutingRedisBucketKey(raw string) (hubRoutingBucketKey, bool) {
	parts := strings.SplitN(raw, ":", 6)
	if len(parts) != 6 || parts[0] != "hub-routing" {
		return hubRoutingBucketKey{}, false
	}
	providerID, err1 := strconv.Atoi(parts[1])
	channelID, err2 := strconv.Atoi(parts[2])
	bucketTs, err3 := strconv.ParseInt(parts[3], 10, 64)
	modelName, err4 := url.QueryUnescape(parts[4])
	endpointType, err5 := url.QueryUnescape(parts[5])
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil || modelName == "" || endpointType == "" {
		return hubRoutingBucketKey{}, false
	}
	return hubRoutingBucketKey{providerID: providerID, channelID: channelID, bucketTs: bucketTs, modelName: modelName, endpointType: endpointType}, true
}
