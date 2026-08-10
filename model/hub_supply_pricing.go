package model

import "sync"

type HubSupplyPricing struct {
	SupplyGroupId        int
	SupplyProviderId     int
	SupplyProviderStatus string
	SupplyOwnerUserId    int
	PriceMultiplier      float64
}

type HubProviderRoutingInfo struct {
	Id     int
	Slug   string
	Status string
}

type ChannelProviderFilterMode int

const (
	ChannelProviderAny ChannelProviderFilterMode = iota
	ChannelProviderOnly
	ChannelProviderExclude
)

type ChannelProviderFilter struct {
	ProviderID             int
	Mode                   ChannelProviderFilterMode
	StrictExcludedChannels bool
}

var (
	hubSupplyPricingMu        sync.RWMutex
	hubSupplyPricingByChannel = map[int]HubSupplyPricing{}
	hubProviderRoutingBySlug  = map[string]HubProviderRoutingInfo{}
)

func RefreshHubSupplyPricingCache() error {
	pricingByChannel := make(map[int]HubSupplyPricing)
	providerBySlug := make(map[string]HubProviderRoutingInfo)
	if DB == nil || !DB.Migrator().HasTable(&HubSupplyGroup{}) || !DB.Migrator().HasTable(&HubProvider{}) {
		hubSupplyPricingMu.Lock()
		hubSupplyPricingByChannel = pricingByChannel
		hubProviderRoutingBySlug = providerBySlug
		hubSupplyPricingMu.Unlock()
		return nil
	}

	var providers []HubProvider
	if err := DB.Select("id", "slug", "status").Find(&providers).Error; err != nil {
		return err
	}
	for _, provider := range providers {
		providerBySlug[provider.Slug] = HubProviderRoutingInfo{
			Id: provider.Id, Slug: provider.Slug, Status: provider.Status,
		}
	}

	type hubSupplyPricingRow struct {
		Id              int
		ProviderId      int
		ProviderStatus  string
		OwnerUserId     int
		NewAPIChannelId int
		PriceMultiplier float64
	}
	var rows []hubSupplyPricingRow
	if err := DB.Table("hub_supply_groups AS supply_groups").
		Select(
			"supply_groups.id, supply_groups.provider_id, providers.status AS provider_status, providers.owner_user_id, " +
				"supply_groups.new_api_channel_id, supply_groups.price_multiplier",
		).
		Joins("JOIN hub_providers AS providers ON providers.id = supply_groups.provider_id").
		Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		pricingByChannel[row.NewAPIChannelId] = HubSupplyPricing{
			SupplyGroupId:        row.Id,
			SupplyProviderId:     row.ProviderId,
			SupplyProviderStatus: row.ProviderStatus,
			SupplyOwnerUserId:    row.OwnerUserId,
			PriceMultiplier:      row.PriceMultiplier,
		}
	}

	hubSupplyPricingMu.Lock()
	hubSupplyPricingByChannel = pricingByChannel
	hubProviderRoutingBySlug = providerBySlug
	hubSupplyPricingMu.Unlock()
	return nil
}

func GetHubSupplyPricingByChannelID(channelID int) (HubSupplyPricing, bool) {
	if channelID <= 0 {
		return HubSupplyPricing{}, false
	}
	hubSupplyPricingMu.RLock()
	pricing, ok := hubSupplyPricingByChannel[channelID]
	hubSupplyPricingMu.RUnlock()
	return pricing, ok
}

func IsHubSupplyChannelProviderActive(channelID int) bool {
	pricing, isSupplyChannel := GetHubSupplyPricingByChannelID(channelID)
	return !isSupplyChannel || pricing.SupplyProviderStatus == HubProviderStatusActive
}

func GetHubProviderRoutingBySlug(slug string) (HubProviderRoutingInfo, bool) {
	hubSupplyPricingMu.RLock()
	provider, ok := hubProviderRoutingBySlug[slug]
	hubSupplyPricingMu.RUnlock()
	return provider, ok
}

func ChannelMatchesProviderFilter(channelID int, filter ChannelProviderFilter) bool {
	if filter.Mode == ChannelProviderAny || filter.ProviderID <= 0 {
		return true
	}
	pricing, isSupplyChannel := GetHubSupplyPricingByChannelID(channelID)
	switch filter.Mode {
	case ChannelProviderOnly:
		return isSupplyChannel && pricing.SupplyProviderId == filter.ProviderID
	case ChannelProviderExclude:
		return !isSupplyChannel || pricing.SupplyProviderId != filter.ProviderID
	default:
		return true
	}
}
