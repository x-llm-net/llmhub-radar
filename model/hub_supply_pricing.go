package model

import "sync"

type HubSupplyPricing struct {
	SupplyGroupId        int
	SupplyProviderId     int
	SupplyProviderStatus string
	SupplyOwnerUserId    int
	PriceMultiplier      float64
}

// HubSupplyPricingSnapshot is captured when a channel is selected and kept
// in the request context until billing and logging finish.
type HubSupplyPricingSnapshot struct {
	ChannelID  int
	Pricing    HubSupplyPricing
	Found      bool
	Configured bool
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
	hubSupplyConfiguredIDs    = map[int]struct{}{}
	hubProviderRoutingBySlug  = map[string]HubProviderRoutingInfo{}
	hubProviderRoutingByID    = map[int]HubProviderRoutingInfo{}
)

type hubSupplyPricingCacheData struct {
	pricingByChannel map[int]HubSupplyPricing
	configuredIDs    map[int]struct{}
	providerBySlug   map[string]HubProviderRoutingInfo
	providerByID     map[int]HubProviderRoutingInfo
}

func loadHubSupplyPricingCache() (*hubSupplyPricingCacheData, error) {
	pricingByChannel := make(map[int]HubSupplyPricing)
	configuredIDs := make(map[int]struct{})
	providerBySlug := make(map[string]HubProviderRoutingInfo)
	providerByID := make(map[int]HubProviderRoutingInfo)
	if DB == nil || !DB.Migrator().HasTable(&HubSupplyGroup{}) || !DB.Migrator().HasTable(&HubProvider{}) {
		return &hubSupplyPricingCacheData{
			pricingByChannel: pricingByChannel,
			configuredIDs:    configuredIDs,
			providerBySlug:   providerBySlug,
			providerByID:     providerByID,
		}, nil
	}

	var providers []HubProvider
	if err := DB.Select("id", "slug", "status").Find(&providers).Error; err != nil {
		return nil, err
	}
	for _, provider := range providers {
		info := HubProviderRoutingInfo{
			Id: provider.Id, Slug: provider.Slug, Status: provider.Status,
		}
		providerBySlug[provider.Slug] = info
		providerByID[provider.Id] = info
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
		configuredIDs[row.NewAPIChannelId] = struct{}{}
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
		configuredIDs:    configuredIDs,
		providerBySlug:   providerBySlug,
		providerByID:     providerByID,
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
	hubSupplyConfiguredIDs = data.configuredIDs
	hubProviderRoutingBySlug = data.providerBySlug
	hubProviderRoutingByID = data.providerByID
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

// CaptureHubSupplyPricingSnapshot reads the pricing and ownership state from
// the same published cache generation. Configured distinguishes a platform
// channel from a supply channel whose pricing entry is missing.
func CaptureHubSupplyPricingSnapshot(channelID int) HubSupplyPricingSnapshot {
	snapshot := HubSupplyPricingSnapshot{ChannelID: channelID}
	if channelID <= 0 {
		return snapshot
	}
	hubSupplyPricingMu.RLock()
	snapshot.Pricing, snapshot.Found = hubSupplyPricingByChannel[channelID]
	_, snapshot.Configured = hubSupplyConfiguredIDs[channelID]
	hubSupplyPricingMu.RUnlock()
	return snapshot
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

func GetHubProviderRoutingByID(providerID int) (HubProviderRoutingInfo, bool) {
	hubSupplyPricingMu.RLock()
	provider, ok := hubProviderRoutingByID[providerID]
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
