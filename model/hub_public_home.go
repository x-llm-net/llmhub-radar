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
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_public_home_setting"
)

type HubPublicHomeProvider struct {
	Provider           HubProviderPublicIdentity `json:"provider"`
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
	rankingScoreBps    int
}

type HubPublicHomeModel struct {
	ModelName           string                  `json:"model_name"`
	ProviderCount       int                     `json:"provider_count"`
	OnlineProviderCount int                     `json:"online_provider_count"`
	Providers           []HubPublicHomeProvider `json:"providers"`
}

type HubPublicHomeFamily struct {
	Key    string               `json:"key"`
	Models []HubPublicHomeModel `json:"models"`
}

type HubPublicHome struct {
	ProviderCount       int                   `json:"provider_count"`
	PublishedModelCount int                   `json:"published_model_count"`
	LastProbeAt         int64                 `json:"last_probe_at"`
	GeneratedAt         int64                 `json:"generated_at"`
	Families            []HubPublicHomeFamily `json:"families"`
}

type hubPublicHomeProviderModelKey struct {
	providerID int
	modelName  string
}

type hubPublicHomeAccumulator struct {
	provider              HubProviderPublicIdentity
	model                 HubProviderPublicModel
	successCount          int
	latencyTotalMs        int64
	latencySampleCount    int
	firstTokenValues      []int64
	rankingScoreBps       int
	validBucketCount      int
	pausePenaltyBps       int
	groupIDs              map[int]struct{}
	bucketSuccessCounts   [hubProviderPublicBucketCount]int
	bucketSampleCounts    [hubProviderPublicBucketCount]int
	rankingBucketCounts   [hubRankingBucketCount]int
	rankingExpectedCounts [hubRankingBucketCount]int
}

func GetHubPublicHome(now int64) (*HubPublicHome, error) {
	if now <= 0 {
		now = common.GetTimestamp()
	}
	home := &HubPublicHome{
		GeneratedAt: now,
		Families:    make([]HubPublicHomeFamily, 0),
	}
	modelBlacklist := make(map[string]struct{})
	for _, modelName := range hub_public_home_setting.GetModelBlacklist() {
		modelBlacklist[modelName] = struct{}{}
	}

	providers := make([]HubProvider, 0)
	if err := DB.Where("status = ?", HubProviderStatusActive).Order("id ASC").Find(&providers).Error; err != nil {
		return nil, err
	}
	home.ProviderCount = len(providers)
	if len(providers) == 0 {
		return home, nil
	}
	if err := hydrateHubProvidersPublicURLs(providers); err != nil {
		return nil, err
	}

	providerIdentities := make(map[int]HubProviderPublicIdentity, len(providers))
	for i := range providers {
		provider := &providers[i]
		HydrateHubProviderLogoURL(
			provider,
			hubProviderPublicAssetURL(*provider, "/api/hub/public/providers/"+provider.Slug+"/logo?v="+strconv.Itoa(provider.LogoAssetId)),
		)
		providerIdentities[provider.Id] = HubProviderPublicIdentity{
			Id:           provider.Id,
			Name:         provider.Name,
			Slug:         provider.Slug,
			Website:      PublicHubProviderWebsite(*provider),
			Description:  provider.Description,
			LogoURL:      provider.LogoURL,
			SupportType:  provider.SupportType,
			SupportValue: provider.SupportValue,
			PublicURL:    provider.PublicURL,
		}
	}

	groups, err := GetAllHubSupplyGroupsWithChannels()
	if err != nil {
		return nil, err
	}
	groupIDs := make([]int, 0, len(groups))
	groupVersions := make(map[int]int, len(groups))
	publishedByGroup := make(map[int]map[string]struct{}, len(groups))
	accumulators := make(map[hubPublicHomeProviderModelKey]*hubPublicHomeAccumulator)
	for i := range groups {
		group := &groups[i]
		identity, active := providerIdentities[group.ProviderId]
		if !active {
			continue
		}
		if !group.TenantPublished {
			continue
		}
		publishedModels := group.GetPublishedModels(group.ChannelModels)
		if len(publishedModels) == 0 {
			continue
		}
		groupIDs = append(groupIDs, group.Id)
		groupVersions[group.Id] = group.ConfigVersion
		publishedSet := make(map[string]struct{}, len(publishedModels))
		publishedByGroup[group.Id] = publishedSet
		for _, modelName := range publishedModels {
			if _, blacklisted := modelBlacklist[modelName]; blacklisted {
				continue
			}
			publishedSet[modelName] = struct{}{}
			key := hubPublicHomeProviderModelKey{providerID: group.ProviderId, modelName: modelName}
			item := accumulators[key]
			if item == nil {
				item = &hubPublicHomeAccumulator{
					provider: identity,
					groupIDs: make(map[int]struct{}),
					model: HubProviderPublicModel{
						ModelName:          modelName,
						FamilyKey:          classifyHubPublicModelFamily(modelName),
						MinPriceMultiplier: group.PriceMultiplier,
					},
				}
				accumulators[key] = item
			}
			item.groupIDs[group.Id] = struct{}{}
			item.model.ChannelCount++
			if group.PriceMultiplier > 0 && (item.model.MinPriceMultiplier <= 0 || group.PriceMultiplier < item.model.MinPriceMultiplier) {
				item.model.MinPriceMultiplier = group.PriceMultiplier
			}
		}
	}
	if len(groupIDs) == 0 {
		return home, nil
	}

	periodStartedAt := now - hubProviderPublicPeriodSeconds
	rankingBucketSeconds := hubProviderPublicPeriodSeconds / hubRankingBucketCount
	groupProviderIDs := make(map[int]int, len(groupIDs))
	groupsByID := make(map[int]*HubSupplyGroupWithChannel, len(groupIDs))
	for i := range groups {
		if _, included := publishedByGroup[groups[i].Id]; !included {
			continue
		}
		groupProviderIDs[groups[i].Id] = groups[i].ProviderId
		groupsByID[groups[i].Id] = &groups[i]
	}

	targets := make([]HubSupplyGroupProbeTarget, 0)
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
		group := groupsByID[target.GroupId]
		item := accumulators[hubPublicHomeProviderModelKey{
			providerID: groupProviderIDs[target.GroupId],
			modelName:  target.ModelName,
		}]
		if group == nil || item == nil {
			continue
		}
		probeMinutes := group.TextProbeMinutes
		if target.ProbeKind == HubSupplyProbeKindImage {
			probeMinutes = group.ImageProbeMinutes
		}
		if probeMinutes <= 0 {
			probeMinutes = HubSupplyGroupDefaultTextProbeMinutes
			if target.ProbeKind == HubSupplyProbeKindImage {
				probeMinutes = HubSupplyGroupDefaultImageProbeMinutes
			}
		}
		for bucketIndex := 0; bucketIndex < hubRankingBucketCount; bucketIndex++ {
			bucketStart := periodStartedAt + int64(bucketIndex)*rankingBucketSeconds
			bucketEnd := bucketStart + rankingBucketSeconds
			item.rankingExpectedCounts[bucketIndex] += hubRankingExpectedSamplesForBucket(
				bucketStart,
				bucketEnd,
				target.CreatedAt,
				probeMinutes,
			)
		}
	}

	for i := range groups {
		group := &groups[i]
		publishedModels := publishedByGroup[group.Id]
		for modelName := range publishedModels {
			item := accumulators[hubPublicHomeProviderModelKey{providerID: group.ProviderId, modelName: modelName}]
			if item == nil {
				continue
			}
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
				item.model.Online = true
				item.model.OnlineChannelCount++
			}
		}
	}

	samples := make([]HubSupplyGroupProbeSample, 0)
	if err := DB.Select("group_id", "config_version", "model_name", "probe_kind", "success", "latency_ms", "first_token_ms", "error_code", "error_message", "probed_at").
		Where("group_id IN ? AND probed_at >= ? AND probed_at <= ?", groupIDs, periodStartedAt, now).
		Find(&samples).Error; err != nil {
		return nil, err
	}
	bucketSeconds := hubProviderPublicPeriodSeconds / hubProviderPublicBucketCount
	groupModelSamples := make(map[hubProviderPublicGroupModelKey][]hubRankingSample)
	for _, sample := range samples {
		if groupVersions[sample.GroupId] != sample.ConfigVersion {
			continue
		}
		if _, published := publishedByGroup[sample.GroupId][sample.ModelName]; !published {
			continue
		}
		item := accumulators[hubPublicHomeProviderModelKey{
			providerID: groupProviderIDs[sample.GroupId],
			modelName:  sample.ModelName,
		}]
		if item == nil {
			continue
		}
		rankingSample := hubRankingSample{
			Success: sample.Success, LatencyMs: sample.LatencyMs, FirstTokenMs: sample.FirstTokenMs,
			ErrorCode: sample.ErrorCode, ErrorMessage: sample.ErrorMessage, ProbedAt: sample.ProbedAt,
		}
		groupModelKey := hubProviderPublicGroupModelKey{groupID: sample.GroupId, modelName: sample.ModelName}
		groupModelSamples[groupModelKey] = append(groupModelSamples[groupModelKey], rankingSample)
		bucketIndex := int((sample.ProbedAt - periodStartedAt) / bucketSeconds)
		if bucketIndex < 0 {
			continue
		}
		if bucketIndex >= hubProviderPublicBucketCount {
			bucketIndex = hubProviderPublicBucketCount - 1
		}
		if sample.ProbedAt > item.model.LastProbeAt {
			item.model.LastProbeAt = sample.ProbedAt
		}
		if !isHubRankingSample(rankingSample) {
			continue
		}
		item.model.SampleCount++
		item.bucketSampleCounts[bucketIndex]++
		rankingBucketIndex := int((sample.ProbedAt - periodStartedAt) / rankingBucketSeconds)
		if rankingBucketIndex >= 0 && rankingBucketIndex < hubRankingBucketCount {
			item.rankingBucketCounts[rankingBucketIndex]++
		}
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
	for key, item := range accumulators {
		groupSamples := make([][]hubRankingSample, 0, len(item.groupIDs))
		for groupID := range item.groupIDs {
			groupSamples = append(groupSamples, groupModelSamples[hubProviderPublicGroupModelKey{
				groupID: groupID, modelName: key.modelName,
			}])
		}
		pausedSince := hubRankingAllSuppliesPausedSince(groupSamples)
		if pausedSince > 0 {
			item.pausePenaltyBps = hubRankingPausePenaltyBps(pausedSince, now)
		}
	}

	modelsByName := make(map[string]*HubPublicHomeModel)
	for _, item := range accumulators {
		finalizeHubPublicHomeAccumulator(item, periodStartedAt, bucketSeconds)
		row := HubPublicHomeProvider{
			Provider:           item.provider,
			Online:             item.model.Online,
			ChannelCount:       item.model.ChannelCount,
			OnlineChannelCount: item.model.OnlineChannelCount,
			MinPriceMultiplier: item.model.MinPriceMultiplier,
			Stability7d:        item.model.Stability7d,
			SampleCount:        item.model.SampleCount,
			AverageLatencyMs:   item.model.AverageLatencyMs,
			FirstTokenP50Ms:    item.model.FirstTokenP50Ms,
			FirstTokenP95Ms:    item.model.FirstTokenP95Ms,
			LastProbeAt:        item.model.LastProbeAt,
			Timeline:           item.model.Timeline,
			rankingScoreBps:    item.rankingScoreBps,
		}
		model := modelsByName[item.model.ModelName]
		if model == nil {
			model = &HubPublicHomeModel{
				ModelName: item.model.ModelName,
				Providers: make([]HubPublicHomeProvider, 0),
			}
			modelsByName[item.model.ModelName] = model
		}
		model.Providers = append(model.Providers, row)
		if row.Online {
			model.OnlineProviderCount++
		}
		if row.LastProbeAt > home.LastProbeAt {
			home.LastProbeAt = row.LastProbeAt
		}
	}
	home.PublishedModelCount = len(modelsByName)

	families := make(map[string][]HubPublicHomeModel)
	for _, model := range modelsByName {
		model.ProviderCount = len(model.Providers)
		sort.Slice(model.Providers, func(i, j int) bool {
			return hubPublicHomeProviderLess(model.Providers[i], model.Providers[j])
		})
		familyKey := classifyHubPublicModelFamily(model.ModelName)
		families[familyKey] = append(families[familyKey], *model)
	}
	for _, familyKey := range hubPublicModelFamilyOrder {
		models := families[familyKey]
		if len(models) == 0 {
			continue
		}
		sort.SliceStable(models, func(i, j int) bool {
			return hubPublicModelNameLess(familyKey, models[i].ModelName, models[j].ModelName)
		})
		home.Families = append(home.Families, HubPublicHomeFamily{Key: familyKey, Models: models})
	}
	return home, nil
}

func finalizeHubPublicHomeAccumulator(item *hubPublicHomeAccumulator, periodStartedAt, bucketSeconds int64) {
	if item.model.SampleCount > 0 {
		item.model.Stability7d = float64(item.successCount) * 100 / float64(item.model.SampleCount)
	}
	if item.latencySampleCount > 0 {
		item.model.AverageLatencyMs = item.latencyTotalMs / int64(item.latencySampleCount)
	}
	item.model.FirstTokenP50Ms = hubRankingPercentile(item.firstTokenValues, 50)
	item.model.FirstTokenP95Ms = hubRankingPercentile(item.firstTokenValues, 95)
	item.validBucketCount = hubRankingValidBucketCount(item.rankingBucketCounts, item.rankingExpectedCounts)
	if item.model.SampleCount >= hubRankingMinSamples {
		availabilityBps := int(item.model.Stability7d*100 + 0.5)
		item.rankingScoreBps = calculateHubRankingScoreBps(
			availabilityBps,
			item.model.FirstTokenP50Ms,
			item.model.FirstTokenP95Ms,
			item.model.SampleCount,
			item.validBucketCount,
			item.pausePenaltyBps,
		)
	}
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
}

func hubPublicHomeProviderLess(left, right HubPublicHomeProvider) bool {
	if left.rankingScoreBps != right.rankingScoreBps {
		return left.rankingScoreBps > right.rankingScoreBps
	}
	if left.Online != right.Online {
		return left.Online
	}
	if left.Stability7d != right.Stability7d {
		return left.Stability7d > right.Stability7d
	}
	if left.SampleCount != right.SampleCount {
		return left.SampleCount > right.SampleCount
	}
	if left.AverageLatencyMs != right.AverageLatencyMs {
		if left.AverageLatencyMs == 0 {
			return false
		}
		if right.AverageLatencyMs == 0 {
			return true
		}
		return left.AverageLatencyMs < right.AverageLatencyMs
	}
	leftName := strings.ToLower(left.Provider.Name)
	rightName := strings.ToLower(right.Provider.Name)
	if leftName != rightName {
		return leftName < rightName
	}
	return left.Provider.Id < right.Provider.Id
}
