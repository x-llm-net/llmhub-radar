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
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	hubProviderPublicPeriodSeconds = int64(7 * 24 * 60 * 60)
	hubProviderPublicBucketCount   = 28

	HubProviderPublicBucketAvailable = "available"
	HubProviderPublicBucketDegraded  = "degraded"
	HubProviderPublicBucketError     = "error"
	HubProviderPublicBucketUnknown   = "unknown"
)

type HubProviderPublicBucket struct {
	StartedAt   int64   `json:"started_at"`
	Status      string  `json:"status"`
	SampleCount int     `json:"sample_count"`
	SuccessRate float64 `json:"success_rate"`
}

type HubProviderPublicModel struct {
	ModelName          string                    `json:"model_name"`
	FamilyKey          string                    `json:"family_key"`
	Online             bool                      `json:"online"`
	ChannelCount       int                       `json:"channel_count"`
	OnlineChannelCount int                       `json:"online_channel_count"`
	MinPriceMultiplier float64                   `json:"min_price_multiplier"`
	Stability7d        float64                   `json:"stability_7d"`
	SampleCount        int                       `json:"sample_count"`
	AverageLatencyMs   int64                     `json:"average_latency_ms"`
	FirstTokenP50Ms    *int64                    `json:"first_token_p50_ms"`
	FirstTokenP95Ms    *int64                    `json:"first_token_p95_ms"`
	LastProbeAt        int64                     `json:"last_probe_at"`
	Timeline           []HubProviderPublicBucket `json:"timeline"`
}

type HubProviderPublicStats struct {
	PublishedModelCount int     `json:"published_model_count"`
	OnlineModelCount    int     `json:"online_model_count"`
	ChannelCount        int     `json:"channel_count"`
	Stability7d         float64 `json:"stability_7d"`
	SampleCount         int     `json:"sample_count"`
	LastProbeAt         int64   `json:"last_probe_at"`
}

// HubProviderPublicIdentity is the only provider metadata exposed by the
// public directory API. Keep this separate from HubProvider so adding an
// internal provider field cannot accidentally make it public.
type HubProviderPublicIdentity struct {
	Id           int    `json:"id"`
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	Website      string `json:"website"`
	Description  string `json:"description"`
	LogoURL      string `json:"logo_url"`
	SupportType  string `json:"support_type"`
	SupportValue string `json:"support_value"`
}

type HubProviderPublicProfile struct {
	Provider HubProviderPublicIdentity `json:"provider"`
	Stats    HubProviderPublicStats    `json:"stats"`
	Models   []HubProviderPublicModel  `json:"models"`
}

type hubProviderPublicModelAccumulator struct {
	model               HubProviderPublicModel
	successCount        int
	latencyTotalMs      int64
	latencySampleCount  int
	firstTokenValues    []int64
	bucketSuccessCounts [hubProviderPublicBucketCount]int
	bucketSampleCounts  [hubProviderPublicBucketCount]int
}

type hubProviderPublicGroupModelKey struct {
	groupID   int
	modelName string
}

func GetHubProviderPublicProfile(providerSlug string, now int64) (*HubProviderPublicProfile, error) {
	providerSlug, err := NormalizeHubProviderSlug(providerSlug)
	if err != nil {
		return nil, nil
	}
	if now <= 0 {
		now = common.GetTimestamp()
	}

	var provider HubProvider
	err = DB.Where("slug = ? AND status = ?", providerSlug, HubProviderStatusActive).First(&provider).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	groups, err := GetHubSupplyGroupsByProviderID(provider.Id)
	if err != nil {
		return nil, err
	}
	profile := &HubProviderPublicProfile{
		Provider: HubProviderPublicIdentity{
			Id:           provider.Id,
			Name:         provider.Name,
			Slug:         provider.Slug,
			Website:      PublicHubProviderWebsite(provider),
			Description:  provider.Description,
			LogoURL:      provider.LogoURL,
			SupportType:  provider.SupportType,
			SupportValue: provider.SupportValue,
		},
		Models: make([]HubProviderPublicModel, 0),
	}
	HydrateHubProviderLogoURL(
		&provider,
		"/api/hub/public/providers/"+provider.Slug+"/logo?v="+strconv.Itoa(provider.LogoAssetId),
	)
	profile.Provider.LogoURL = provider.LogoURL
	if len(groups) == 0 {
		return profile, nil
	}

	groupIDs := make([]int, 0, len(groups))
	groupVersions := make(map[int]int, len(groups))
	publishedByGroup := make(map[int]map[string]struct{}, len(groups))
	models := make(map[string]*hubProviderPublicModelAccumulator)
	for i := range groups {
		group := &groups[i]
		published := group.GetPublishedModels(group.ChannelModels)
		if len(published) == 0 {
			continue
		}
		groupIDs = append(groupIDs, group.Id)
		groupVersions[group.Id] = group.ConfigVersion
		publishedSet := make(map[string]struct{}, len(published))
		publishedByGroup[group.Id] = publishedSet
		for _, modelName := range published {
			publishedSet[modelName] = struct{}{}
			item := models[modelName]
			if item == nil {
				item = &hubProviderPublicModelAccumulator{
					model: HubProviderPublicModel{
						ModelName:          modelName,
						FamilyKey:          classifyHubPublicModelFamily(modelName),
						MinPriceMultiplier: group.PriceMultiplier,
					},
				}
				models[modelName] = item
			}
			item.model.ChannelCount++
			if group.PriceMultiplier > 0 && (item.model.MinPriceMultiplier <= 0 || group.PriceMultiplier < item.model.MinPriceMultiplier) {
				item.model.MinPriceMultiplier = group.PriceMultiplier
			}
		}
	}
	profile.Stats.ChannelCount = len(groupIDs)
	if len(groupIDs) == 0 {
		return profile, nil
	}

	var targets []HubSupplyGroupProbeTarget
	if err := DB.Where("group_id IN ?", groupIDs).Find(&targets).Error; err != nil {
		return nil, err
	}
	targetsByGroupModel := make(map[hubProviderPublicGroupModelKey][]HubSupplyGroupProbeTarget)
	for _, target := range targets {
		if groupVersions[target.GroupId] != target.ConfigVersion {
			continue
		}
		if _, published := publishedByGroup[target.GroupId][target.ModelName]; !published {
			continue
		}
		key := hubProviderPublicGroupModelKey{groupID: target.GroupId, modelName: target.ModelName}
		targetsByGroupModel[key] = append(targetsByGroupModel[key], target)
	}

	for i := range groups {
		group := &groups[i]
		for modelName := range publishedByGroup[group.Id] {
			item := models[modelName]
			modelTargets := targetsByGroupModel[hubProviderPublicGroupModelKey{groupID: group.Id, modelName: modelName}]
			autoProbeDisabledKinds := map[string]bool(nil)
			if group.IsAutoProbeDisabled(modelName, group.ChannelModels) {
				autoProbeDisabledKinds = hubSupplyAutoProbeDisabledModelKinds(
					group.ChannelType, modelName, group.GetProbeEndpointOverrides(group.ChannelModels),
				)
			}
			online := group.ChannelStatus == common.ChannelStatusEnabled && hubSupplyPublicModelRoutable(
				group.NewAPIChannelId,
				modelName,
				autoProbeDisabledKinds,
				modelTargets,
			)
			for _, target := range modelTargets {
				if target.LastProbeAt > item.model.LastProbeAt {
					item.model.LastProbeAt = target.LastProbeAt
				}
			}
			if online {
				item.model.OnlineChannelCount++
				item.model.Online = true
			}
		}
	}

	periodStartedAt := now - hubProviderPublicPeriodSeconds
	var samples []HubSupplyGroupProbeSample
	if err := DB.Select("group_id", "config_version", "model_name", "success", "latency_ms", "first_token_ms", "error_code", "error_message", "probed_at").
		Where("group_id IN ? AND probed_at >= ? AND probed_at <= ?", groupIDs, periodStartedAt, now).
		Find(&samples).Error; err != nil {
		return nil, err
	}
	bucketSeconds := hubProviderPublicPeriodSeconds / hubProviderPublicBucketCount
	for _, sample := range samples {
		if groupVersions[sample.GroupId] != sample.ConfigVersion {
			continue
		}
		if _, published := publishedByGroup[sample.GroupId][sample.ModelName]; !published {
			continue
		}
		item := models[sample.ModelName]
		if item == nil {
			continue
		}
		bucketIndex := int((sample.ProbedAt - periodStartedAt) / bucketSeconds)
		if bucketIndex < 0 {
			continue
		}
		if bucketIndex >= hubProviderPublicBucketCount {
			bucketIndex = hubProviderPublicBucketCount - 1
		}
		rankingSample := hubRankingSample{
			Success: sample.Success, LatencyMs: sample.LatencyMs, FirstTokenMs: sample.FirstTokenMs,
			ErrorCode: sample.ErrorCode, ErrorMessage: sample.ErrorMessage, ProbedAt: sample.ProbedAt,
		}
		if !isHubRankingSample(rankingSample) {
			continue
		}
		item.model.SampleCount++
		item.bucketSampleCounts[bucketIndex]++
		if sample.Success {
			item.successCount++
			item.bucketSuccessCounts[bucketIndex]++
			if sample.LatencyMs > 0 {
				item.latencyTotalMs += sample.LatencyMs
				item.latencySampleCount++
			}
			if sample.FirstTokenMs != nil && *sample.FirstTokenMs >= 0 {
				item.firstTokenValues = append(item.firstTokenValues, *sample.FirstTokenMs)
			}
		}
	}

	profile.Models = make([]HubProviderPublicModel, 0, len(models))
	totalSuccesses := 0
	for _, item := range models {
		if item.model.SampleCount > 0 {
			item.model.Stability7d = float64(item.successCount) * 100 / float64(item.model.SampleCount)
		}
		if item.latencySampleCount > 0 {
			item.model.AverageLatencyMs = item.latencyTotalMs / int64(item.latencySampleCount)
		}
		item.model.FirstTokenP50Ms = hubRankingPercentile(item.firstTokenValues, 50)
		item.model.FirstTokenP95Ms = hubRankingPercentile(item.firstTokenValues, 95)
		item.model.Timeline = make([]HubProviderPublicBucket, hubProviderPublicBucketCount)
		for bucketIndex := 0; bucketIndex < hubProviderPublicBucketCount; bucketIndex++ {
			sampleCount := item.bucketSampleCounts[bucketIndex]
			successCount := item.bucketSuccessCounts[bucketIndex]
			status := HubProviderPublicBucketUnknown
			successRate := float64(0)
			if sampleCount > 0 {
				successRate = float64(successCount) * 100 / float64(sampleCount)
				switch {
				case successRate >= 95:
					status = HubProviderPublicBucketAvailable
				case successCount > 0:
					status = HubProviderPublicBucketDegraded
				default:
					status = HubProviderPublicBucketError
				}
			}
			item.model.Timeline[bucketIndex] = HubProviderPublicBucket{
				StartedAt:   periodStartedAt + int64(bucketIndex)*bucketSeconds,
				Status:      status,
				SampleCount: sampleCount,
				SuccessRate: successRate,
			}
		}
		if item.model.Online {
			profile.Stats.OnlineModelCount++
		}
		if item.model.LastProbeAt > profile.Stats.LastProbeAt {
			profile.Stats.LastProbeAt = item.model.LastProbeAt
		}
		profile.Stats.SampleCount += item.model.SampleCount
		totalSuccesses += item.successCount
		profile.Models = append(profile.Models, item.model)
	}
	profile.Stats.PublishedModelCount = len(profile.Models)
	if profile.Stats.SampleCount > 0 {
		profile.Stats.Stability7d = float64(totalSuccesses) * 100 / float64(profile.Stats.SampleCount)
	}

	sortHubPublicModels(profile.Models)
	return profile, nil
}
