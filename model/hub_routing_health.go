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
	"fmt"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
)

const HubRoutingHealthProbeStatusUnmonitored = "unmonitored"

const (
	HubRoutingHealthReasonProviderDisabled      = "provider_disabled"
	HubRoutingHealthReasonChannelManualDisabled = "channel_manually_disabled"
	HubRoutingHealthReasonChannelAutoDisabled   = "channel_auto_disabled"
	HubRoutingHealthReasonChannelDisabled       = "channel_disabled"
	HubRoutingHealthReasonSupplyUnavailable     = "supply_unavailable"
	HubRoutingHealthReasonModelUnpublished      = "model_unpublished"
	HubRoutingHealthReasonProbeUnavailable      = "probe_unavailable"
	HubRoutingHealthReasonProbeUnmonitored      = "probe_unmonitored"
	HubRoutingHealthReasonRuntimeQuarantined    = "runtime_health_quarantined"
	HubRoutingHealthReasonNoRoutableAbility     = "no_routable_ability"
)

type HubRoutingHealthListOptions struct {
	Keyword       string
	ProviderID    *int
	Model         string
	Endpoint      string
	ChannelStatus int
	ProbeStatus   string
	ServiceTier   string
	Offset        int
	Limit         int
}

type HubRoutingHealthRow struct {
	GlobalRank                  int      `json:"global_rank"`
	ChannelID                   int      `json:"channel_id"`
	ChannelName                 string   `json:"channel_name"`
	ChannelType                 int      `json:"channel_type"`
	ChannelStatus               int      `json:"channel_status"`
	ChannelStatusReason         string   `json:"channel_status_reason"`
	ProviderID                  int      `json:"provider_id"`
	ProviderName                string   `json:"provider_name"`
	ProviderStatus              string   `json:"provider_status"`
	SupplyGroupID               int      `json:"supply_group_id"`
	SupplyStatus                string   `json:"supply_status"`
	PriceMultiplier             *float64 `json:"price_multiplier"`
	ModelName                   string   `json:"model_name"`
	ModelFamily                 string   `json:"model_family"`
	EndpointType                string   `json:"endpoint_type"`
	EndpointMode                string   `json:"endpoint_mode"`
	ResolvedEndpointType        string   `json:"resolved_endpoint_type"`
	ProbeKind                   string   `json:"probe_kind"`
	Published                   bool     `json:"published"`
	EligibleServiceTiers        []string `json:"eligible_service_tiers"`
	RoutableServiceTiers        []string `json:"routable_service_tiers"`
	ProbeStatus                 string   `json:"probe_status"`
	LastProbeAt                 int64    `json:"last_probe_at"`
	LastSuccessAt               int64    `json:"last_success_at"`
	LastLatencyMs               int64    `json:"last_latency_ms"`
	LastFirstTokenMs            *int64   `json:"last_first_token_ms"`
	LastError                   string   `json:"last_error"`
	LastErrorCode               string   `json:"last_error_code"`
	ConsecutiveFailures         int      `json:"consecutive_failures"`
	ProbeRoutable               bool     `json:"probe_routable"`
	ProbeHealthState            string   `json:"probe_health_state"`
	SuspendedAt                 int64    `json:"suspended_at"`
	SuspensionReason            string   `json:"suspension_reason"`
	RealHealthState             string   `json:"real_health_state"`
	RealWindowStartedAt         int64    `json:"real_window_started_at"`
	RealSampleCount             int64    `json:"real_sample_count"`
	RealSuccessRateBps          int      `json:"real_success_rate_bps"`
	ConsecutiveUnhealthyWindows int      `json:"consecutive_unhealthy_windows"`
	RealFirstTokenSampleCount   int64    `json:"real_first_token_sample_count"`
	RealFirstTokenP50Ms         *int64   `json:"real_first_token_p50_ms"`
	RealFirstTokenP95Ms         *int64   `json:"real_first_token_p95_ms"`
	ProbeAvailabilityFactorBps  int      `json:"probe_availability_factor_bps"`
	RealAvailabilityFactorBps   int      `json:"real_availability_factor_bps"`
	AvailabilityFactorBps       int      `json:"availability_factor_bps"`
	ProbeLatencyScoreBps        int      `json:"probe_latency_score_bps"`
	RealLatencyScoreBps         int      `json:"real_latency_score_bps"`
	LatencyFactorBps            int      `json:"latency_factor_bps"`
	StaticWeight                int      `json:"static_weight"`
	EffectiveWeight             int      `json:"effective_weight"`
	RoutingHardUnavailable      bool     `json:"routing_hard_unavailable"`
	SampleCount7d               int      `json:"sample_count_7d"`
	SuccessRate7d               *float64 `json:"success_rate_7d"`
	LatencyP50Ms                *int64   `json:"latency_p50_ms"`
	LatencyP95Ms                *int64   `json:"latency_p95_ms"`
	FirstTokenP50Ms             *int64   `json:"first_token_p50_ms"`
	FirstTokenP95Ms             *int64   `json:"first_token_p95_ms"`
	ConfidenceBps               *int     `json:"confidence_bps"`
	RankingScoreBps             *int     `json:"ranking_score_bps"`
	SkipReasonCodes             []string `json:"skip_reason_codes"`
	RoutingRoutable             bool     `json:"routing_routable"`
	ServiceTierRoutable         bool     `json:"service_tier_routable"`
	probeTargetCreatedAt        int64
	probeIntervalMinutes        int
	supplyConfigVersion         int
}

type hubRoutingHealthSampleKey struct {
	groupID       int
	configVersion int
	modelName     string
	probeKind     string
}

type hubRoutingHealthGroupModelKey struct {
	groupID   int
	modelName string
}

func ListHubRoutingHealth(options HubRoutingHealthListOptions, now int64) ([]HubRoutingHealthRow, int, error) {
	if now <= 0 {
		now = common.GetTimestamp()
	}
	if options.Offset < 0 {
		options.Offset = 0
	}
	if options.Limit <= 0 {
		options.Limit = common.ItemsPerPage
	}

	channels := make([]Channel, 0)
	if err := DB.Select("id", "type", "status", "name", "models", "other_info", "weight").Order("id ASC").Find(&channels).Error; err != nil {
		return nil, 0, err
	}

	providers := make([]HubProvider, 0)
	if DB.Migrator().HasTable(&HubProvider{}) {
		if err := DB.Select("id", "name", "status").Find(&providers).Error; err != nil {
			return nil, 0, err
		}
	}
	providersByID := make(map[int]HubProvider, len(providers))
	for _, provider := range providers {
		providersByID[provider.Id] = provider
	}

	groups := make([]HubSupplyGroup, 0)
	if DB.Migrator().HasTable(&HubSupplyGroup{}) {
		if err := DB.Find(&groups).Error; err != nil {
			return nil, 0, err
		}
	}
	groupsByChannelID := make(map[int]HubSupplyGroup, len(groups))
	groupIDs := make([]int, 0, len(groups))
	for _, group := range groups {
		groupsByChannelID[group.NewAPIChannelId] = group
		groupIDs = append(groupIDs, group.Id)
	}

	targetsByGroupModel := make(map[hubRoutingHealthGroupModelKey][]HubSupplyGroupProbeTarget)
	if len(groupIDs) > 0 {
		targets := make([]HubSupplyGroupProbeTarget, 0)
		if err := DB.Where("group_id IN ?", groupIDs).Find(&targets).Error; err != nil {
			return nil, 0, err
		}
		groupVersions := make(map[int]int, len(groups))
		for _, group := range groups {
			groupVersions[group.Id] = group.ConfigVersion
		}
		for _, target := range targets {
			if groupVersions[target.GroupId] != target.ConfigVersion {
				continue
			}
			key := hubRoutingHealthGroupModelKey{groupID: target.GroupId, modelName: target.ModelName}
			targetsByGroupModel[key] = append(targetsByGroupModel[key], target)
		}
	}

	rows := make([]HubRoutingHealthRow, 0)
	for _, channel := range channels {
		group, providerOwned := groupsByChannelID[channel.Id]
		provider := providersByID[group.ProviderId]
		publishedModels := make(map[string]struct{})
		if providerOwned {
			for _, modelName := range group.GetPublishedModels(channel.Models) {
				publishedModels[modelName] = struct{}{}
			}
		}
		for _, modelName := range channel.GetModels() {
			targets := []HubSupplyGroupProbeTarget(nil)
			autoProbeDisabled := providerOwned && group.IsAutoProbeDisabled(modelName, channel.Models)
			if providerOwned {
				targets = targetsByGroupModel[hubRoutingHealthGroupModelKey{groupID: group.Id, modelName: modelName}]
			}
			if len(targets) == 0 {
				overrides := map[string]string(nil)
				if providerOwned {
					overrides = group.GetProbeEndpointOverrides(channel.Models)
				}
				targets = hubSupplyProbeDefinitionsWithOverrides(channel.Type, []string{modelName}, overrides)
				for index := range targets {
					if autoProbeDisabled {
						targets[index].Status = HubSupplyProbeStatusSkipped
					} else {
						targets[index].Status = HubRoutingHealthProbeStatusUnmonitored
					}
				}
			}
			for _, target := range targets {
				row := HubRoutingHealthRow{
					ChannelID:            channel.Id,
					ChannelName:          channel.Name,
					ChannelType:          channel.Type,
					ChannelStatus:        channel.Status,
					ChannelStatusReason:  hubRoutingHealthChannelStatusReason(&channel),
					ModelName:            modelName,
					ModelFamily:          ClassifyHubPublicModelFamily(modelName),
					EndpointType:         target.EndpointType,
					EndpointMode:         target.EndpointMode,
					ResolvedEndpointType: target.ResolvedEndpointType,
					ProbeKind:            target.ProbeKind,
					Published:            true,
					ProbeStatus:          target.Status,
					LastProbeAt:          target.LastProbeAt,
					LastSuccessAt:        target.LastSuccessAt,
					LastLatencyMs:        target.LastLatencyMs,
					LastFirstTokenMs:     target.LastFirstTokenMs,
					LastError:            target.LastError,
					LastErrorCode:        target.LastErrorCode,
					ConsecutiveFailures:  target.ConsecutiveFailures,
					ProbeRoutable:        hubSupplyProbeTargetRoutable(target),
					ProbeHealthState:     hubRoutingProbeHealthState(target),
					SuspendedAt:          target.SuspendedAt,
					SuspensionReason:     target.SuspensionReason,
					RealHealthState:      HubRoutingRealHealthUnknown,
					StaticWeight:         channel.GetWeight(),
					EligibleServiceTiers: make([]string, 0),
					RoutableServiceTiers: make([]string, 0),
					SkipReasonCodes:      make([]string, 0),
					probeTargetCreatedAt: target.CreatedAt,
				}
				if row.EndpointMode == "" {
					row.EndpointMode = HubSupplyProbeEndpointModeAuto
				}
				if providerOwned {
					multiplier := group.PriceMultiplier
					row.ProviderID = group.ProviderId
					row.ProviderName = provider.Name
					row.ProviderStatus = provider.Status
					row.SupplyGroupID = group.Id
					row.SupplyStatus = group.Status
					row.PriceMultiplier = &multiplier
					row.supplyConfigVersion = group.ConfigVersion
					_, row.Published = publishedModels[modelName]
					row.EligibleServiceTiers = hub_routing_setting.ResolveEligibleServiceTiers(row.ModelFamily, multiplier, group.ProviderId)
					row.probeIntervalMinutes = group.TextProbeMinutes
					if target.ProbeKind == HubSupplyProbeKindImage {
						row.probeIntervalMinutes = group.ImageProbeMinutes
					}
				}
				rows = append(rows, row)
			}
		}
	}

	filtered := rows[:0]
	for _, row := range rows {
		if hubRoutingHealthMatchesFilters(row, options) {
			filtered = append(filtered, row)
		}
	}
	rows = filtered
	total := len(rows)
	// Populate and rank the complete filtered set before slicing. Otherwise a
	// high-quality row can be hidden on a later alphabetic page forever.
	if err := populateHubRoutingHealthAbilities(rows); err != nil {
		return nil, 0, err
	}
	if err := populateHubRoutingHealthSamples(rows, now); err != nil {
		return nil, 0, err
	}
	for index := range rows {
		populateHubRoutingRuntimeHealth(&rows[index])
		finalizeHubRoutingHealthReasons(&rows[index])
	}
	sortHubRoutingHealthRows(rows)
	for index := range rows {
		rows[index].GlobalRank = index + 1
	}
	if options.Offset >= total {
		return []HubRoutingHealthRow{}, total, nil
	}
	end := options.Offset + options.Limit
	if end > total {
		end = total
	}
	rows = append([]HubRoutingHealthRow(nil), rows[options.Offset:end]...)
	return rows, total, nil
}

func sortHubRoutingHealthRows(rows []HubRoutingHealthRow) {
	sort.SliceStable(rows, func(left, right int) bool {
		leftRow, rightRow := rows[left], rows[right]
		if leftRow.RoutingRoutable != rightRow.RoutingRoutable {
			return leftRow.RoutingRoutable
		}
		if leftRow.RoutingHardUnavailable != rightRow.RoutingHardUnavailable {
			return !leftRow.RoutingHardUnavailable
		}
		leftHealthRank := hubRoutingHealthStateRank(leftRow.RealHealthState)
		rightHealthRank := hubRoutingHealthStateRank(rightRow.RealHealthState)
		if leftHealthRank != rightHealthRank {
			return leftHealthRank < rightHealthRank
		}
		leftHasTTFT := leftRow.RealFirstTokenSampleCount >= hubRoutingQualityMinRealSamples && leftRow.RealFirstTokenP95Ms != nil
		rightHasTTFT := rightRow.RealFirstTokenSampleCount >= hubRoutingQualityMinRealSamples && rightRow.RealFirstTokenP95Ms != nil
		if leftHasTTFT != rightHasTTFT {
			return leftHasTTFT
		}
		if leftHasTTFT && *leftRow.RealFirstTokenP95Ms != *rightRow.RealFirstTokenP95Ms {
			return *leftRow.RealFirstTokenP95Ms < *rightRow.RealFirstTokenP95Ms
		}
		leftHasReal := leftRow.RealSampleCount >= hubRoutingQualityMinRealSamples
		rightHasReal := rightRow.RealSampleCount >= hubRoutingQualityMinRealSamples
		if leftHasReal != rightHasReal {
			return leftHasReal
		}
		if leftHasReal && leftRow.RealSuccessRateBps != rightRow.RealSuccessRateBps {
			return leftRow.RealSuccessRateBps > rightRow.RealSuccessRateBps
		}
		if leftRow.RankingScoreBps != nil || rightRow.RankingScoreBps != nil {
			if leftRow.RankingScoreBps == nil {
				return false
			}
			if rightRow.RankingScoreBps == nil {
				return true
			}
			if *leftRow.RankingScoreBps != *rightRow.RankingScoreBps {
				return *leftRow.RankingScoreBps > *rightRow.RankingScoreBps
			}
		}
		if leftRow.ProviderName != rightRow.ProviderName {
			return strings.ToLower(leftRow.ProviderName) < strings.ToLower(rightRow.ProviderName)
		}
		if leftRow.ChannelName != rightRow.ChannelName {
			return strings.ToLower(leftRow.ChannelName) < strings.ToLower(rightRow.ChannelName)
		}
		if leftRow.ModelName != rightRow.ModelName {
			return strings.ToLower(leftRow.ModelName) < strings.ToLower(rightRow.ModelName)
		}
		if leftRow.EndpointType != rightRow.EndpointType {
			return leftRow.EndpointType < rightRow.EndpointType
		}
		return leftRow.ChannelID < rightRow.ChannelID
	})
}

func hubRoutingHealthStateRank(state string) int {
	switch state {
	case HubRoutingRealHealthHealthy:
		return 0
	case HubRoutingRealHealthUnknown, "":
		return 1
	case HubRoutingRealHealthDegraded:
		return 2
	case HubRoutingRealHealthUnhealthy:
		return 3
	case HubRoutingRealHealthQuarantined:
		return 4
	default:
		return 1
	}
}

func populateHubRoutingRuntimeHealth(row *HubRoutingHealthRow) {
	if row == nil {
		return
	}
	requestPath := "/v1/chat/completions"
	if row.ProbeKind == HubSupplyProbeKindImage {
		requestPath = "/v1/images/generations"
	}
	decision := GetHubRoutingDecision(row.ChannelID, row.ModelName, requestPath)
	row.ProbeAvailabilityFactorBps = decision.ProbeAvailabilityFactorBps
	row.AvailabilityFactorBps = decision.AvailabilityFactorBps
	row.ProbeLatencyScoreBps = decision.ProbeLatencyScoreBps
	row.RealLatencyScoreBps = decision.RealLatencyScoreBps
	row.LatencyFactorBps = decision.LatencyFactorBps
	row.RoutingHardUnavailable = decision.HardUnavailable
	row.EffectiveWeight = CalculateHubRoutingEffectiveWeight(row.StaticWeight, row.AvailabilityFactorBps, row.LatencyFactorBps)
	if !decision.HasRuntimeSignal {
		return
	}
	signal := decision.RuntimeSignal
	row.RealHealthState = signal.RealHealthState
	row.RealWindowStartedAt = signal.RealWindowStartedAt
	row.RealSampleCount = signal.RealSampleCount
	row.RealSuccessRateBps = signal.RealSuccessRateBps
	row.ConsecutiveUnhealthyWindows = signal.ConsecutiveUnhealthyWindows
	row.RealFirstTokenSampleCount = signal.RealFirstTokenSampleCount
	row.RealFirstTokenP50Ms = signal.RealFirstTokenP50Ms
	row.RealFirstTokenP95Ms = signal.RealFirstTokenP95Ms
	row.RealAvailabilityFactorBps = signal.RealAvailabilityFactorBps
}

func hubRoutingProbeHealthState(target HubSupplyGroupProbeTarget) string {
	if target.Status == HubSupplyProbeStatusSuspended || target.ConsecutiveFailures >= HubSupplyProbeFailureSuspendLimit {
		return HubSupplyProbeStatusSuspended
	}
	if target.ConsecutiveFailures >= HubSupplyProbeFailureThreshold {
		return "quarantined"
	}
	if target.ConsecutiveFailures == 1 {
		return "degraded"
	}
	if target.Status == HubSupplyProbeStatusAvailable {
		return HubRoutingRealHealthHealthy
	}
	return target.Status
}

func hubRoutingHealthMatchesFilters(row HubRoutingHealthRow, options HubRoutingHealthListOptions) bool {
	keyword := strings.ToLower(strings.TrimSpace(options.Keyword))
	if keyword != "" &&
		!strings.Contains(strings.ToLower(row.ChannelName), keyword) &&
		!strings.Contains(strings.ToLower(row.ProviderName), keyword) &&
		!strings.Contains(strings.ToLower(row.ModelName), keyword) {
		return false
	}
	if options.ProviderID != nil && row.ProviderID != *options.ProviderID {
		return false
	}
	if modelName := strings.ToLower(strings.TrimSpace(options.Model)); modelName != "" &&
		!strings.Contains(strings.ToLower(row.ModelName), modelName) {
		return false
	}
	if endpoint := strings.TrimSpace(options.Endpoint); endpoint != "" &&
		row.EndpointType != endpoint && row.ResolvedEndpointType != endpoint {
		return false
	}
	if options.ChannelStatus > 0 && row.ChannelStatus != options.ChannelStatus {
		return false
	}
	if probeStatus := strings.TrimSpace(options.ProbeStatus); probeStatus != "" && row.ProbeStatus != probeStatus {
		return false
	}
	if serviceTier := strings.TrimSpace(options.ServiceTier); serviceTier != "" {
		for _, tier := range row.EligibleServiceTiers {
			if tier == serviceTier {
				return true
			}
		}
		return false
	}
	return true
}

func populateHubRoutingHealthAbilities(rows []HubRoutingHealthRow) error {
	if len(rows) == 0 {
		return nil
	}
	channelIDs := make([]int, 0, len(rows))
	models := make([]string, 0, len(rows))
	for _, row := range rows {
		channelIDs = append(channelIDs, row.ChannelID)
		models = append(models, row.ModelName)
	}
	abilities := make([]Ability, 0)
	if err := DB.Where("channel_id IN ? AND model IN ? AND enabled = ?", channelIDs, models, true).Find(&abilities).Error; err != nil {
		return err
	}
	tiersByChannelModel := make(map[string]map[string]struct{})
	routableByChannelModel := make(map[string]struct{})
	for _, ability := range abilities {
		key := fmt.Sprintf("%d\n%s", ability.ChannelId, ability.Model)
		if isHubTokenRoutingCandidateAbilityGroup(ability.Group) {
			routableByChannelModel[key] = struct{}{}
		}
		if !hub_routing_setting.IsServiceTier(ability.Group) {
			continue
		}
		if tiersByChannelModel[key] == nil {
			tiersByChannelModel[key] = make(map[string]struct{})
		}
		tiersByChannelModel[key][ability.Group] = struct{}{}
	}
	for index := range rows {
		key := fmt.Sprintf("%d\n%s", rows[index].ChannelID, rows[index].ModelName)
		_, rows[index].RoutingRoutable = routableByChannelModel[key]
		for _, tier := range hub_routing_setting.ServiceTiers() {
			if _, ok := tiersByChannelModel[key][tier]; ok {
				rows[index].RoutableServiceTiers = append(rows[index].RoutableServiceTiers, tier)
			}
		}
		rows[index].ServiceTierRoutable = len(rows[index].RoutableServiceTiers) > 0
	}
	return nil
}

func populateHubRoutingHealthSamples(rows []HubRoutingHealthRow, now int64) error {
	groupIDs := make([]int, 0, len(rows))
	for _, row := range rows {
		if row.SupplyGroupID > 0 {
			groupIDs = append(groupIDs, row.SupplyGroupID)
		}
	}
	if len(groupIDs) == 0 {
		return nil
	}
	periodStartedAt := now - hubProviderPublicPeriodSeconds
	samples := make([]HubSupplyGroupProbeSample, 0)
	if err := DB.Where("group_id IN ? AND probed_at >= ? AND probed_at <= ?", groupIDs, periodStartedAt, now).
		Find(&samples).Error; err != nil {
		return err
	}
	samplesByKey := make(map[hubRoutingHealthSampleKey][]hubRankingSample)
	for _, sample := range samples {
		key := hubRoutingHealthSampleKey{
			groupID: sample.GroupId, configVersion: sample.ConfigVersion, modelName: sample.ModelName,
			probeKind: sample.ProbeKind,
		}
		samplesByKey[key] = append(samplesByKey[key], hubRankingSample{
			Success: sample.Success, LatencyMs: sample.LatencyMs, FirstTokenMs: sample.FirstTokenMs,
			ErrorCode: sample.ErrorCode, ErrorMessage: sample.ErrorMessage, ProbedAt: sample.ProbedAt,
		})
	}
	bucketSeconds := hubProviderPublicPeriodSeconds / hubRankingBucketCount
	for index := range rows {
		row := &rows[index]
		if row.SupplyGroupID <= 0 {
			continue
		}
		key := hubRoutingHealthSampleKey{
			groupID: row.SupplyGroupID, configVersion: row.supplyConfigVersion, modelName: row.ModelName,
			probeKind: row.ProbeKind,
		}
		allSamples := samplesByKey[key]
		rankingSamples := make([]hubRankingSample, 0, len(allSamples))
		latencies := make([]int64, 0, len(allSamples))
		firstTokens := make([]int64, 0, len(allSamples))
		successCount := 0
		var sampleCounts [hubRankingBucketCount]int
		var expectedCounts [hubRankingBucketCount]int
		for bucketIndex := 0; bucketIndex < hubRankingBucketCount; bucketIndex++ {
			bucketStart := periodStartedAt + int64(bucketIndex)*bucketSeconds
			expectedCounts[bucketIndex] = hubRankingExpectedSamplesForBucket(
				bucketStart, bucketStart+bucketSeconds, row.probeTargetCreatedAt, row.probeIntervalMinutes,
			)
		}
		for _, sample := range allSamples {
			if !isHubRankingSample(sample) {
				continue
			}
			rankingSamples = append(rankingSamples, sample)
			bucketIndex := int((sample.ProbedAt - periodStartedAt) / bucketSeconds)
			if bucketIndex >= 0 && bucketIndex < hubRankingBucketCount {
				sampleCounts[bucketIndex]++
			}
			if !sample.Success {
				continue
			}
			successCount++
			if sample.LatencyMs > 0 {
				latencies = append(latencies, sample.LatencyMs)
			}
			if sample.FirstTokenMs != nil && *sample.FirstTokenMs >= 0 {
				firstTokens = append(firstTokens, *sample.FirstTokenMs)
			}
		}
		row.SampleCount7d = len(rankingSamples)
		if row.SampleCount7d == 0 {
			continue
		}
		successRate := float64(successCount) * 100 / float64(row.SampleCount7d)
		row.SuccessRate7d = &successRate
		row.LatencyP50Ms = hubRankingPercentile(latencies, 50)
		row.LatencyP95Ms = hubRankingPercentile(latencies, 95)
		row.FirstTokenP50Ms = hubRankingPercentile(firstTokens, 50)
		row.FirstTokenP95Ms = hubRankingPercentile(firstTokens, 95)
		validBucketCount := hubRankingValidBucketCount(sampleCounts, expectedCounts)
		confidence := hubRankingConfidenceBps(row.SampleCount7d, validBucketCount)
		row.ConfidenceBps = &confidence
		if row.SampleCount7d >= hubRankingMinSamples {
			availabilityBps := int(successRate*100 + 0.5)
			pausePenalty := hubRankingPausePenaltyBps(hubRankingQuotaPauseStartedAt(allSamples), now)
			score := calculateHubRankingScoreBps(
				availabilityBps, row.FirstTokenP50Ms, row.FirstTokenP95Ms,
				row.SampleCount7d, validBucketCount, pausePenalty,
			)
			row.RankingScoreBps = &score
		}
	}
	return nil
}

func finalizeHubRoutingHealthReasons(row *HubRoutingHealthRow) {
	if row == nil {
		return
	}
	blocked := false
	if row.ProviderID > 0 && row.ProviderStatus != HubProviderStatusActive {
		row.SkipReasonCodes = append(row.SkipReasonCodes, HubRoutingHealthReasonProviderDisabled)
		blocked = true
	}
	switch row.ChannelStatus {
	case common.ChannelStatusManuallyDisabled:
		row.SkipReasonCodes = append(row.SkipReasonCodes, HubRoutingHealthReasonChannelManualDisabled)
		blocked = true
	case common.ChannelStatusAutoDisabled:
		row.SkipReasonCodes = append(row.SkipReasonCodes, HubRoutingHealthReasonChannelAutoDisabled)
		blocked = true
	case common.ChannelStatusEnabled:
	default:
		row.SkipReasonCodes = append(row.SkipReasonCodes, HubRoutingHealthReasonChannelDisabled)
		blocked = true
	}
	if row.ProviderID > 0 {
		if row.SupplyStatus != HubSupplyGroupStatusAvailable && row.SupplyStatus != HubSupplyGroupStatusPartial {
			row.SkipReasonCodes = append(row.SkipReasonCodes, HubRoutingHealthReasonSupplyUnavailable)
			blocked = true
		}
		if !row.Published {
			row.SkipReasonCodes = append(row.SkipReasonCodes, HubRoutingHealthReasonModelUnpublished)
			blocked = true
		}
	}
	if row.ProbeStatus == HubRoutingHealthProbeStatusUnmonitored {
		row.SkipReasonCodes = append(row.SkipReasonCodes, HubRoutingHealthReasonProbeUnmonitored)
		blocked = blocked || row.ProviderID > 0
	} else if row.RoutingHardUnavailable {
		if row.RealHealthState == HubRoutingRealHealthQuarantined {
			row.SkipReasonCodes = append(row.SkipReasonCodes, HubRoutingHealthReasonRuntimeQuarantined)
		} else {
			row.SkipReasonCodes = append(row.SkipReasonCodes, HubRoutingHealthReasonProbeUnavailable)
		}
		blocked = blocked || row.ProviderID > 0
	}
	if blocked {
		row.RoutableServiceTiers = []string{}
		row.RoutingRoutable = false
		row.ServiceTierRoutable = false
	} else if len(row.EligibleServiceTiers) > 0 && len(row.RoutableServiceTiers) == 0 {
		row.SkipReasonCodes = append(row.SkipReasonCodes, HubRoutingHealthReasonNoRoutableAbility)
	}
}

func hubRoutingHealthChannelStatusReason(channel *Channel) string {
	if channel == nil {
		return ""
	}
	reason, ok := channel.GetOtherInfo()["status_reason"]
	if !ok || reason == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(reason))
}
