package model

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// HubRoutingMetric stores real-request routing observations in time buckets.
// It is intentionally separate from PerfMetric, which powers the public model
// square and has different aggregation dimensions.
type HubRoutingMetric struct {
	Id           int    `json:"id" gorm:"primaryKey"`
	ModelName    string `json:"model_name" gorm:"size:128;uniqueIndex:idx_hub_routing_metric_bucket,priority:1"`
	EndpointType string `json:"endpoint_type" gorm:"size:64;uniqueIndex:idx_hub_routing_metric_bucket,priority:2"`
	ProviderId   int    `json:"provider_id" gorm:"uniqueIndex:idx_hub_routing_metric_bucket,priority:3;index:idx_hub_routing_metric_provider"`
	ChannelId    int    `json:"channel_id" gorm:"uniqueIndex:idx_hub_routing_metric_bucket,priority:4;index:idx_hub_routing_metric_channel"`
	BucketTs     int64  `json:"bucket_ts" gorm:"uniqueIndex:idx_hub_routing_metric_bucket,priority:5;index:idx_hub_routing_metric_bucket_ts"`
	RequestCount int64  `json:"-" gorm:"default:0"`
	SuccessCount int64  `json:"-" gorm:"default:0"`
	LatencySumMs int64  `json:"-" gorm:"default:0"`
	TtftSumMs    int64  `json:"-" gorm:"default:0"`
	TtftCount    int64  `json:"-" gorm:"default:0"`
}

func (HubRoutingMetric) TableName() string {
	return "hub_routing_metrics"
}

func UpsertHubRoutingMetric(metric *HubRoutingMetric) error {
	if metric == nil || metric.RequestCount == 0 {
		return nil
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "model_name"},
			{Name: "endpoint_type"},
			{Name: "provider_id"},
			{Name: "channel_id"},
			{Name: "bucket_ts"},
		},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"request_count":  gorm.Expr("hub_routing_metrics.request_count + ?", metric.RequestCount),
			"success_count":  gorm.Expr("hub_routing_metrics.success_count + ?", metric.SuccessCount),
			"latency_sum_ms": gorm.Expr("hub_routing_metrics.latency_sum_ms + ?", metric.LatencySumMs),
			"ttft_sum_ms":    gorm.Expr("hub_routing_metrics.ttft_sum_ms + ?", metric.TtftSumMs),
			"ttft_count":     gorm.Expr("hub_routing_metrics.ttft_count + ?", metric.TtftCount),
		}),
	}).Create(metric).Error
}

func GetHubRoutingMetrics(modelName, endpointType string, providerID, channelID *int, startTs, endTs int64) ([]HubRoutingMetric, error) {
	var metrics []HubRoutingMetric
	query := DB.Model(&HubRoutingMetric{}).
		Where("bucket_ts >= ? AND bucket_ts <= ?", startTs, endTs)
	if modelName != "" {
		query = query.Where("model_name = ?", modelName)
	}
	if endpointType != "" {
		query = query.Where("endpoint_type = ?", endpointType)
	}
	if providerID != nil {
		query = query.Where("provider_id = ?", *providerID)
	}
	if channelID != nil {
		query = query.Where("channel_id = ?", *channelID)
	}
	err := query.Order("bucket_ts ASC").Find(&metrics).Error
	return metrics, err
}

func DeleteHubRoutingMetricsBefore(cutoffTs int64) error {
	if cutoffTs <= 0 {
		return nil
	}
	return DB.Where("bucket_ts < ?", cutoffTs).Delete(&HubRoutingMetric{}).Error
}
