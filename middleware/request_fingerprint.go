package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	requestFingerprintNamespace         = "requestFingerprint:v1"
	requestFingerprintMaxActive         = 3
	requestFingerprintLeaseTTL          = 10 * time.Minute
	requestFingerprintCanonicalMaxBytes = int64(8 << 20)
	requestFingerprintContextKey        = "request_fingerprint"
)

const requestFingerprintAcquireScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[4]) then
  return {0, count}
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[5])
return {1, count + 1}
`

const requestFingerprintReleaseScript = `
local removed = redis.call('ZREM', KEYS[1], ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count == 0 then
  redis.call('DEL', KEYS[1])
end
return {removed, count}
`

type requestFingerprintLease struct {
	key      string
	member   string
	useRedis bool
}

type requestFingerprintMemoryState struct {
	sync.Mutex
	leases map[string]map[string]time.Time
}

var activeRequestFingerprints = requestFingerprintMemoryState{
	leases: make(map[string]map[string]time.Time),
}

// RequestFingerprintGuard stops recursive gateway calls after the same JSON
// inference request re-enters this service too many times while still active.
func RequestFingerprintGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		fingerprint, ok, err := buildRequestFingerprint(c)
		if err != nil {
			logger.LogWarn(c.Request.Context(), fmt.Sprintf("request fingerprint skipped: %v", err))
			c.Next()
			return
		}
		if !ok {
			c.Next()
			return
		}

		lease, activeCount, allowed, fallbackErr := acquireRequestFingerprint(c.Request.Context(), fingerprint)
		if fallbackErr != nil {
			logger.LogWarn(c.Request.Context(), fmt.Sprintf("request fingerprint Redis unavailable, using in-memory guard: %v", fallbackErr))
		}
		if !allowed {
			logger.LogWarn(c.Request.Context(), fmt.Sprintf(
				"recursive request fingerprint rejected: fingerprint=%s active=%d path=%s user_id=%d token_id=%d",
				fingerprint[:16], activeCount, c.Request.URL.Path, c.GetInt("id"), c.GetInt("token_id"),
			))
			abortWithOpenAiMessage(
				c,
				http.StatusLoopDetected,
				i18n.T(c, i18n.MsgRequestLoopDetected),
				types.ErrorCode("request_loop_detected"),
			)
			return
		}

		c.Set(requestFingerprintContextKey, fingerprint)
		defer func() {
			if err := releaseRequestFingerprint(lease); err != nil {
				logger.LogWarn(context.Background(), fmt.Sprintf(
					"request fingerprint release failed: fingerprint=%s err=%v",
					fingerprint[:16], err,
				))
			}
		}()
		c.Next()
	}
}

func buildRequestFingerprint(c *gin.Context) (string, bool, error) {
	if c.Request.Method != http.MethodPost || !strings.HasPrefix(strings.ToLower(c.Request.Header.Get("Content-Type")), "application/json") {
		return "", false, nil
	}

	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return "", false, err
	}
	defer func() {
		_, _ = storage.Seek(0, io.SeekStart)
		c.Request.Body = io.NopCloser(storage)
	}()
	if storage.Size() == 0 {
		return "", false, nil
	}

	hash := sha256.New()
	_, _ = io.WriteString(hash, c.Request.URL.EscapedPath())
	if query := c.Request.URL.Query().Encode(); query != "" {
		_, _ = io.WriteString(hash, "?"+query)
	}
	_, _ = hash.Write([]byte{0})

	if storage.Size() > requestFingerprintCanonicalMaxBytes {
		if _, err := storage.Seek(0, io.SeekStart); err != nil {
			return "", false, err
		}
		if _, err := io.Copy(hash, storage); err != nil {
			return "", false, err
		}
		return hex.EncodeToString(hash.Sum(nil)), true, nil
	}

	body, err := storage.Bytes()
	if err != nil {
		return "", false, err
	}
	var payload any
	if err := common.Unmarshal(body, &payload); err != nil {
		// Preserve the distributor's existing invalid-JSON response contract.
		return "", false, nil
	}
	if object, ok := payload.(map[string]any); ok {
		// Gateways commonly add or remove these routing/stream bookkeeping fields.
		delete(object, "group")
		delete(object, "stream_options")
	}
	canonical, err := common.Marshal(payload)
	if err != nil {
		return "", false, err
	}
	_, _ = hash.Write(canonical)
	return hex.EncodeToString(hash.Sum(nil)), true, nil
}

func requestFingerprintRedisKey(fingerprint string) string {
	return requestFingerprintNamespace + ":" + fingerprint
}

func acquireRequestFingerprint(ctx context.Context, fingerprint string) (*requestFingerprintLease, int64, bool, error) {
	member := uuid.NewString()
	key := requestFingerprintRedisKey(fingerprint)
	now := time.Now()
	expiresAt := now.Add(requestFingerprintLeaseTTL)

	if common.RedisEnabled && common.RDB != nil {
		values, err := common.RDB.Eval(
			ctx,
			requestFingerprintAcquireScript,
			[]string{key},
			now.UnixMilli(),
			expiresAt.UnixMilli(),
			member,
			requestFingerprintMaxActive,
			int64(requestFingerprintLeaseTTL/time.Second),
		).Slice()
		if err == nil {
			if len(values) != 2 {
				err = fmt.Errorf("unexpected Redis request fingerprint reply length %d", len(values))
			} else {
				allowedValue, allowedErr := redisReplyInteger(values[0])
				count, countErr := redisReplyInteger(values[1])
				if allowedErr == nil && countErr == nil {
					if allowedValue == 0 {
						return nil, count, false, nil
					}
					return &requestFingerprintLease{key: key, member: member, useRedis: true}, count, true, nil
				}
				err = fmt.Errorf("invalid Redis request fingerprint reply: allowed=%v count=%v", allowedErr, countErr)
			}
		}

		lease, count, allowed := acquireInMemoryRequestFingerprint(key, member, now, expiresAt)
		return lease, count, allowed, err
	}

	lease, count, allowed := acquireInMemoryRequestFingerprint(key, member, now, expiresAt)
	return lease, count, allowed, nil
}

func acquireInMemoryRequestFingerprint(key string, member string, now time.Time, expiresAt time.Time) (*requestFingerprintLease, int64, bool) {
	activeRequestFingerprints.Lock()
	defer activeRequestFingerprints.Unlock()

	entries := activeRequestFingerprints.leases[key]
	if entries == nil {
		entries = make(map[string]time.Time)
		activeRequestFingerprints.leases[key] = entries
	}
	for existingMember, expiry := range entries {
		if !expiry.After(now) {
			delete(entries, existingMember)
		}
	}
	if len(entries) >= requestFingerprintMaxActive {
		return nil, int64(len(entries)), false
	}
	entries[member] = expiresAt
	return &requestFingerprintLease{key: key, member: member}, int64(len(entries)), true
}

func releaseRequestFingerprint(lease *requestFingerprintLease) error {
	if lease == nil {
		return nil
	}
	if lease.useRedis {
		if common.RDB == nil {
			return fmt.Errorf("Redis client is unavailable")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return common.RDB.Eval(ctx, requestFingerprintReleaseScript, []string{lease.key}, lease.member).Err()
	}

	activeRequestFingerprints.Lock()
	defer activeRequestFingerprints.Unlock()
	entries := activeRequestFingerprints.leases[lease.key]
	delete(entries, lease.member)
	if len(entries) == 0 {
		delete(activeRequestFingerprints.leases, lease.key)
	}
	return nil
}
