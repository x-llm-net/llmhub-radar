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

type hubSupplyPricingCacheData struct {
	pricingByChannel map[int]HubSupplyPricing
	providerBySlug   map[string]HubProviderRoutingInfo
}

func loadHubSupplyPricingCache() (*hubSupplyPricingCacheData, error) {
	pricingByChannel := make(map[int]HubSupplyPricing)
	providerBySlug := make(map[string]HubProviderRoutingInfo)
	if DB == nil || !DB.Migrator().HasTable(&HubSupplyGroup{}) || !DB.Migrator().HasTable(&HubProvider{}) {
		return &hubSupplyPricingCacheData{
			pricingByChannel: pricingByChannel,
			providerBySlug:   providerBySlug,
		}, nil
	}

	var providers []HubProvider
	if err := DB.Select("id", "slug", "status").Find(&providers).Error; err != nil {
		return nil, err
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
		return nil, err
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

	return &hubSupplyPricingCacheData{
		pricingByChannel: pricingByChannel,
		providerBySlug:   providerBySlug,
	}, nil
}

func publishHubSupplyPricingCache(data *hubSupplyPricingCacheData) {
	if data == nil {
		return
	}
	// Keep the publication order aligned with memory-channel selection:
	// channelSyncLock -> hubSupplyPricingMu. A refresh therefore exposes either
	// the old pricing snapshot or the new one, never a partially rebuilt map.
	channelSyncLock.Lock()
	hubSupplyPricingMu.Lock()
	hubSupplyPricingByChannel = data.pricingByChannel
	hubProviderRoutingBySlug = data.providerBySlug
	hubSupplyPricingMu.Unlock()
	channelSyncLock.Unlock()
}

func RefreshHubSupplyPricingCache() error {
	channelCacheRefreshMu.Lock()
	defer channelCacheRefreshMu.Unlock()
	data, err := loadHubSupplyPricingCache()
	if err != nil {
		return err
	}
	publishHubSupplyPricingCache(data)
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

// IsHubSupplyChannelConfigured confirms ownership from the database when the
// in-memory pricing cache has no entry. It is intentionally used only on the
// cache-miss path so normal requests keep the cache-only hot path.
func IsHubSupplyChannelConfigured(channelID int) (bool, error) {
	if channelID <= 0 {
		return false, nil
	}
	if DB == nil {
		return false, nil
	}
	var count int64
	if err := DB.Model(&HubSupplyGroup{}).
		Where("new_api_channel_id = ?", channelID).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
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
