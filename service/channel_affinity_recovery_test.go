package service

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
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

func TestHubAffinityFallbackRetainsPreferredAfterMainTTLExpires(t *testing.T) {
	suffix := fmt.Sprintf("recovery-retain-preferred-%d", time.Now().UnixNano())
	mainCache := getChannelAffinityCache()
	fallbackCache := getChannelAffinityFallbackCache()
	require.NoError(t, mainCache.SetWithTTL(suffix, 21, 20*time.Millisecond))
	t.Cleanup(func() {
		_, _ = mainCache.DeleteMany([]string{suffix})
		_, _ = fallbackCache.DeleteMany([]string{suffix})
	})

	ctx := newHubAffinityRecoveryContext(suffix, channelAffinityRoleFallback)
	setChannelAffinityRouteMeta(ctx, channelAffinityRoleFallback, 21, 22)
	common.SetContextKey(ctx, constant.ContextKeyHubRoutingFallback, true)
	RecordChannelAffinity(ctx, 22)

	time.Sleep(50 * time.Millisecond)
	preferred, found, err := mainCache.Get(suffix)
	require.NoError(t, err)
	require.False(t, found)
	require.Zero(t, preferred)
	fallback, found, err := fallbackCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 21, fallback.PreferredID)
}

func TestHubAffinityFallbackSuccessDoesNotDelayRecovery(t *testing.T) {
	suffix := fmt.Sprintf("recovery-deadline-stable-%d", time.Now().UnixNano())
	mainCache := getChannelAffinityCache()
	fallbackCache := getChannelAffinityFallbackCache()
	recoveryAt := time.Now().Unix() + 120
	require.NoError(t, mainCache.SetWithTTL(suffix, 31, time.Minute))
	require.NoError(t, fallbackCache.SetWithTTL(suffix, channelAffinityFallbackState{
		ChannelID:        32,
		PreferredID:      31,
		NextRecoveryAt:   recoveryAt,
		RecoveryFailures: 2,
	}, time.Minute))
	t.Cleanup(func() {
		_, _ = mainCache.DeleteMany([]string{suffix})
		_, _ = fallbackCache.DeleteMany([]string{suffix})
	})

	ctx := newHubAffinityRecoveryContext(suffix, channelAffinityRoleFallback)
	setChannelAffinityRouteMeta(ctx, channelAffinityRoleFallback, 31, 32)
	common.SetContextKey(ctx, constant.ContextKeyHubRoutingFallback, true)
	RecordChannelAffinity(ctx, 33)

	fallback, found, err := fallbackCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 33, fallback.ChannelID)
	require.Equal(t, 31, fallback.PreferredID)
	require.Equal(t, recoveryAt, fallback.NextRecoveryAt)
	require.Equal(t, 2, fallback.RecoveryFailures)
}

func TestHubAffinityFallbackDoesNotRestoreDeletedPreferred(t *testing.T) {
	suffix := fmt.Sprintf("recovery-deleted-preferred-%d", time.Now().UnixNano())
	mainCache := getChannelAffinityCache()
	fallbackCache := getChannelAffinityFallbackCache()
	require.NoError(t, mainCache.SetWithTTL(suffix, 41, time.Minute))
	t.Cleanup(func() {
		_, _ = mainCache.DeleteMany([]string{suffix})
		_, _ = fallbackCache.DeleteMany([]string{suffix})
	})

	ctx := newHubAffinityRecoveryContext(suffix, channelAffinityRoleFallback)
	setChannelAffinityRouteMeta(ctx, channelAffinityRoleFallback, 41, 42)
	common.SetContextKey(ctx, constant.ContextKeyHubRoutingFallback, true)
	_, err := mainCache.DeleteMany([]string{suffix})
	require.NoError(t, err)
	RecordChannelAffinity(ctx, 42)

	_, found, err := mainCache.Get(suffix)
	require.NoError(t, err)
	require.False(t, found)
	fallback, found, err := fallbackCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Zero(t, fallback.PreferredID)
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

func TestHubAffinityRecoveryFailureRetainsFallbackPreferredAfterMainExpiry(t *testing.T) {
	suffix := fmt.Sprintf("recovery-failure-expired-main-%d", time.Now().UnixNano())
	mainCache := getChannelAffinityCache()
	fallbackCache := getChannelAffinityFallbackCache()
	require.NoError(t, fallbackCache.SetWithTTL(suffix, channelAffinityFallbackState{
		ChannelID:        82,
		PreferredID:      81,
		RecoveryFailures: 1,
	}, time.Minute))
	t.Cleanup(func() {
		_, _ = mainCache.DeleteMany([]string{suffix})
		_, _ = fallbackCache.DeleteMany([]string{suffix})
	})

	ctx := newHubAffinityRecoveryContext(suffix, channelAffinityRoleRecovery)
	setChannelAffinityRouteMeta(ctx, channelAffinityRoleRecovery, 81, 82)
	require.True(t, ClearCurrentChannelAffinityCacheForRetry(ctx))

	_, found, err := mainCache.Get(suffix)
	require.NoError(t, err)
	require.False(t, found)
	fallback, found, err := fallbackCache.Get(suffix)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 82, fallback.ChannelID)
	require.Equal(t, 81, fallback.PreferredID)
	require.Equal(t, 2, fallback.RecoveryFailures)
	require.Greater(t, fallback.NextRecoveryAt, time.Now().Unix())
}

func TestHubAffinityExpiredMainCanRecoverAgainAfterFailure(t *testing.T) {
	setting := operation_setting.GetChannelAffinitySetting()
	require.NotNil(t, setting)
	var rule operation_setting.ChannelAffinityRule
	for _, candidate := range setting.Rules {
		if candidate.Name == "codex cli trace" {
			rule = candidate
			break
		}
	}
	require.NotEmpty(t, rule.Name)

	modelName := "gpt-affinity-recovery-chain"
	usingGroup := "default"
	affinityValue := fmt.Sprintf("recovery-chain-%d", time.Now().UnixNano())
	suffix := buildChannelAffinityCacheKeySuffix(
		rule,
		modelName,
		usingGroup,
		affinityValue,
		"hub",
		model.HubTokenRoutingModePublic,
	)
	mainCache := getChannelAffinityCache()
	fallbackCache := getChannelAffinityFallbackCache()
	require.NoError(t, fallbackCache.SetWithTTL(suffix, channelAffinityFallbackState{
		ChannelID:        92,
		PreferredID:      91,
		NextRecoveryAt:   time.Now().Unix() - 1,
		RecoveryFailures: 1,
	}, time.Minute))
	t.Cleanup(func() {
		_, _ = mainCache.DeleteMany([]string{suffix})
		_, _ = fallbackCache.DeleteMany([]string{suffix})
	})

	newContext := func() *gin.Context {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Request = httptest.NewRequest(
			"POST",
			"/v1/responses",
			strings.NewReader(fmt.Sprintf(`{"prompt_cache_key":%q}`, affinityValue)),
		)
		common.SetContextKey(ctx, constant.ContextKeyUsingGroup, usingGroup)
		common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, &model.HubTokenRoutingPolicy{
			Mode: model.HubTokenRoutingModePublic,
		})
		return ctx
	}

	firstRecovery := newContext()
	channelID, found := GetPreferredChannelByAffinity(firstRecovery, modelName, usingGroup)
	require.True(t, found)
	require.Equal(t, 91, channelID)
	require.True(t, ClearCurrentChannelAffinityCacheForRetry(firstRecovery))

	state, found := getChannelAffinityFallbackState(suffix)
	require.True(t, found)
	require.Equal(t, 91, state.PreferredID)
	require.Equal(t, 2, state.RecoveryFailures)
	state.NextRecoveryAt = time.Now().Unix() - 1
	require.NoError(t, fallbackCache.SetWithTTL(suffix, state, time.Minute))

	secondRecovery := newContext()
	channelID, found = GetPreferredChannelByAffinity(secondRecovery, modelName, usingGroup)
	require.True(t, found)
	require.Equal(t, 91, channelID)
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
