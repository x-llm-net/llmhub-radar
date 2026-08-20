package service

import (
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newHubAffinityRecoveryContext(suffix string, role string) *gin.Context {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, hub_routing_setting.ServiceTierMedium)
	setChannelAffinityContext(ctx, channelAffinityMeta{
		CacheKey:       channelAffinityCacheNamespace + ":" + suffix,
		CacheKeySuffix: suffix,
		TTLSeconds:     60,
		RuleName:       "affinity-recovery-test",
		UsingGroup:     hub_routing_setting.ServiceTierMedium,
		Role:           role,
	})
	return ctx
}

func TestHubAffinityFallbackDoesNotOverwritePreferred(t *testing.T) {
	suffix := fmt.Sprintf("recovery-preferred-%d", time.Now().UnixNano())
	mainCache := getChannelAffinityCache()
	fallbackCache := getChannelAffinityFallbackCache()
	require.NoError(t, mainCache.SetWithTTL(suffix, 11, time.Minute))
	t.Cleanup(func() {
		_, _ = mainCache.DeleteMany([]string{suffix})
		_, _ = fallbackCache.DeleteMany([]string{suffix})
	})

	ctx := newHubAffinityRecoveryContext(suffix, channelAffinityRolePreferred)
	common.SetContextKey(ctx, constant.ContextKeyHubRoutingFallback, true)
	RecordChannelAffinity(ctx, 22)

	preferred, found, err := mainCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 11, preferred)
	fallback, found, err := fallbackCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 22, fallback.ChannelID)
	require.Equal(t, 1, fallback.RecoveryFailures)
	require.Greater(t, fallback.NextRecoveryAt, time.Now().Unix())
}

func TestHubAffinityRecoveryFailureKeepsBothEntriesAndBacksOff(t *testing.T) {
	suffix := fmt.Sprintf("recovery-failure-%d", time.Now().UnixNano())
	mainCache := getChannelAffinityCache()
	fallbackCache := getChannelAffinityFallbackCache()
	require.NoError(t, mainCache.SetWithTTL(suffix, 31, time.Minute))
	require.NoError(t, fallbackCache.SetWithTTL(suffix, channelAffinityFallbackState{
		ChannelID: 32, RecoveryFailures: 1,
	}, time.Minute))
	t.Cleanup(func() {
		_, _ = mainCache.DeleteMany([]string{suffix})
		_, _ = fallbackCache.DeleteMany([]string{suffix})
	})

	ctx := newHubAffinityRecoveryContext(suffix, channelAffinityRoleRecovery)
	require.True(t, ClearCurrentChannelAffinityCacheForRetry(ctx))

	preferred, found, err := mainCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 31, preferred)
	fallback, found, err := fallbackCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 32, fallback.ChannelID)
	require.Equal(t, 2, fallback.RecoveryFailures)
	require.Greater(t, fallback.NextRecoveryAt, time.Now().Unix())
}

func TestHubAffinityRecoverySuccessClearsTemporaryFallback(t *testing.T) {
	suffix := fmt.Sprintf("recovery-success-%d", time.Now().UnixNano())
	mainCache := getChannelAffinityCache()
	fallbackCache := getChannelAffinityFallbackCache()
	require.NoError(t, mainCache.SetWithTTL(suffix, 41, time.Minute))
	require.NoError(t, fallbackCache.SetWithTTL(suffix, channelAffinityFallbackState{
		ChannelID: 42, RecoveryFailures: 2,
	}, time.Minute))
	t.Cleanup(func() {
		_, _ = mainCache.DeleteMany([]string{suffix})
		_, _ = fallbackCache.DeleteMany([]string{suffix})
	})

	ctx := newHubAffinityRecoveryContext(suffix, channelAffinityRoleRecovery)
	RecordChannelAffinity(ctx, 41)

	preferred, found, err := mainCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 41, preferred)
	_, found, err = fallbackCache.Get(suffix)
	require.NoError(t, err)
	require.False(t, found)
}

func TestHubAffinityFallbackFailureOnlyClearsTemporaryEntry(t *testing.T) {
	suffix := fmt.Sprintf("fallback-failure-%d", time.Now().UnixNano())
	mainCache := getChannelAffinityCache()
	fallbackCache := getChannelAffinityFallbackCache()
	require.NoError(t, mainCache.SetWithTTL(suffix, 51, time.Minute))
	require.NoError(t, fallbackCache.SetWithTTL(suffix, channelAffinityFallbackState{ChannelID: 52}, time.Minute))
	t.Cleanup(func() {
		_, _ = mainCache.DeleteMany([]string{suffix})
		_, _ = fallbackCache.DeleteMany([]string{suffix})
	})

	ctx := newHubAffinityRecoveryContext(suffix, channelAffinityRoleFallback)
	require.True(t, ClearCurrentChannelAffinityCacheForRetry(ctx))

	preferred, found, err := mainCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 51, preferred)
	_, found, err = fallbackCache.Get(suffix)
	require.NoError(t, err)
	require.False(t, found)
}

func TestHubAffinityHardInvalidFallbackKeepsPreferred(t *testing.T) {
	suffix := fmt.Sprintf("fallback-disabled-%d", time.Now().UnixNano())
	mainCache := getChannelAffinityCache()
	fallbackCache := getChannelAffinityFallbackCache()
	require.NoError(t, mainCache.SetWithTTL(suffix, 61, time.Minute))
	require.NoError(t, fallbackCache.SetWithTTL(suffix, channelAffinityFallbackState{ChannelID: 62}, time.Minute))
	t.Cleanup(func() {
		_, _ = mainCache.DeleteMany([]string{suffix})
		_, _ = fallbackCache.DeleteMany([]string{suffix})
	})

	ctx := newHubAffinityRecoveryContext(suffix, channelAffinityRoleFallback)
	require.True(t, ClearCurrentChannelAffinityCache(ctx))

	preferred, found, err := mainCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 61, preferred)
	_, found, err = fallbackCache.Get(suffix)
	require.NoError(t, err)
	require.False(t, found)
}
