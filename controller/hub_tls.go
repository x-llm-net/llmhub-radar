package controller

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// AuthorizeHubPublicTLS is the Caddy on-demand TLS authorization callback.
// Caddy only needs the status code: a successful response means the requested
// host is allowed to receive a publicly trusted certificate.
func AuthorizeHubPublicTLS(c *gin.Context) {
	host := strings.TrimSpace(c.Query("domain"))
	if host == "" {
		c.Status(http.StatusForbidden)
		return
	}

	resolution, err := model.ResolveTenantHost(host)
	if err != nil || !resolution.IsTenantHost {
		c.Status(http.StatusForbidden)
		return
	}

	c.Status(http.StatusNoContent)
}
