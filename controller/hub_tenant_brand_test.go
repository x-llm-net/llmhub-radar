package controller

import (
	"bytes"
	"encoding/base64"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func createTenantBrandFixture(t *testing.T, name, slug, host string, brand model.TenantBrandConfig) model.Tenant {
	t.Helper()
	encoded, err := model.EncodeTenantBrandConfig(brand)
	require.NoError(t, err)
	tenant := model.Tenant{
		Name: name, Slug: slug, Status: model.TenantStatusActive, BrandConfig: encoded,
	}
	require.NoError(t, model.DB.Create(&tenant).Error)
	require.NoError(t, model.DB.Create(&model.TenantDomain{
		TenantId: tenant.Id, Host: host,
		VerificationStatus: model.TenantDomainVerificationVerified,
		Status:             model.TenantDomainStatusActive,
	}).Error)
	return tenant
}

func decodeTenantBrandResponse(t *testing.T, body []byte) struct {
	Success bool                `json:"success"`
	Message string              `json:"message"`
	Data    tenantBrandResponse `json:"data"`
} {
	t.Helper()
	var response struct {
		Success bool                `json:"success"`
		Message string              `json:"message"`
		Data    tenantBrandResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(body, &response))
	return response
}

func newTenantBrandLogoMultipartContext(t *testing.T, brand map[string]string, logo []byte) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	brandJSON, err := common.Marshal(brand)
	require.NoError(t, err)
	require.NoError(t, writer.WriteField("brand", string(brandJSON)))
	part, err := writer.CreateFormFile("logo", "logo.png")
	require.NoError(t, err)
	_, err = part.Write(logo)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/api/hub/admin/brand", &body)
	ctx.Request.Header.Set("Content-Type", writer.FormDataContentType())
	ctx.Set("id", 42)
	return ctx, recorder
}

func TestPublicTenantBrandIsIsolatedByTrustedHost(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}))
	createTenantBrandFixture(t, "Tenant A", "tenant-a", "a.example.com", model.TenantBrandConfig{
		Name: "Brand A", LogoURL: "https://a.example.com/logo.png",
	})
	createTenantBrandFixture(t, "Tenant B", "tenant-b", "b.example.com", model.TenantBrandConfig{
		Name: "Brand B", LogoURL: "https://b.example.com/logo.png",
	})

	for _, test := range []struct {
		host      string
		isTenant  bool
		brandName string
		brandLogo string
	}{
		{host: "a.example.com", isTenant: true, brandName: "Brand A", brandLogo: "https://a.example.com/logo.png"},
		{host: "b.example.com:443", isTenant: true, brandName: "Brand B", brandLogo: "https://b.example.com/logo.png"},
		{host: "unknown.example.com", isTenant: false},
		{host: "localhost:3000", isTenant: false},
	} {
		ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/public/brand", nil, 1)
		ctx.Request.Host = test.host
		GetPublicHubTenantBrand(ctx)
		response := decodeTenantBrandResponse(t, recorder.Body.Bytes())
		require.True(t, response.Success, recorder.Body.String())
		assert.Equal(t, test.isTenant, response.Data.IsTenantHost, test.host)
		assert.Equal(t, test.brandName, response.Data.Brand.Name, test.host)
		assert.Equal(t, test.brandLogo, response.Data.Brand.LogoURL, test.host)
	}
}

func TestTenantBrandUpdatesCurrentTenantWithoutTouchingAnother(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}))
	tenantA := createTenantBrandFixture(t, "Tenant A", "tenant-a", "a.example.com", model.TenantBrandConfig{Name: "Old A"})
	tenantB := createTenantBrandFixture(t, "Tenant B", "tenant-b", "b.example.com", model.TenantBrandConfig{Name: "Brand B"})

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/brand", map[string]any{
		"name":     "  New A  ",
		"logo_url": "https://a.example.com/new-logo.png",
	}, 42)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantA.Id)
	UpdateCurrentHubTenantBrand(ctx)
	response := decodeTenantBrandResponse(t, recorder.Body.Bytes())
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, "New A", response.Data.Brand.Name)

	require.NoError(t, model.DB.First(&tenantA, tenantA.Id).Error)
	require.NoError(t, model.DB.First(&tenantB, tenantB.Id).Error)
	assert.Equal(t, "New A", tenantA.Brand().Name)
	assert.Equal(t, "Brand B", tenantB.Brand().Name)
}

func TestTenantBrandRejectsInvalidLogoAndRootCanUpdateSelectedTenant(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}))
	tenant := createTenantBrandFixture(t, "Tenant", "tenant", "tenant.example.com", model.TenantBrandConfig{Name: "Before"})

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/brand", map[string]any{
		"name": "After", "logo_url": "file:///tmp/logo.png",
	}, 42)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	UpdateCurrentHubTenantBrand(ctx)
	response := decodeTenantBrandResponse(t, recorder.Body.Bytes())
	assert.False(t, response.Success, recorder.Body.String())

	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/tenants/1/brand", map[string]any{
		"name": "Root updated", "logo_url": "",
	}, 1)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(tenant.Id)}}
	AdminUpdateHubTenantBrand(ctx)
	response = decodeTenantBrandResponse(t, recorder.Body.Bytes())
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, "Root updated", response.Data.Brand.Name)
}

func TestTenantBrandAcceptsLogoUploadAndServesPublicAsset(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(
		&model.Tenant{},
		&model.TenantDomain{},
		&model.TenantBrandAsset{},
	))
	tenant := createTenantBrandFixture(t, "Tenant", "tenant", "tenant.example.com", model.TenantBrandConfig{Name: "Before"})
	png, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	ctx, recorder := newTenantBrandLogoMultipartContext(t, map[string]string{
		"name":     "Uploaded brand",
		"logo_url": "",
	}, png)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)

	UpdateCurrentHubTenantBrand(ctx)

	response := decodeTenantBrandResponse(t, recorder.Body.Bytes())
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, "Uploaded brand", response.Data.Brand.Name)
	assetID := tenantBrandAssetID(response.Data.Brand.LogoURL)
	require.Positive(t, assetID)
	asset, err := model.GetActiveTenantBrandAsset(assetID)
	require.NoError(t, err)
	assert.Equal(t, tenant.Id, asset.TenantId)
	assert.Equal(t, png, asset.Data)

	assetContext, assetRecorder := newAuthenticatedContext(t, http.MethodGet, response.Data.Brand.LogoURL, nil, 0)
	assetContext.Params = gin.Params{{Key: "asset_id", Value: strconv.Itoa(assetID)}}
	GetPublicHubTenantBrandAsset(assetContext)
	assert.Equal(t, http.StatusOK, assetRecorder.Code)
	assert.Equal(t, "image/png", assetRecorder.Header().Get("Content-Type"))
	assert.Equal(t, png, assetRecorder.Body.Bytes())
}
