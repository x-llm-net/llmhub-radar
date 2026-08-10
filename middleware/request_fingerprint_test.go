package middleware

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	appI18n "github.com/QuantumNous/new-api/i18n"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func fingerprintTestContext(t *testing.T, body string) *gin.Context {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	t.Cleanup(func() { common.CleanupBodyStorage(ctx) })
	return ctx
}

func resetInMemoryRequestFingerprints(t *testing.T) {
	t.Helper()
	activeRequestFingerprints.Lock()
	previous := activeRequestFingerprints.leases
	activeRequestFingerprints.leases = make(map[string]map[string]time.Time)
	activeRequestFingerprints.Unlock()
	t.Cleanup(func() {
		activeRequestFingerprints.Lock()
		activeRequestFingerprints.leases = previous
		activeRequestFingerprints.Unlock()
	})
}

func TestBuildRequestFingerprintCanonicalizesJSONAndRestoresBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	firstBody := `{"model":"gpt-test","messages":[{"role":"user","content":"hello"}],"stream_options":{"include_usage":true}}`
	secondBody := `{"messages":[{"content":"hello","role":"user"}],"stream_options":{"include_usage":false},"model":"gpt-test"}`

	first := fingerprintTestContext(t, firstBody)
	second := fingerprintTestContext(t, secondBody)
	firstFingerprint, firstOK, firstErr := buildRequestFingerprint(first)
	secondFingerprint, secondOK, secondErr := buildRequestFingerprint(second)

	require.NoError(t, firstErr)
	require.NoError(t, secondErr)
	assert.True(t, firstOK)
	assert.True(t, secondOK)
	assert.Equal(t, firstFingerprint, secondFingerprint)

	restored, err := io.ReadAll(first.Request.Body)
	require.NoError(t, err)
	assert.JSONEq(t, firstBody, string(restored))
}

func TestBuildRequestFingerprintChangesWithSemanticInput(t *testing.T) {
	gin.SetMode(gin.TestMode)
	first := fingerprintTestContext(t, `{"model":"gpt-test","messages":[{"role":"user","content":"one"}]}`)
	second := fingerprintTestContext(t, `{"model":"gpt-test","messages":[{"role":"user","content":"two"}]}`)

	firstFingerprint, _, firstErr := buildRequestFingerprint(first)
	secondFingerprint, _, secondErr := buildRequestFingerprint(second)

	require.NoError(t, firstErr)
	require.NoError(t, secondErr)
	assert.NotEqual(t, firstFingerprint, secondFingerprint)
}

func TestBuildRequestFingerprintHashesNonJSONBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	first := fingerprintTestContext(t, "model=gpt-test&prompt=hello")
	second := fingerprintTestContext(t, "model=gpt-test&prompt=hello")
	first.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	second.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	firstFingerprint, firstOK, firstErr := buildRequestFingerprint(first)
	secondFingerprint, secondOK, secondErr := buildRequestFingerprint(second)

	require.NoError(t, firstErr)
	require.NoError(t, secondErr)
	assert.True(t, firstOK)
	assert.True(t, secondOK)
	assert.Equal(t, firstFingerprint, secondFingerprint)
}

func TestBuildRequestFingerprintExcludesAuthenticationQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	first := fingerprintTestContext(t, `{"model":"gemini-test","contents":[]}`)
	second := fingerprintTestContext(t, `{"model":"gemini-test","contents":[]}`)
	first.Request.URL.RawQuery = "alt=sse&key=first-token"
	second.Request.URL.RawQuery = "key=second-token&alt=sse"

	firstFingerprint, _, firstErr := buildRequestFingerprint(first)
	secondFingerprint, _, secondErr := buildRequestFingerprint(second)

	require.NoError(t, firstErr)
	require.NoError(t, secondErr)
	assert.Equal(t, firstFingerprint, secondFingerprint)
}

func TestRequestFingerprintGuardRejectsTerminalHopBeforeFingerprinting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, appI18n.Init())

	marker := ""
	for range common.RequestHopMax {
		marker = common.NextRequestHop(marker)
	}

	var downstreamCalls atomic.Int32
	router := gin.New()
	router.GET("/v1/realtime", RequestFingerprintGuard(), func(c *gin.Context) {
		downstreamCalls.Add(1)
		c.Status(http.StatusNoContent)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/realtime", nil)
	request.Header.Set(common.RequestHopHeader, marker)

	router.ServeHTTP(recorder, request)

	assert.Equal(t, http.StatusLoopDetected, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "request_loop_detected")
	assert.Zero(t, downstreamCalls.Load())
}

func TestRequestFingerprintGuardIgnoresUntrustedHop(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var downstreamCalls atomic.Int32
	router := gin.New()
	router.GET("/v1/realtime", RequestFingerprintGuard(), func(c *gin.Context) {
		downstreamCalls.Add(1)
		c.Status(http.StatusNoContent)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/realtime", nil)
	request.Header.Set(common.RequestHopHeader, "v1:3:forged")

	router.ServeHTTP(recorder, request)

	assert.Equal(t, http.StatusNoContent, recorder.Code)
	assert.Equal(t, int32(1), downstreamCalls.Load())
}

func TestRequestFingerprintGuardRejectsFourthActiveRequestAndReleases(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, appI18n.Init())
	resetInMemoryRequestFingerprints(t)
	previousRedisEnabled := common.RedisEnabled
	previousRedisClient := common.RDB
	common.RedisEnabled = false
	common.RDB = nil
	t.Cleanup(func() {
		common.RedisEnabled = previousRedisEnabled
		common.RDB = previousRedisClient
	})

	entered := make(chan struct{}, requestFingerprintMaxActive)
	release := make(chan struct{})
	var downstreamCalls atomic.Int32
	router := gin.New()
	router.Use(BodyStorageCleanup())
	router.POST("/v1/chat/completions", RequestFingerprintGuard(), func(c *gin.Context) {
		downstreamCalls.Add(1)
		entered <- struct{}{}
		<-release
		c.Status(http.StatusNoContent)
	})

	body := `{"model":"gpt-test","messages":[{"role":"user","content":"loop"}]}`
	results := make(chan int, requestFingerprintMaxActive)
	var requests sync.WaitGroup
	for range requestFingerprintMaxActive {
		requests.Add(1)
		go func() {
			defer requests.Done()
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(body))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(recorder, request)
			results <- recorder.Code
		}()
	}
	for range requestFingerprintMaxActive {
		<-entered
	}

	blockedRecorder := httptest.NewRecorder()
	blockedRequest := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(body))
	blockedRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(blockedRecorder, blockedRequest)
	assert.Equal(t, http.StatusLoopDetected, blockedRecorder.Code)
	assert.Contains(t, blockedRecorder.Body.String(), "request_loop_detected")
	assert.Equal(t, int32(requestFingerprintMaxActive), downstreamCalls.Load())

	close(release)
	requests.Wait()
	close(results)
	for status := range results {
		assert.Equal(t, http.StatusNoContent, status)
	}

	afterReleaseRecorder := httptest.NewRecorder()
	afterReleaseRequest := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(body))
	afterReleaseRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(afterReleaseRecorder, afterReleaseRequest)
	assert.Equal(t, http.StatusNoContent, afterReleaseRecorder.Code)
	assert.Equal(t, int32(requestFingerprintMaxActive+1), downstreamCalls.Load())
}

func TestRedisRequestFingerprintLeaseLimitAndRelease(t *testing.T) {
	_, redisClient := useRateLimitMiniRedis(t)
	fingerprint := "redis-fingerprint"
	leases := make([]*requestFingerprintLease, 0, requestFingerprintMaxActive)
	for range requestFingerprintMaxActive {
		lease, _, allowed, err := acquireRequestFingerprint(context.Background(), fingerprint)
		require.NoError(t, err)
		require.True(t, allowed)
		leases = append(leases, lease)
	}

	blockedLease, activeCount, allowed, err := acquireRequestFingerprint(context.Background(), fingerprint)
	require.NoError(t, err)
	assert.False(t, allowed)
	assert.Nil(t, blockedLease)
	assert.Equal(t, int64(requestFingerprintMaxActive), activeCount)

	require.NoError(t, releaseRequestFingerprint(leases[0]))
	replacement, _, allowed, err := acquireRequestFingerprint(context.Background(), fingerprint)
	require.NoError(t, err)
	assert.True(t, allowed)

	for _, lease := range leases[1:] {
		require.NoError(t, releaseRequestFingerprint(lease))
	}
	require.NoError(t, releaseRequestFingerprint(replacement))
	count, err := redisClient.ZCard(context.Background(), requestFingerprintRedisKey(fingerprint)).Result()
	require.NoError(t, err)
	assert.Zero(t, count)
}
