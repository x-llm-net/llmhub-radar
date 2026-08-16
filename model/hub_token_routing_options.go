package model

import (
	"fmt"
	"math"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
)

var hubTokenRoutingFamilyOrder = []string{
	"openai", "anthropic", "google", "xai", "deepseek", "alibaba", "bytedance", "zhipu", "other",
}

type hubTokenRoutingOptionRow struct {
	ChannelID      int
	ModelName      string
	AbilityGroup   string
	ChannelStatus  int
	ProviderID     int
	ProviderStatus string
	Multiplier     float64
}

func GetHubTokenRoutingOptions(providerID int) (*HubTokenRoutingOptions, error) {
	options := &HubTokenRoutingOptions{
		Mode:         HubTokenRoutingModePublic,
		ProviderID:   providerID,
		Families:     make([]HubTokenRoutingFamilyOption, 0),
		TierCeilings: hub_routing_setting.GetFamilyTierCeilings(),
	}
	if providerID > 0 {
		options.Mode = HubTokenRoutingModeProvider
		var provider HubProvider
		if err := DB.Select("id", "name", "slug").First(&provider, providerID).Error; err != nil {
			return nil, err
		}
		options.ProviderName = provider.Name
		options.ProviderSlug = provider.Slug
	}
	if DB == nil || !DB.Migrator().HasTable(&Ability{}) {
		return options, nil
	}

	rows := make([]hubTokenRoutingOptionRow, 0)
	query := DB.Table("abilities AS abilities").
		Select("abilities.channel_id, abilities.model AS model_name, abilities."+abilityGroupColumn()+" AS ability_group, channels.status AS channel_status, COALESCE(supply_groups.provider_id, 0) AS provider_id, COALESCE(providers.status, '') AS provider_status, COALESCE(supply_groups.price_multiplier, 1) AS multiplier").
		Joins("JOIN channels ON channels.id = abilities.channel_id").
		Joins("LEFT JOIN hub_supply_groups AS supply_groups ON supply_groups.new_api_channel_id = abilities.channel_id").
		Joins("LEFT JOIN hub_providers AS providers ON providers.id = supply_groups.provider_id").
		Where("abilities.enabled = ? AND channels.status = ?", true, common.ChannelStatusEnabled)
	if providerID > 0 {
		query = query.Where("supply_groups.provider_id = ?", providerID)
	}
	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}

	type familyChannelKey struct {
		family    string
		channelID int
	}
	seenChannels := make(map[familyChannelKey]struct{})
	byFamily := make(map[string]map[float64]HubTokenRoutingAvailability)
	providersByFamily := make(map[string]map[float64]map[int]struct{})
	for _, row := range rows {
		if row.ChannelStatus != common.ChannelStatusEnabled ||
			(row.AbilityGroup != "default" && !hub_routing_setting.IsServiceTier(row.AbilityGroup)) ||
			(row.ProviderID > 0 && row.ProviderStatus != HubProviderStatusActive) {
			continue
		}
		family := ClassifyHubPublicModelFamily(row.ModelName)
		key := familyChannelKey{family: family, channelID: row.ChannelID}
		if _, exists := seenChannels[key]; exists {
			continue
		}
		seenChannels[key] = struct{}{}
		if byFamily[family] == nil {
			byFamily[family] = make(map[float64]HubTokenRoutingAvailability)
		}
		if providersByFamily[family] == nil {
			providersByFamily[family] = make(map[float64]map[int]struct{})
		}
		multiplier := roundHubTokenMultiplier(row.Multiplier)
		if !validHubTokenMultiplier(multiplier) {
			continue
		}
		bucket := byFamily[family][multiplier]
		bucket.Multiplier = multiplier
		bucket.ChannelCount++
		if row.ProviderID > 0 {
			if providersByFamily[family][multiplier] == nil {
				providersByFamily[family][multiplier] = make(map[int]struct{})
			}
			providersByFamily[family][multiplier][row.ProviderID] = struct{}{}
		}
		byFamily[family][multiplier] = bucket
	}

	for _, family := range hubTokenRoutingFamilyOrder {
		buckets := byFamily[family]
		if len(buckets) == 0 && providerID > 0 {
			continue
		}
		availability := make([]HubTokenRoutingAvailability, 0, len(buckets))
		for multiplier, bucket := range buckets {
			providerIDs := make([]int, 0, len(providersByFamily[family][multiplier]))
			for currentProviderID := range providersByFamily[family][multiplier] {
				providerIDs = append(providerIDs, currentProviderID)
			}
			sort.Ints(providerIDs)
			bucket.ProviderCount = len(providerIDs)
			bucket.ProviderIDs = providerIDs
			availability = append(availability, bucket)
		}
		sort.Slice(availability, func(i, j int) bool {
			return availability[i].Multiplier < availability[j].Multiplier
		})
		option := HubTokenRoutingFamilyOption{
			Key:              family,
			MinMultiplier:    HubTokenRoutingMinMultiplier,
			MaxMultiplier:    1,
			Step:             HubTokenRoutingMultiplierStep,
			Availability:     availability,
			ExactMultipliers: make([]float64, 0, len(availability)),
		}
		if len(availability) > 0 && availability[len(availability)-1].Multiplier > option.MaxMultiplier {
			option.MaxMultiplier = availability[len(availability)-1].Multiplier
		}
		if option.MaxMultiplier < 1 {
			option.MaxMultiplier = 1
		}
		providerSet := make(map[int]struct{})
		for _, row := range rows {
			if ClassifyHubPublicModelFamily(row.ModelName) != family || row.ProviderID <= 0 ||
				(row.AbilityGroup != "default" && !hub_routing_setting.IsServiceTier(row.AbilityGroup)) ||
				(row.ProviderID > 0 && row.ProviderStatus != HubProviderStatusActive) {
				continue
			}
			if providerID > 0 && row.ProviderID != providerID {
				continue
			}
			providerSet[row.ProviderID] = struct{}{}
		}
		option.AvailableChannelCount = 0
		for _, bucket := range availability {
			option.AvailableChannelCount += bucket.ChannelCount
			option.ExactMultipliers = append(option.ExactMultipliers, bucket.Multiplier)
		}
		option.ProviderCount = len(providerSet)
		options.Families = append(options.Families, option)
	}
	return options, nil
}

func ValidateHubTokenProviderSelections(policy *HubTokenRoutingPolicy) error {
	if policy == nil || policy.Mode != HubTokenRoutingModeProvider {
		return nil
	}
	options, err := GetHubTokenRoutingOptions(policy.ProviderID)
	if err != nil {
		return err
	}
	available := make(map[string][]float64, len(options.Families))
	for _, option := range options.Families {
		available[option.Key] = option.ExactMultipliers
	}
	for _, selection := range policy.Selections {
		for _, requested := range selection.ExactMultipliers {
			matched := false
			for _, candidate := range available[selection.Family] {
				if math.Abs(candidate-requested) < 0.0005 {
					matched = true
					break
				}
			}
			if !matched {
				return fmt.Errorf("provider does not publish multiplier %.3f for %s", requested, selection.Family)
			}
		}
	}
	return nil
}
