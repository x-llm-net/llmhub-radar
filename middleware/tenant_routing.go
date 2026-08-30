package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// TenantHostContext resolves a trusted custom tenant host into request
// context. Callers should mount it only on tenant-aware management routes;
// existing relay and dashboard traffic must not pay this lookup.
func TenantHostContext() gin.HandlerFunc {
	return func(c *gin.Context) {
		resolution, err := model.ResolveTenantHost(c.Request.Host)
		if err == nil && resolution.IsTenantHost {
			common.SetContextKey(c, constant.ContextKeyTenantId, resolution.TenantID)
		}
		c.Next()
	}
}

// TenantHostContextRequired is used by public tenant-facing endpoints. An
// unknown, unverified, disabled, or non-domain Host must never fall back to
// the platform-wide data set.
func TenantHostContextRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		resolution, err := model.ResolveTenantHost(c.Request.Host)
		if err != nil || !resolution.IsTenantHost || resolution.TenantID <= 0 {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		common.SetContextKey(c, constant.ContextKeyTenantId, resolution.TenantID)
		c.Next()
	}
}
