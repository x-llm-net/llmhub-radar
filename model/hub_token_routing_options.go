package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
)

type hubTokenRoutingChannelRow struct {
	ChannelID       int
	Name            string
	ChannelModels   string
	PublishedModels string
	Multiplier      float64
	ChannelStatus   int
	ProviderStatus  string
	TenantPublished bool
}

func getHubTokenRoutingChannels(providerID int, channelIDs []int) ([]HubTokenRoutingChannel, error) {
	if DB == nil || providerID <= 0 {
		return nil, errors.New("routing provider is unavailable")
	}
	var rows []hubTokenRoutingChannelRow
	query := DB.Table("hub_supply_groups AS supply_groups").
		Select("channels.id AS channel_id, channels.name, channels.models AS channel_models, channels.status AS channel_status, supply_groups.published_models, supply_groups.price_multiplier AS multiplier, supply_groups.tenant_published, providers.status AS provider_status").
		Joins("JOIN channels ON channels.id = supply_groups.new_api_channel_id").
		Joins("JOIN hub_providers AS providers ON providers.id = supply_groups.provider_id").
		Where("supply_groups.provider_id = ?", providerID)
	if len(channelIDs) > 0 {
		query = query.Where("channels.id IN ?", channelIDs)
	}
	if err := query.Order("supply_groups.price_multiplier ASC, channels.id ASC").Scan(&rows).Error; err != nil {
		return nil, err
	}
	channels := make([]HubTokenRoutingChannel, 0, len(rows))
	for _, row := range rows {
		group := HubSupplyGroup{PublishedModels: row.PublishedModels}
		models := group.GetPublishedModels(row.ChannelModels)
		configuredModels := normalizeHubSupplyModelNames(row.ChannelModels)
		familySet := make(map[string]struct{})
		modelFamilies := make([]string, 0)
		for _, modelName := range models {
			family := ClassifyHubPublicModelFamily(modelName)
			if common.IsImageGenerationModel(modelName) {
				family = "image"
			}
			if _, exists := familySet[family]; !exists {
				familySet[family] = struct{}{}
				modelFamilies = append(modelFamilies, family)
			}
		}
		channels = append(channels, HubTokenRoutingChannel{
			ChannelID: row.ChannelID, Name: row.Name, Multiplier: roundHubTokenMultiplier(row.Multiplier), Models: models, ConfiguredModels: configuredModels, ModelFamilies: modelFamilies,
			Available: row.ChannelStatus == common.ChannelStatusEnabled && row.ProviderStatus == HubProviderStatusActive &&
				row.TenantPublished && validHubTokenMultiplier(row.Multiplier) && len(models) > 0,
		})
	}
	return channels, nil
}

func GetHubTokenRoutingOptions(providerID int) (*HubTokenRoutingOptions, error) {
	if providerID <= 0 || DB == nil {
		return nil, errors.New("routing provider is unavailable")
	}
	var provider HubProvider
	if err := DB.Select("id", "name", "slug").First(&provider, providerID).Error; err != nil {
		return nil, err
	}
	channels, err := getHubTokenRoutingChannels(providerID, nil)
	if err != nil {
		return nil, err
	}
	return &HubTokenRoutingOptions{
		Mode: HubTokenRoutingModeChannels, ProviderID: providerID,
		ProviderName: provider.Name, ProviderSlug: provider.Slug,
		Channels: channels, MaxSelections: HubTokenRoutingMaxSelections,
	}, nil
}

func ValidateHubTokenProviderSelections(policy *HubTokenRoutingPolicy) error {
	if policy == nil {
		return nil
	}
	resolved, err := ResolveHubTokenRoutingPolicy(policy)
	if err != nil {
		return err
	}
	if len(resolved.Channels) != len(policy.ChannelIDs) {
		return errors.New("selected channel does not belong to this provider or no longer exists")
	}
	for _, channel := range resolved.Channels {
		if !validHubTokenMultiplier(channel.Multiplier) {
			return fmt.Errorf("channel %d has invalid pricing", channel.ChannelID)
		}
	}
	return nil
}
