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
	"github.com/QuantumNous/new-api/middleware"
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
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}, &model.HubProvider{}))
	tenantA := createTenantBrandFixture(t, "Tenant A", "tenant-a", "tenant-a.example", model.TenantBrandConfig{
		Name: "Brand A", LogoURL: "https://a.example.com/logo.png",
	})
	createTenantBrandFixture(t, "Tenant B", "tenant-b", "tenant-b.example", model.TenantBrandConfig{
		Name: "Brand B", LogoURL: "https://b.example.com/logo.png",
	})
	t.Setenv("HUB_PROVIDER_ROOT_DOMAIN", "llm-hub.store")
	provider := &model.HubProvider{
		OwnerUserId: 94004,
		TenantId:    &tenantA.Id,
		Name:        "Tenant A provider",
		Slug:        "tenant-a-provider",
		Status:      model.HubProviderStatusActive,
	}
	require.NoError(t, model.CreateHubProvider(provider))

	for _, test := range []struct {
		host      string
		isTenant  bool
		brandName string
		brandLogo string
	}{
		{host: "tenant-a.example", isTenant: true, brandName: "Brand A", brandLogo: "https://a.example.com/logo.png"},
		{host: "tenant-b.example:443", isTenant: true, brandName: "Brand B", brandLogo: "https://b.example.com/logo.png"},
		{host: "tenant-a-provider.llm-hub.store", isTenant: true, brandName: "Brand A", brandLogo: "https://a.example.com/logo.png"},
		{host: "unknown.example", isTenant: false},
		{host: "localhost:3000", isTenant: false},
	} {
		ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/public/brand", nil, 1)
		ctx.Request.Host = test.host
		middleware.TenantHostContextRequired()(ctx)
		if !ctx.IsAborted() {
			GetPublicHubTenantBrand(ctx)
		}
		if !test.isTenant {
			assert.Equal(t, http.StatusNotFound, recorder.Code, test.host)
			continue
		}
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
	tenantA := createTenantBrandFixture(t, "Tenant A", "tenant-a", "tenant-a.example", model.TenantBrandConfig{Name: "Old A"})
	tenantB := createTenantBrandFixture(t, "Tenant B", "tenant-b", "tenant-b.example", model.TenantBrandConfig{Name: "Brand B"})

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/brand", map[string]any{
		"name":     "  New A  ",
		"logo_url": "https://a.example.com/new-logo.png",
		"business_contact": map[string]any{
			"name": " Sales ", "type": "EMAIL", "value": " sales@a.example ", "description": " Weekdays ",
		},
	}, 42)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantA.Id)
	UpdateCurrentHubTenantBrand(ctx)
	response := decodeTenantBrandResponse(t, recorder.Body.Bytes())
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, "New A", response.Data.Brand.Name)

	require.NoError(t, model.DB.First(&tenantA, tenantA.Id).Error)
	require.NoError(t, model.DB.First(&tenantB, tenantB.Id).Error)
	assert.Equal(t, "New A", tenantA.Brand().Name)
	assert.Equal(t, model.BusinessContact{
		Name: "Sales", Type: "email", Value: "sales@a.example", Description: "Weekdays",
	}, tenantA.Brand().BusinessContact)
	assert.Equal(t, "Brand B", tenantB.Brand().Name)
}

func TestPublicBusinessContactUsesTenantThenPlatformFallbackOnRootHost(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}, &model.HubProvider{}))
	tenant := createTenantBrandFixture(t, "Tenant", "tenant", "tenant.example", model.TenantBrandConfig{
		Name: "Tenant",
		BusinessContact: model.BusinessContact{
			Name: "Tenant sales", Type: "wechat", Value: "tenant-sales", Description: "Tenant contact",
		},
	})
	t.Setenv("HUB_PROVIDER_ROOT_DOMAIN", "llm-hub.store")
	provider := &model.HubProvider{
		OwnerUserId: 94005,
		TenantId:    &tenant.Id,
		Name:        "Tenant provider",
		Slug:        "tenant-provider",
		Status:      model.HubProviderStatusActive,
	}
	require.NoError(t, model.CreateHubProvider(provider))

	common.OptionMapRWMutex.Lock()
	var previousOptionMap map[string]string
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	} else {
		previousOptionMap = make(map[string]string, len(common.OptionMap))
		for key, value := range common.OptionMap {
			previousOptionMap[key] = value
		}
	}
	for key, value := range map[string]string{
		model.HubBusinessContactNameOption:        "Platform sales",
		model.HubBusinessContactTypeOption:        "email",
		model.HubBusinessContactValueOption:       "platform@example.com",
		model.HubBusinessContactDescriptionOption: "Platform contact",
	} {
		common.OptionMap[key] = value
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if previousOptionMap == nil {
			common.OptionMap = nil
			return
		}
		common.OptionMap = previousOptionMap
	})

	requestContact := func(host string) (*httptest.ResponseRecorder, struct {
		Success bool                          `json:"success"`
		Data    publicBusinessContactResponse `json:"data"`
	}) {
		ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/public/business-contact", nil, 0)
		ctx.Request.Host = host
		middleware.TenantHostContextRequired()(ctx)
		if !ctx.IsAborted() {
			GetPublicHubBusinessContact(ctx)
		}
		var response struct {
			Success bool                          `json:"success"`
			Data    publicBusinessContactResponse `json:"data"`
		}
		if recorder.Code == http.StatusOK {
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		}
		return recorder, response
	}

	recorder, response := requestContact("tenant.example")
	require.Equal(t, http.StatusOK, recorder.Code)
	require.True(t, response.Success)
	assert.Equal(t, "tenant", response.Data.Source)
	assert.Equal(t, "tenant-sales", response.Data.Contact.Value)

	brand := tenant.Brand()
	brand.BusinessContact = model.BusinessContact{}
	encoded, err := model.EncodeTenantBrandConfig(brand)
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(&tenant).Update("brand_config", encoded).Error)
	recorder, response = requestContact("tenant.example")
	require.Equal(t, http.StatusOK, recorder.Code)
	require.True(t, response.Success)
	assert.Equal(t, "platform", response.Data.Source)
	assert.Equal(t, "platform@example.com", response.Data.Contact.Value)

	recorder, _ = requestContact("tenant-provider.llm-hub.store")
	assert.Equal(t, http.StatusNotFound, recorder.Code)

	common.OptionMapRWMutex.Lock()
	common.OptionMap[model.HubBusinessContactValueOption] = ""
	common.OptionMapRWMutex.Unlock()
	recorder, response = requestContact("tenant.example")
	require.Equal(t, http.StatusOK, recorder.Code)
	require.True(t, response.Success)
	assert.Empty(t, response.Data.Source)
	assert.Empty(t, response.Data.Contact.Value)
}

func TestTenantBrandRejectsInvalidLogoAndRootCanUpdateSelectedTenant(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}))
	tenant := createTenantBrandFixture(t, "Tenant", "tenant", "tenant.example", model.TenantBrandConfig{
		Name: "Before",
		BusinessContact: model.BusinessContact{
			Name: "Existing", Type: "wechat", Value: "existing-contact",
		},
	})

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
	assert.Equal(t, "existing-contact", response.Data.Brand.BusinessContact.Value)
}

func TestTenantBrandAcceptsLogoUploadAndServesPublicAsset(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(
		&model.Tenant{},
		&model.TenantDomain{},
		&model.TenantBrandAsset{},
	))
	tenant := createTenantBrandFixture(t, "Tenant", "tenant", "tenant.example", model.TenantBrandConfig{Name: "Before"})
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
	common.SetContextKey(assetContext, constant.ContextKeyTenantId, tenant.Id)
	assetContext.Params = gin.Params{{Key: "asset_id", Value: strconv.Itoa(assetID)}}
	GetPublicHubTenantBrandAsset(assetContext)
	assert.Equal(t, http.StatusOK, assetRecorder.Code)
	assert.Equal(t, "image/png", assetRecorder.Header().Get("Content-Type"))
	assert.Equal(t, png, assetRecorder.Body.Bytes())

	otherTenant := createTenantBrandFixture(t, "Other tenant", "other-tenant", "other.example", model.TenantBrandConfig{Name: "Other"})
	foreignContext, foreignRecorder := newAuthenticatedContext(t, http.MethodGet, response.Data.Brand.LogoURL, nil, 0)
	common.SetContextKey(foreignContext, constant.ContextKeyTenantId, otherTenant.Id)
	foreignContext.Params = gin.Params{{Key: "asset_id", Value: strconv.Itoa(assetID)}}
	GetPublicHubTenantBrandAsset(foreignContext)
	assert.Equal(t, http.StatusNotFound, foreignRecorder.Code)
}
