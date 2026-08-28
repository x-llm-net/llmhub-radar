package router

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestRetiredFrontendAPIRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetApiRouter(engine)

	routes := make(map[string]struct{}, len(engine.Routes()))
	for _, route := range engine.Routes() {
		routes[route.Method+" "+route.Path] = struct{}{}
	}
	_, hasAsyncCleanup := routes[http.MethodPost+" /api/system-task/log-cleanup"]
	_, hasDirectDelete := routes[http.MethodDelete+" /api/log/"]
	_, hasConsoleMigration := routes[http.MethodPost+" /api/option/migrate_console_setting"]
	_, hasHubAdminAccess := routes[http.MethodGet+" /api/hub/admin/access"]
	_, hasHubChannelPublication := routes[http.MethodPut+" /api/hub/admin/channels/:id/publication"]
	_, hasHubChannelPublicationBatch := routes[http.MethodPut+" /api/hub/admin/channels/publication/batch"]
	_, hasTenantList := routes[http.MethodGet+" /api/hub/admin/tenants"]
	_, hasTenantCreate := routes[http.MethodPost+" /api/hub/admin/tenants"]
	_, hasTenantDomainCreate := routes[http.MethodPost+" /api/hub/admin/tenants/:id/domains"]
	_, hasTenantMemberUpsert := routes[http.MethodPost+" /api/hub/admin/tenants/:id/members"]
	_, hasTLSAsk := routes[http.MethodGet+" /api/hub/public/tls-ask"]
	assert.True(t, hasAsyncCleanup)
	assert.False(t, hasDirectDelete)
	assert.False(t, hasConsoleMigration)
	assert.True(t, hasHubAdminAccess)
	assert.True(t, hasHubChannelPublication)
	assert.True(t, hasHubChannelPublicationBatch)
	assert.True(t, hasTenantList)
	assert.True(t, hasTenantCreate)
	assert.True(t, hasTenantDomainCreate)
	assert.True(t, hasTenantMemberUpsert)
	assert.True(t, hasTLSAsk)
}
