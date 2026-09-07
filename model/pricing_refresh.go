package model

import "sync"

var modelMetadataRoutingRefreshMu sync.Mutex

// RefreshPricing 强制立即重新计算与定价相关的缓存。
// 该方法用于需要最新数据的内部管理 API，
// 因此会绕过默认的 1 分钟延迟刷新。
func RefreshPricing() {
	updatePricingLock.Lock()
	defer updatePricingLock.Unlock()

	modelSupportEndpointsLock.Lock()
	defer modelSupportEndpointsLock.Unlock()

	updatePricing()
}

// RefreshModelMetadataRouting refreshes the pricing view and immediately
// reconciles provider-owned probe targets after a model metadata mutation.
// Target reconciliation uses the current database transaction snapshot, while
// InitChannelCache publishes the resulting target-kind and channel caches.
// The cache refresh is intentionally performed even when reconciliation
// returns an error so a failed group does not leave unrelated cache entries
// stale.
func RefreshModelMetadataRouting() error {
	modelMetadataRoutingRefreshMu.Lock()
	defer modelMetadataRoutingRefreshMu.Unlock()

	RefreshPricing()
	ensureErr := EnsureHubSupplyGroupProbeTargets()
	InitChannelCache()
	return ensureErr
}
