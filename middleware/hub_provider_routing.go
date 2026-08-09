package middleware

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func HubProviderRouting() gin.HandlerFunc {
	return func(c *gin.Context) {
		resolution, err := model.ResolveHubProviderHost(c.Request.Host)
		if err != nil {
			switch {
			case errors.Is(err, model.ErrHubProviderHostNotFound):
				abortWithOpenAiMessage(c, http.StatusNotFound, "Provider subdomain does not exist")
			default:
				abortWithOpenAiMessage(c, http.StatusBadRequest, "Invalid provider subdomain")
			}
			return
		}
		if !resolution.IsProviderHost {
			c.Next()
			return
		}
		if resolution.Provider.Status != model.HubProviderStatusActive {
			abortWithOpenAiMessage(c, http.StatusServiceUnavailable, "Provider is currently unavailable")
			return
		}
		common.SetContextKey(c, constant.ContextKeyHubRequestedProviderId, resolution.Provider.Id)
		common.SetContextKey(c, constant.ContextKeyHubRequestedProviderSlug, resolution.Provider.Slug)
		common.SetContextKey(c, constant.ContextKeyHubRoutingPhase, "preferred")
		common.SetContextKey(c, constant.ContextKeyHubRoutingFallback, false)
		c.Next()
	}
}
