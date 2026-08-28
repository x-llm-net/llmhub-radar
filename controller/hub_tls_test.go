package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func callHubTLSAuthorization(t *testing.T, host string) int {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/hub/public/tls-ask?domain="+host, nil)
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = request
	AuthorizeHubPublicTLS(ctx)
	ctx.Writer.WriteHeaderNow()
	return ctx.Writer.Status()
}

func TestAuthorizeHubPublicTLSRequiresTrustedTenantHost(t *testing.T) {
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = originalMemoryCacheEnabled })

	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}, &model.HubProvider{}))
	tenant := model.Tenant{Name: "TLS tenant", Slug: "tls-tenant", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(&tenant).Error)
	require.NoError(t, model.DB.Create(&model.TenantDomain{
		TenantId: tenant.Id, Host: "tls-example.com", IsPrimary: true,
		VerificationStatus: model.TenantDomainVerificationVerified,
		Status:             model.TenantDomainStatusActive,
	}).Error)
	provider := &model.HubProvider{
		OwnerUserId: 94011, TenantId: &tenant.Id, Name: "TLS Provider", Slug: "tls-provider",
		Status: model.HubProviderStatusActive,
	}
	require.NoError(t, model.DB.Create(provider).Error)
	require.NoError(t, model.RefreshHubSupplyPricingCache())

	assert.Equal(t, http.StatusNoContent, callHubTLSAuthorization(t, "tls-example.com"))
	assert.Equal(t, http.StatusNoContent, callHubTLSAuthorization(t, "tls-provider.tls-example.com"))
	assert.Equal(t, http.StatusForbidden, callHubTLSAuthorization(t, "pending.tls-example.com"))
	assert.Equal(t, http.StatusForbidden, callHubTLSAuthorization(t, "unknown.example"))
	assert.Equal(t, http.StatusForbidden, callHubTLSAuthorization(t, ""))
}

func TestAuthorizeHubPublicTLSRejectsDisabledProvider(t *testing.T) {
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = originalMemoryCacheEnabled })

	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}, &model.HubProvider{}))
	tenant := model.Tenant{Name: "Disabled TLS tenant", Slug: "disabled-tls-tenant", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(&tenant).Error)
	require.NoError(t, model.DB.Create(&model.TenantDomain{
		TenantId: tenant.Id, Host: "disabled-tls.com", IsPrimary: true,
		VerificationStatus: model.TenantDomainVerificationVerified,
		Status:             model.TenantDomainStatusActive,
	}).Error)
	provider := &model.HubProvider{
		OwnerUserId: 94012, TenantId: &tenant.Id, Name: "Disabled TLS Provider", Slug: "disabled-tls-provider",
		Status: model.HubProviderStatusDisabled,
	}
	require.NoError(t, model.DB.Create(provider).Error)
	require.NoError(t, model.RefreshHubSupplyPricingCache())

	assert.Equal(t, http.StatusForbidden, callHubTLSAuthorization(t, "disabled-tls-provider.disabled-tls.com"))
}
