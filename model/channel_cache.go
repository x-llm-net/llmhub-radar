package model

import (
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

var group2model2channels map[string]map[string][]int // enabled channel
var channelsIDM map[int]*Channel                     // all channels include disabled
var group2model2hubTierCandidates map[string]map[string]*hubTierCandidateBuckets

// channel2advancedCustomConfig caches parsed Advanced Custom (type 58) configs so
// path-aware selection avoids re-parsing JSON per request. Refreshed on full sync.
var channel2advancedCustomConfig map[int]*dto.AdvancedCustomConfig
var channel2HubSupplyProbeKinds hubSupplyChannelProbeKinds
var channelSyncLock sync.RWMutex
var channelCacheRefreshMu sync.Mutex

func InitChannelCache() {
	channelCacheRefreshMu.Lock()
	defer channelCacheRefreshMu.Unlock()

	pricingData, err := loadHubSupplyPricingCache()
	if err != nil {
		common.SysError("failed to refresh hub supply pricing cache: " + err.Error())
		return
	}
	newChannel2HubSupplyProbeKinds, probeSignals, err := loadHubSupplyChannelProbeKinds(DB, nil)
	if err != nil {
		common.SysError("failed to refresh hub supply route availability: " + err.Error())
		return
	}
	if !common.MemoryCacheEnabled {
		publishHubSupplyPricingCache(pricingData)
		PublishHubRoutingProbeSignals(probeSignals)
		InvalidatePricingCache()
		return
	}
	newChannelId2channel := make(map[int]*Channel)
	newChannel2advancedCustomConfig := make(map[int]*dto.AdvancedCustomConfig)
	var channels []*Channel
	if err := DB.Find(&channels).Error; err != nil {
		common.SysError("failed to refresh channel cache: " + err.Error())
		return
	}
	for _, channel := range channels {
		newChannelId2channel[channel.Id] = channel
		if channel.Type == constant.ChannelTypeAdvancedCustom {
			if config := channel.GetOtherSettings().AdvancedCustom; config != nil {
				newChannel2advancedCustomConfig[channel.Id] = config
			}
		}
	}
	var abilities []*Ability
	if err := DB.Where("enabled = ?", true).Find(&abilities).Error; err != nil {
		common.SysError("failed to refresh ability cache: " + err.Error())
		return
	}
	newGroup2model2channels := make(map[string]map[string][]int)
	for _, ability := range abilities {
		channel, ok := newChannelId2channel[ability.ChannelId]
		if !ok || channel.Status != common.ChannelStatusEnabled {
			continue // skip disabled channels
		}
		if pricing, isSupplyChannel := pricingData.pricingByChannel[channel.Id]; isSupplyChannel && !pricing.TenantPublished {
			continue // skip channels unpublished by their owning tenant
		}
		if _, ok := newGroup2model2channels[ability.Group]; !ok {
			newGroup2model2channels[ability.Group] = make(map[string][]int)
		}
		newGroup2model2channels[ability.Group][ability.Model] = append(
			newGroup2model2channels[ability.Group][ability.Model], ability.ChannelId,
		)
	}

	// sort by priority
	for group, model2channels := range newGroup2model2channels {
		for model, channels := range model2channels {
			sort.Slice(channels, func(i, j int) bool {
				return newChannelId2channel[channels[i]].GetPriority() > newChannelId2channel[channels[j]].GetPriority()
			})
			newGroup2model2channels[group][model] = channels
		}
	}
	newGroup2model2hubTierCandidates := buildHubTierCandidateBuckets(
		newGroup2model2channels,
		newChannelId2channel,
		pricingData.pricingByChannel,
	)

	channelSyncLock.Lock()
	hubSupplyPricingMu.Lock()
	group2model2channels = newGroup2model2channels
	group2model2hubTierCandidates = newGroup2model2hubTierCandidates
	//channelsIDM = newChannelId2channel
	for i, channel := range newChannelId2channel {
		if channel.ChannelInfo.IsMultiKey {
			channel.Keys = channel.GetKeys()
			if channel.ChannelInfo.MultiKeyMode == constant.MultiKeyModePolling {
				if oldChannel, ok := channelsIDM[i]; ok {
					// 存在旧的渠道，如果是多key且轮询，保留轮询索引信息
					if oldChannel.ChannelInfo.IsMultiKey && oldChannel.ChannelInfo.MultiKeyMode == constant.MultiKeyModePolling {
						channel.ChannelInfo.MultiKeyPollingIndex = oldChannel.ChannelInfo.MultiKeyPollingIndex
					}
				}
			}
		}
	}
	channelsIDM = newChannelId2channel
	channel2advancedCustomConfig = newChannel2advancedCustomConfig
	channel2HubSupplyProbeKinds = newChannel2HubSupplyProbeKinds
	publishHubSupplyPricingCacheLocked(pricingData)
	PublishHubRoutingProbeSignals(probeSignals)
	hubSupplyPricingMu.Unlock()
	channelSyncLock.Unlock()
	// Lock ordering: InvalidatePricingCache acquires updatePricingLock, and
	// GetPricing (holding updatePricingLock) nests channelSyncLock.RLock via
	// loadPricingAdvancedCustomConfigs. channelSyncLock MUST be released before
	// invalidating the pricing cache, otherwise the reversed order deadlocks.
	InvalidatePricingCache()
	common.SysLog("channels synced from database")
}

func buildHubTierCandidateBuckets(
	group2model2channels map[string]map[string][]int,
	channelsByID map[int]*Channel,
	pricingByChannel map[int]HubSupplyPricing,
) map[string]map[string]*hubTierCandidateBuckets {
	bucketsByGroup := make(map[string]map[string]*hubTierCandidateBuckets)
	for group, models := range group2model2channels {
		if !hub_routing_setting.IsServiceTier(group) {
			continue
		}
		bucketsByModel := make(map[string]*hubTierCandidateBuckets)
		for modelName, channelIDs := range models {
			bucket := &hubTierCandidateBuckets{candidatesBySource: make(map[int][]hubTierChannelCandidate)}
			for _, channelID := range channelIDs {
				channel, ok := channelsByID[channelID]
				if !ok {
					continue
				}
				providerID := 0
				if pricing, isSupplyChannel := pricingByChannel[channelID]; isSupplyChannel {
					providerID = pricing.SupplyProviderId
				}
				if _, exists := bucket.candidatesBySource[providerID]; !exists {
					bucket.providerIDs = append(bucket.providerIDs, providerID)
				}
				bucket.candidatesBySource[providerID] = append(bucket.candidatesBySource[providerID], hubTierChannelCandidate{
					ChannelID: channelID,
					Priority:  channel.GetPriority(),
					Weight:    channel.GetWeight(),
					Provider:  providerID,
				})
			}
			sort.Ints(bucket.providerIDs)
			bucketsByModel[modelName] = bucket
		}
		bucketsByGroup[group] = bucketsByModel
	}
	return bucketsByGroup
}

func SyncChannelCache(frequency int) {
	for {
		time.Sleep(time.Duration(frequency) * time.Second)
		common.SysLog("syncing channels from database")
		InitChannelCache()
	}
}

func GetRandomSatisfiedChannel(group string, model string, retry int, requestPath string, excludedChannelIDs map[int]struct{}) (*Channel, error) {
	channel, _, err := GetRandomSatisfiedChannelWithFilter(group, model, retry, requestPath, excludedChannelIDs, ChannelProviderFilter{})
	return channel, err
}

// GetRandomSatisfiedChannelWithFilter returns the selected channel and its
// supply pricing from the same published cache generation.
func GetRandomSatisfiedChannelWithFilter(group string, model string, retry int, requestPath string, excludedChannelIDs map[int]struct{}, providerFilter ChannelProviderFilter) (*Channel, HubSupplyPricingSnapshot, error) {
	// if memory cache is disabled, get channel directly from database
	if !common.MemoryCacheEnabled {
		channel, err := GetChannelWithFilter(group, model, retry, requestPath, excludedChannelIDs, providerFilter)
		if channel == nil {
			return nil, HubSupplyPricingSnapshot{}, err
		}
		return channel, CaptureHubSupplyPricingSnapshot(channel.Id), err
	}

	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	// First, try to find channels with the exact model name.
	selectedModel := model
	channels := filterChannelsByRequestPathAndModel(group2model2channels[group][model], requestPath, model)

	// If no channels found, try to find channels with the normalized model name.
	if len(channels) == 0 {
		normalizedModel := ratio_setting.FormatMatchingModelName(model)
		channels = filterChannelsByRequestPathAndModel(group2model2channels[group][normalizedModel], requestPath, model)
		selectedModel = normalizedModel
	}
	if hub_routing_setting.IsServiceTier(group) {
		buckets := group2model2hubTierCandidates[group][selectedModel]
		channelID := selectHubTierChannelFromBuckets(buckets, excludedChannelIDs, providerFilter, func(candidate hubTierChannelCandidate) bool {
			channel, ok := channelsIDM[candidate.ChannelID]
			if !ok || channel.Status != common.ChannelStatusEnabled {
				return false
			}
			if !hubSupplyChannelSupportsRequest(channel2HubSupplyProbeKinds, candidate.ChannelID, model, requestPath) {
				return false
			}
			if channel.Type == constant.ChannelTypeAdvancedCustom && requestPath != "" {
				config := channel2advancedCustomConfig[candidate.ChannelID]
				if config == nil || !config.SupportsPathForModel(requestPath, model) {
					return false
				}
			}
			providerID, eligible := hubTierProviderForChannel(candidate.ChannelID, providerFilter)
			return eligible && providerID == candidate.Provider
		}, func(candidate hubTierChannelCandidate) hubTierChannelCandidate {
			return decorateHubTierCandidateWithRuntimeHealth(candidate, model, requestPath)
		})
		if channelID == 0 {
			return nil, HubSupplyPricingSnapshot{}, nil
		}
		channel := channelsIDM[channelID]
		return channel, CaptureHubSupplyPricingSnapshot(channel.Id), nil
	}
	channels = filterChannelIDsByProvider(channels, providerFilter)

	if len(channels) == 0 {
		return nil, HubSupplyPricingSnapshot{}, nil
	}
	channels = preferUntriedChannelIDs(channels, excludedChannelIDs, providerFilter.StrictExcludedChannels)
	if len(channels) == 0 {
		return nil, HubSupplyPricingSnapshot{}, nil
	}

	if len(channels) == 1 {
		if channel, ok := channelsIDM[channels[0]]; ok {
			return channel, CaptureHubSupplyPricingSnapshot(channel.Id), nil
		}
		return nil, HubSupplyPricingSnapshot{}, fmt.Errorf("数据库一致性错误，渠道# %d 不存在，请联系管理员修复", channels[0])
	}

	uniquePriorities := make(map[int]bool)
	for _, channelId := range channels {
		if channel, ok := channelsIDM[channelId]; ok {
			uniquePriorities[int(channel.GetPriority())] = true
		} else {
			return nil, HubSupplyPricingSnapshot{}, fmt.Errorf("数据库一致性错误，渠道# %d 不存在，请联系管理员修复", channelId)
		}
	}
	var sortedUniquePriorities []int
	for priority := range uniquePriorities {
		sortedUniquePriorities = append(sortedUniquePriorities, priority)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(sortedUniquePriorities)))

	if retry >= len(uniquePriorities) {
		retry = len(uniquePriorities) - 1
	}
	targetPriority := int64(sortedUniquePriorities[retry])

	// get the priority for the given retry number
	var sumWeight = 0
	var targetChannels []*Channel
	for _, channelId := range channels {
		if channel, ok := channelsIDM[channelId]; ok {
			if channel.GetPriority() == targetPriority {
				sumWeight += channel.GetWeight()
				targetChannels = append(targetChannels, channel)
			}
		} else {
			return nil, HubSupplyPricingSnapshot{}, fmt.Errorf("数据库一致性错误，渠道# %d 不存在，请联系管理员修复", channelId)
		}
	}

	if len(targetChannels) == 0 {
		return nil, HubSupplyPricingSnapshot{}, errors.New(fmt.Sprintf("no channel found, group: %s, model: %s, priority: %d", group, model, targetPriority))
	}

	// smoothing factor and adjustment
	smoothingFactor := 1
	smoothingAdjustment := 0

	if sumWeight == 0 {
		// when all channels have weight 0, set sumWeight to the number of channels and set smoothing adjustment to 100
		// each channel's effective weight = 100
		sumWeight = len(targetChannels) * 100
		smoothingAdjustment = 100
	} else if sumWeight/len(targetChannels) < 10 {
		// when the average weight is less than 10, set smoothing factor to 100
		smoothingFactor = 100
	}

	// Calculate the total weight of all channels up to endIdx
	totalWeight := sumWeight * smoothingFactor

	// Generate a random value in the range [0, totalWeight)
	randomWeight := rand.Intn(totalWeight)

	// Find a channel based on its weight
	for _, channel := range targetChannels {
		randomWeight -= channel.GetWeight()*smoothingFactor + smoothingAdjustment
		if randomWeight < 0 {
			return channel, CaptureHubSupplyPricingSnapshot(channel.Id), nil
		}
	}
	// return null if no channel is not found
	return nil, HubSupplyPricingSnapshot{}, errors.New("channel not found")
}

func preferUntriedChannelIDs(channelIDs []int, excludedChannelIDs map[int]struct{}, strict bool) []int {
	if len(channelIDs) == 0 || len(excludedChannelIDs) == 0 {
		return channelIDs
	}
	filtered := make([]int, 0, len(channelIDs))
	for _, channelID := range channelIDs {
		if _, excluded := excludedChannelIDs[channelID]; !excluded {
			filtered = append(filtered, channelID)
		}
	}
	if len(filtered) == 0 {
		if strict {
			return nil
		}
		return channelIDs
	}
	return filtered
}

func filterChannelIDsByProvider(channelIDs []int, providerFilter ChannelProviderFilter) []int {
	if len(channelIDs) == 0 || providerFilter.Mode == ChannelProviderAny || providerFilter.ProviderID <= 0 {
		return channelIDs
	}
	filtered := make([]int, 0, len(channelIDs))
	for _, channelID := range channelIDs {
		if ChannelMatchesProviderFilter(channelID, providerFilter) {
			filtered = append(filtered, channelID)
		}
	}
	return filtered
}

// filterChannelsByRequestPathAndModel restricts candidates by the current Hub
// probe kind and, for Advanced Custom channels, the configured request path.
// Caller must hold channelSyncLock (read lock). The cached slice is never mutated.
func filterChannelsByRequestPathAndModel(channels []int, requestPath string, model string) []int {
	if len(channels) == 0 {
		return channels
	}
	filtered := make([]int, 0, len(channels))
	for _, channelId := range channels {
		if !hubSupplyChannelSupportsRequest(channel2HubSupplyProbeKinds, channelId, model, requestPath) {
			continue
		}
		channel, ok := channelsIDM[channelId]
		if !ok {
			// keep it so the downstream consistency error is raised as before
			filtered = append(filtered, channelId)
			continue
		}
		if channel.Type != constant.ChannelTypeAdvancedCustom {
			filtered = append(filtered, channelId)
			continue
		}
		if requestPath != "" {
			if config := channel2advancedCustomConfig[channelId]; config != nil && config.SupportsPathForModel(requestPath, model) {
				filtered = append(filtered, channelId)
			}
		} else {
			filtered = append(filtered, channelId)
		}
	}
	return filtered
}

func CacheGetChannel(id int) (*Channel, error) {
	if !common.MemoryCacheEnabled {
		return GetChannelById(id, true)
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	c, ok := channelsIDM[id]
	if !ok {
		return nil, fmt.Errorf("渠道# %d，已不存在", id)
	}
	return c, nil
}

// CacheGetChannelWithPricing returns a channel and its pricing state from the
// same cache generation. It is used by affinity selection.
func CacheGetChannelWithPricing(id int) (*Channel, HubSupplyPricingSnapshot, error) {
	if !common.MemoryCacheEnabled {
		channel, err := GetChannelById(id, true)
		if channel == nil {
			return nil, HubSupplyPricingSnapshot{}, err
		}
		return channel, CaptureHubSupplyPricingSnapshot(channel.Id), err
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()
	channel, ok := channelsIDM[id]
	if !ok {
		return nil, HubSupplyPricingSnapshot{}, fmt.Errorf("渠道# %d，已不存在", id)
	}
	return channel, CaptureHubSupplyPricingSnapshot(channel.Id), nil
}

func CacheGetChannelInfo(id int) (*ChannelInfo, error) {
	if !common.MemoryCacheEnabled {
		channel, err := GetChannelById(id, true)
		if err != nil {
			return nil, err
		}
		return &channel.ChannelInfo, nil
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	c, ok := channelsIDM[id]
	if !ok {
		return nil, fmt.Errorf("渠道# %d，已不存在", id)
	}
	return &c.ChannelInfo, nil
}

func CacheUpdateChannelStatus(id int, status int) {
	if !common.MemoryCacheEnabled {
		return
	}
	channelSyncLock.Lock()
	defer channelSyncLock.Unlock()
	if channel, ok := channelsIDM[id]; ok {
		channel.Status = status
	}
	if status != common.ChannelStatusEnabled {
		// delete the channel from group2model2channels
		for group, model2channels := range group2model2channels {
			for model, channels := range model2channels {
				for i, channelId := range channels {
					if channelId == id {
						// remove the channel from the slice
						group2model2channels[group][model] = append(channels[:i], channels[i+1:]...)
						break
					}
				}
			}
		}
	}
}

func CacheUpdateChannel(channel *Channel) {
	if !common.MemoryCacheEnabled {
		return
	}
	channelSyncLock.Lock()
	if channel == nil {
		channelSyncLock.Unlock()
		return
	}

	if channelsIDM == nil {
		channelsIDM = make(map[int]*Channel)
	}
	if oldChannel, ok := channelsIDM[channel.Id]; ok {
		logger.LogDebug(nil, "CacheUpdateChannel before: id=%d, name=%s, status=%d, polling_index=%d", channel.Id, channel.Name, channel.Status, oldChannel.ChannelInfo.MultiKeyPollingIndex)
	}
	channelsIDM[channel.Id] = channel
	if channel2advancedCustomConfig == nil {
		channel2advancedCustomConfig = make(map[int]*dto.AdvancedCustomConfig)
	}
	delete(channel2advancedCustomConfig, channel.Id)
	if channel.Type == constant.ChannelTypeAdvancedCustom {
		if config := channel.GetOtherSettings().AdvancedCustom; config != nil {
			channel2advancedCustomConfig[channel.Id] = config
		}
	}
	logger.LogDebug(nil, "CacheUpdateChannel after: id=%d, name=%s, status=%d, polling_index=%d", channel.Id, channel.Name, channel.Status, channel.ChannelInfo.MultiKeyPollingIndex)
	// Lock ordering: do NOT hold channelSyncLock while calling
	// InvalidatePricingCache. GetPricing acquires updatePricingLock first and then
	// channelSyncLock.RLock (via loadPricingAdvancedCustomConfigs); acquiring
	// updatePricingLock while holding channelSyncLock would be an AB-BA deadlock.
	channelSyncLock.Unlock()
	InvalidatePricingCache()
}
