package perfmetrics

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/go-redis/redis/v8"
)

const (
	hubRoutingWindowBucketSeconds  int64 = 60
	hubRoutingDefaultWindowMinutes       = 15
	hubRoutingMaxWindowMinutes           = 60
	hubRoutingHistogramBucketCount       = 16
	hubRoutingFailureClassCount          = 6
)

var hubRoutingFailureClasses = [hubRoutingFailureClassCount]string{
	"upstream", "configuration", "client", "loop", "response_started", "unknown",
}

var hubRoutingHistogramUpperBounds = [hubRoutingHistogramBucketCount]int64{
	100, 250, 500, 1_000, 2_000, 3_000, 5_000, 8_000,
	12_000, 20_000, 30_000, 60_000, 120_000, 300_000, 600_000, 3_600_000,
}

type hubRoutingWindowBucketKey struct {
	modelName    string
	endpointType string
	providerID   int
	channelID    int
	bucketTs     int64
}

type hubRoutingWindowCounters struct {
	requestCount     int64
	successCount     int64
	failureCounts    [hubRoutingFailureClassCount]int64
	latencyHistogram [hubRoutingHistogramBucketCount]int64
	ttftHistogram    [hubRoutingHistogramBucketCount]int64
}

type hubRoutingWindowAtomicBucket struct {
	requestCount     atomic.Int64
	successCount     atomic.Int64
	failureCounts    [hubRoutingFailureClassCount]atomic.Int64
	latencyHistogram [hubRoutingHistogramBucketCount]atomic.Int64
	ttftHistogram    [hubRoutingHistogramBucketCount]atomic.Int64
}

type hubRoutingWindowAggregate struct {
	requestCount5m   int64
	successCount5m   int64
	requestCount60m  int64
	successCount60m  int64
	failureCounts5m  [hubRoutingFailureClassCount]int64
	failureCounts60m [hubRoutingFailureClassCount]int64
	latencyHistogram [hubRoutingHistogramBucketCount]int64
	ttftHistogram    [hubRoutingHistogramBucketCount]int64
}

var hubRoutingWindowBuckets sync.Map

func (bucket *hubRoutingWindowAtomicBucket) add(sample HubRoutingAttempt) {
	bucket.requestCount.Add(1)
	if !sample.Success {
		bucket.failureCounts[hubRoutingFailureClassIndex(sample.FailureClass)].Add(1)
		return
	}
	bucket.successCount.Add(1)
	if sample.LatencyMS >= 0 {
		bucket.latencyHistogram[hubRoutingHistogramIndex(sample.LatencyMS)].Add(1)
	}
	if sample.FirstTokenMS != nil && *sample.FirstTokenMS >= 0 {
		bucket.ttftHistogram[hubRoutingHistogramIndex(*sample.FirstTokenMS)].Add(1)
	}
}

func (bucket *hubRoutingWindowAtomicBucket) snapshot() hubRoutingWindowCounters {
	counters := hubRoutingWindowCounters{
		requestCount: bucket.requestCount.Load(),
		successCount: bucket.successCount.Load(),
	}
	for index := range hubRoutingFailureClassCount {
		counters.failureCounts[index] = bucket.failureCounts[index].Load()
	}
	for index := range hubRoutingHistogramBucketCount {
		counters.latencyHistogram[index] = bucket.latencyHistogram[index].Load()
		counters.ttftHistogram[index] = bucket.ttftHistogram[index].Load()
	}
	return counters
}

func recordHubRoutingWindow(sample HubRoutingAttempt, nowTs int64) {
	key := hubRoutingWindowBucketKey{
		modelName: sample.Model, endpointType: sample.EndpointType,
		providerID: sample.ProviderID, channelID: sample.ChannelID,
		bucketTs: hubRoutingWindowBucketStart(nowTs),
	}
	actual, _ := hubRoutingWindowBuckets.LoadOrStore(key, &hubRoutingWindowAtomicBucket{})
	actual.(*hubRoutingWindowAtomicBucket).add(sample)
}

func queryHubRoutingWindowMetrics(params HubRoutingMetricQueryParams, nowTs int64) map[hubRoutingDimensionKey]hubRoutingWindowAggregate {
	windowMinutes := params.WindowMinutes
	if windowMinutes <= 0 {
		windowMinutes = hubRoutingDefaultWindowMinutes
	}
	if windowMinutes > hubRoutingMaxWindowMinutes {
		windowMinutes = hubRoutingMaxWindowMinutes
	}

	currentBucket := hubRoutingWindowBucketStart(nowTs)
	earliest60m := currentBucket - int64(hubRoutingMaxWindowMinutes-1)*hubRoutingWindowBucketSeconds
	earliest5m := currentBucket - 4*hubRoutingWindowBucketSeconds
	earliestPercentile := currentBucket - int64(windowMinutes-1)*hubRoutingWindowBucketSeconds
	merged := make(map[hubRoutingWindowBucketKey]hubRoutingWindowCounters)
	hubRoutingWindowBuckets.Range(func(key, value any) bool {
		bucketKey := key.(hubRoutingWindowBucketKey)
		if bucketKey.bucketTs < earliest60m {
			hubRoutingWindowBuckets.Delete(key)
			return true
		}
		if bucketKey.bucketTs > currentBucket || !matchesHubRoutingWindowQuery(bucketKey, params) {
			return true
		}
		merged[bucketKey] = value.(*hubRoutingWindowAtomicBucket).snapshot()
		return true
	})
	mergeHubRoutingWindowRedis(merged, params, earliest60m, currentBucket)

	aggregates := make(map[hubRoutingDimensionKey]hubRoutingWindowAggregate)
	for key, counters := range merged {
		dimension := hubRoutingDimensionKey{
			modelName: key.modelName, endpointType: key.endpointType,
			providerID: key.providerID, channelID: key.channelID,
		}
		aggregate := aggregates[dimension]
		aggregate.requestCount60m += counters.requestCount
		aggregate.successCount60m += counters.successCount
		for index := range hubRoutingFailureClassCount {
			aggregate.failureCounts60m[index] += counters.failureCounts[index]
		}
		if key.bucketTs >= earliest5m {
			aggregate.requestCount5m += counters.requestCount
			aggregate.successCount5m += counters.successCount
			for index := range hubRoutingFailureClassCount {
				aggregate.failureCounts5m[index] += counters.failureCounts[index]
			}
		}
		if key.bucketTs >= earliestPercentile {
			mergeHubRoutingHistogram(&aggregate.latencyHistogram, counters.latencyHistogram)
			mergeHubRoutingHistogram(&aggregate.ttftHistogram, counters.ttftHistogram)
		}
		aggregates[dimension] = aggregate
	}
	return aggregates
}

func hubRoutingFailureClassIndex(class string) int {
	for index, known := range hubRoutingFailureClasses {
		if class == known {
			return index
		}
	}
	return hubRoutingFailureClassCount - 1
}

func hubRoutingFailureCountsMap(counts [hubRoutingFailureClassCount]int64) map[string]int64 {
	result := make(map[string]int64)
	for index, count := range counts {
		if count > 0 {
			result[hubRoutingFailureClasses[index]] = count
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func matchesHubRoutingWindowQuery(key hubRoutingWindowBucketKey, params HubRoutingMetricQueryParams) bool {
	return matchesHubRoutingQuery(hubRoutingBucketKey{
		modelName: key.modelName, endpointType: key.endpointType,
		providerID: key.providerID, channelID: key.channelID,
	}, params)
}

func cleanupHubRoutingWindowBuckets(nowTs int64) {
	cutoff := hubRoutingWindowBucketStart(nowTs) - int64(hubRoutingMaxWindowMinutes-1)*hubRoutingWindowBucketSeconds
	hubRoutingWindowBuckets.Range(func(key, _ any) bool {
		if key.(hubRoutingWindowBucketKey).bucketTs < cutoff {
			hubRoutingWindowBuckets.Delete(key)
		}
		return true
	})
}

func hubRoutingWindowBucketStart(ts int64) int64 {
	return ts - ts%hubRoutingWindowBucketSeconds
}

func hubRoutingHistogramIndex(value int64) int {
	for index, upperBound := range hubRoutingHistogramUpperBounds {
		if value <= upperBound {
			return index
		}
	}
	return hubRoutingHistogramBucketCount - 1
}

func mergeHubRoutingHistogram(target *[hubRoutingHistogramBucketCount]int64, source [hubRoutingHistogramBucketCount]int64) {
	for index := range hubRoutingHistogramBucketCount {
		target[index] += source[index]
	}
}

func hubRoutingHistogramCount(histogram [hubRoutingHistogramBucketCount]int64) int64 {
	var total int64
	for _, count := range histogram {
		total += count
	}
	return total
}

func hubRoutingHistogramPercentile(histogram [hubRoutingHistogramBucketCount]int64, percentile int64) *int64 {
	total := hubRoutingHistogramCount(histogram)
	if total <= 0 || percentile <= 0 || percentile > 100 {
		return nil
	}
	rank := (percentile*total + 99) / 100
	var seen int64
	for index, count := range histogram {
		seen += count
		if seen >= rank {
			value := hubRoutingHistogramUpperBounds[index]
			return &value
		}
	}
	return nil
}

func hubRoutingSuccessRate(successCount, requestCount int64) *float64 {
	if requestCount <= 0 {
		return nil
	}
	value := float64(successCount) / float64(requestCount) * 100
	return &value
}

func appendHubRoutingWindowRedis(ctx context.Context, pipe redis.Pipeliner, key hubRoutingBucketKey, sample HubRoutingAttempt, nowTs int64) {
	windowKey := hubRoutingWindowBucketKey{
		modelName: key.modelName, endpointType: key.endpointType,
		providerID: key.providerID, channelID: key.channelID,
		bucketTs: hubRoutingWindowBucketStart(nowTs),
	}
	redisKey := hubRoutingWindowRedisBucketKey(windowKey)
	pipe.HIncrBy(ctx, redisKey, "req", 1)
	if sample.Success {
		pipe.HIncrBy(ctx, redisKey, "ok", 1)
		if sample.LatencyMS >= 0 {
			pipe.HIncrBy(ctx, redisKey, hubRoutingHistogramRedisField("lat", hubRoutingHistogramIndex(sample.LatencyMS)), 1)
		}
		if sample.FirstTokenMS != nil && *sample.FirstTokenMS >= 0 {
			pipe.HIncrBy(ctx, redisKey, hubRoutingHistogramRedisField("ttft", hubRoutingHistogramIndex(*sample.FirstTokenMS)), 1)
		}
	} else {
		pipe.HIncrBy(ctx, redisKey, hubRoutingFailureRedisField(sample.FailureClass), 1)
	}
	pipe.Expire(ctx, redisKey, 2*time.Hour)
}

func mergeHubRoutingWindowRedis(merged map[hubRoutingWindowBucketKey]hubRoutingWindowCounters, params HubRoutingMetricQueryParams, startTs, endTs int64) {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var cursor uint64
	for {
		keys, next, err := common.RDB.Scan(ctx, cursor, "hub-routing-window:*", 100).Result()
		if err != nil {
			return
		}
		for _, rawKey := range keys {
			key, ok := parseHubRoutingWindowRedisBucketKey(rawKey)
			if !ok || key.bucketTs < startTs || key.bucketTs > endTs || !matchesHubRoutingWindowQuery(key, params) {
				continue
			}
			values, err := common.RDB.HGetAll(ctx, rawKey).Result()
			if err != nil {
				continue
			}
			counters := hubRoutingWindowCounters{
				requestCount: parseRedisInt(values["req"]),
				successCount: parseRedisInt(values["ok"]),
			}
			for index := range hubRoutingHistogramBucketCount {
				counters.latencyHistogram[index] = parseRedisInt(values[hubRoutingHistogramRedisField("lat", index)])
				counters.ttftHistogram[index] = parseRedisInt(values[hubRoutingHistogramRedisField("ttft", index)])
			}
			for index := range hubRoutingFailureClassCount {
				counters.failureCounts[index] = parseRedisInt(values[hubRoutingFailureRedisField(hubRoutingFailureClasses[index])])
			}
			// Redis includes this instance and all peers, so it replaces the
			// local minute bucket instead of being added to it.
			merged[key] = counters
		}
		cursor = next
		if cursor == 0 {
			return
		}
	}
}

func hubRoutingHistogramRedisField(prefix string, index int) string {
	return prefix + "_" + strconv.Itoa(index)
}

func hubRoutingFailureRedisField(class string) string {
	return "failure_" + hubRoutingFailureClasses[hubRoutingFailureClassIndex(class)]
}

func hubRoutingWindowRedisBucketKey(key hubRoutingWindowBucketKey) string {
	return fmt.Sprintf("hub-routing-window:%d:%d:%d:%s:%s", key.providerID, key.channelID, key.bucketTs, url.QueryEscape(key.modelName), url.QueryEscape(key.endpointType))
}

func parseHubRoutingWindowRedisBucketKey(raw string) (hubRoutingWindowBucketKey, bool) {
	parts := strings.SplitN(raw, ":", 6)
	if len(parts) != 6 || parts[0] != "hub-routing-window" {
		return hubRoutingWindowBucketKey{}, false
	}
	providerID, err1 := strconv.Atoi(parts[1])
	channelID, err2 := strconv.Atoi(parts[2])
	bucketTs, err3 := strconv.ParseInt(parts[3], 10, 64)
	modelName, err4 := url.QueryUnescape(parts[4])
	endpointType, err5 := url.QueryUnescape(parts[5])
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil || modelName == "" || endpointType == "" {
		return hubRoutingWindowBucketKey{}, false
	}
	return hubRoutingWindowBucketKey{
		providerID: providerID, channelID: channelID, bucketTs: bucketTs,
		modelName: modelName, endpointType: endpointType,
	}, true
}
