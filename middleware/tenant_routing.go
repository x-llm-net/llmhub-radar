package middleware

import (
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
