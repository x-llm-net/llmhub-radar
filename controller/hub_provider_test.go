/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"bytes"
	"encoding/base64"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type hubProviderAPIResponse struct {
	Success bool               `json:"success"`
	Message string             `json:"message"`
	Data    *model.HubProvider `json:"data"`
}

func decodeHubProviderAPIResponse(t *testing.T, body []byte) hubProviderAPIResponse {
	t.Helper()
	var response hubProviderAPIResponse
	require.NoError(t, common.Unmarshal(body, &response))
	return response
}

func newHubProviderMultipartContext(
	t *testing.T,
	method string,
	profile map[string]string,
	verifyWebsite bool,
	filename string,
	fileData []byte,
	userID int,
) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	profileJSON, err := common.Marshal(profile)
	require.NoError(t, err)
	require.NoError(t, writer.WriteField("profile", string(profileJSON)))
	require.NoError(t, writer.WriteField("verify_website", strconv.FormatBool(verifyWebsite)))
	if filename != "" {
		part, createErr := writer.CreateFormFile("file", filename)
		require.NoError(t, createErr)
		_, writeErr := part.Write(fileData)
		require.NoError(t, writeErr)
	}
	require.NoError(t, writer.Close())

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(method, "/api/hub/provider", &body)
	ctx.Request.Header.Set("Content-Type", writer.FormDataContentType())
	ctx.Set("id", userID)
	return ctx, recorder
}

func newHubProviderLogoMultipartContext(
	t *testing.T,
	profile map[string]string,
	logoData []byte,
	userID int,
) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	profileJSON, err := common.Marshal(profile)
	require.NoError(t, err)
	require.NoError(t, writer.WriteField("profile", string(profileJSON)))
	part, err := writer.CreateFormFile("logo", "logo.png")
	require.NoError(t, err)
	_, err = part.Write(logoData)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/hub/provider", &body)
	ctx.Request.Header.Set("Content-Type", writer.FormDataContentType())
	ctx.Set("id", userID)
	return ctx, recorder
}

func TestCreateHubProviderCreatesCurrentUsersProvider(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}))

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider", map[string]string{
		"name":          "Acme AI",
		"slug":          "acme-ai",
		"website":       "https://acme.example",
		"description":   "Reliable model access",
		"logo_url":      "https://acme.example/logo.png",
		"contact_type":  "email",
		"contact_value": "owner@acme.example",
		"support_type":  "community",
		"support_value": "https://acme.example/community",
	}, 42)
	CreateHubProvider(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	require.True(t, response.Success)
	require.NotNil(t, response.Data)
	assert.Equal(t, "Acme AI", response.Data.Name)
	assert.Regexp(t, `^acme-ai-[a-z0-9]{4}$`, response.Data.Slug)
	assert.Equal(t, "acme-ai", response.Data.SlugBase)
	assert.Equal(t, model.HubProviderWebsiteVerificationStatusUnverified, response.Data.WebsiteVerificationStatus)
	assert.Equal(t, "owner@acme.example", response.Data.ContactValue)
	assert.Equal(t, "https://acme.example/community", response.Data.SupportValue)
	assert.Equal(t, model.HubProviderStatusPending, response.Data.Status)

	stored, err := model.GetHubProviderByOwnerUserID(42)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, response.Data.Id, stored.Id)
}

func TestCreateHubProviderAcceptsLogoUploadAndServesPublicAsset(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}, &model.HubProviderLogoAsset{}))
	png, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	ctx, recorder := newHubProviderLogoMultipartContext(t, map[string]string{
		"name":          "Logo Provider",
		"slug":          "logo-provider",
		"website":       "",
		"description":   "Provider with an uploaded logo",
		"contact_type":  "qq",
		"contact_value": "123456789",
		"support_type":  "community",
		"support_value": "https://example.com/community",
	}, png, 42)

	CreateHubProvider(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	require.True(t, response.Success, recorder.Body.String())
	require.NotNil(t, response.Data)
	require.Positive(t, response.Data.LogoAssetId)
	assert.Equal(t, "/api/hub/provider/logo", response.Data.LogoURL)

	asset, err := model.GetHubProviderLogoAsset(response.Data.Id)
	require.NoError(t, err)
	assert.Equal(t, "image/png", asset.ContentType)
	assert.Equal(t, png, asset.Data)

	require.NoError(t, db.Model(&model.HubProvider{}).Where("id = ?", response.Data.Id).
		Update("status", model.HubProviderStatusActive).Error)
	publicContext, publicRecorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/public/providers/logo-provider/logo", nil, 42)
	publicContext.Params = gin.Params{{Key: "slug", Value: response.Data.Slug}}
	GetPublicHubProviderLogo(publicContext)
	assert.Equal(t, http.StatusOK, publicRecorder.Code)
	assert.Equal(t, "image/png", publicRecorder.Header().Get("Content-Type"))
	assert.Equal(t, png, publicRecorder.Body.Bytes())
}

func TestCreateHubProviderCanSubmitManualWebsiteVerificationAtomically(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.HubProvider{},
		&model.HubProviderWebsiteEvidenceAsset{},
	))
	png, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	ctx, recorder := newHubProviderMultipartContext(t, http.MethodPost, map[string]string{
		"name":          "Verified Acme",
		"slug":          "verified-acme",
		"website":       "https://verified.example/admin",
		"description":   "Verified during onboarding",
		"contact_type":  "qq",
		"contact_value": "123456789",
	}, true, "admin.png", png, 42)

	CreateHubProvider(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	require.True(t, response.Success, recorder.Body.String())
	require.NotNil(t, response.Data)
	assert.Equal(t, model.HubProviderWebsiteVerificationStatusPending, response.Data.WebsiteVerificationStatus)
	assert.Equal(t, model.HubProviderWebsiteVerificationMethodManual, response.Data.WebsiteVerificationMethod)
	require.Positive(t, response.Data.WebsiteEvidenceAssetId)
	assert.Equal(t, "https://verified.example", response.Data.WebsiteVerifiedOrigin)

	asset, err := model.GetHubProviderWebsiteEvidenceAsset(response.Data.WebsiteEvidenceAssetId)
	require.NoError(t, err)
	assert.Equal(t, response.Data.Id, asset.ProviderId)
	assert.Equal(t, png, asset.Data)
}

func TestCreateHubProviderRejectsInvalidOnboardingEvidenceWithoutCreatingProvider(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.HubProvider{},
		&model.HubProviderWebsiteEvidenceAsset{},
	))
	ctx, recorder := newHubProviderMultipartContext(t, http.MethodPost, map[string]string{
		"name":          "Invalid Evidence",
		"slug":          "invalid-evidence",
		"website":       "https://invalid.example",
		"contact_type":  "qq",
		"contact_value": "123456789",
	}, true, "evidence.txt", []byte("not an image"), 42)

	CreateHubProvider(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	assert.False(t, response.Success)
	var providerCount int64
	var assetCount int64
	require.NoError(t, db.Model(&model.HubProvider{}).Count(&providerCount).Error)
	require.NoError(t, db.Model(&model.HubProviderWebsiteEvidenceAsset{}).Count(&assetCount).Error)
	assert.Zero(t, providerCount)
	assert.Zero(t, assetCount)
}

func TestCreateHubProviderRejectsSecondProviderForCurrentUser(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}))
	require.NoError(t, model.CreateHubProvider(&model.HubProvider{OwnerUserId: 42, Name: "First"}))

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider", map[string]string{
		"name":          "Second",
		"slug":          "second",
		"contact_type":  "email",
		"contact_value": "second@example.com",
	}, 42)
	CreateHubProvider(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	assert.False(t, response.Success)
	assert.Nil(t, response.Data)

	var count int64
	require.NoError(t, db.Model(&model.HubProvider{}).Where("owner_user_id = ?", 42).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

func TestUpdateHubProviderUpdatesOnlyPublicProfile(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}))
	provider := &model.HubProvider{
		OwnerUserId: 42,
		Name:        "Old name",
		Website:     "https://old.example",
		Description: "Old description",
		LogoURL:     "https://old.example/logo.png",
	}
	require.NoError(t, model.CreateHubProvider(provider))

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider", map[string]string{
		"name":          "New name",
		"slug":          provider.Slug,
		"website":       "https://new.example",
		"description":   "New description",
		"logo_url":      "https://new.example/logo.png",
		"contact_type":  "telegram",
		"contact_value": "@acme_support",
		"support_type":  "customer_service",
		"support_value": "https://t.me/acme_support",
	}, 42)
	UpdateHubProviderProfile(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	require.True(t, response.Success)
	require.NotNil(t, response.Data)
	assert.Equal(t, "New name", response.Data.Name)
	assert.Equal(t, "https://new.example", response.Data.Website)
	assert.Equal(t, "New description", response.Data.Description)
	assert.Equal(t, "https://new.example/logo.png", response.Data.LogoURL)
	assert.Equal(t, "@acme_support", response.Data.ContactValue)
	assert.Equal(t, "https://t.me/acme_support", response.Data.SupportValue)
	assert.Equal(t, model.HubProviderStatusActive, response.Data.Status)

	stored, err := model.GetHubProviderByOwnerUserID(42)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, "New name", stored.Name)
}

func TestUpdateHubProviderCanSubmitManualWebsiteVerificationAtomically(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.HubProvider{},
		&model.HubProviderWebsiteEvidenceAsset{},
	))
	provider := &model.HubProvider{
		OwnerUserId: 42,
		Name:        "Pending provider",
		Website:     "https://old.example",
		Status:      model.HubProviderStatusPending,
	}
	require.NoError(t, model.CreateHubProvider(provider))
	png, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	ctx, recorder := newHubProviderMultipartContext(t, http.MethodPut, map[string]string{
		"name":          "Updated pending provider",
		"slug":          provider.Slug,
		"website":       "https://new.example/admin",
		"description":   "Updated with verification",
		"contact_type":  "qq",
		"contact_value": "123456789",
	}, true, "admin.png", png, 42)

	UpdateHubProviderProfile(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	require.True(t, response.Success, recorder.Body.String())
	require.NotNil(t, response.Data)
	assert.Equal(t, "Updated pending provider", response.Data.Name)
	assert.Equal(t, "https://new.example/admin", response.Data.Website)
	assert.Equal(t, model.HubProviderWebsiteVerificationStatusPending, response.Data.WebsiteVerificationStatus)
	assert.Equal(t, model.HubProviderWebsiteVerificationMethodManual, response.Data.WebsiteVerificationMethod)
	assert.Equal(t, "https://new.example", response.Data.WebsiteVerifiedOrigin)
	require.Positive(t, response.Data.WebsiteEvidenceAssetId)

	asset, err := model.GetHubProviderWebsiteEvidenceAsset(response.Data.WebsiteEvidenceAssetId)
	require.NoError(t, err)
	assert.Equal(t, response.Data.Id, asset.ProviderId)
	assert.Equal(t, png, asset.Data)
}

func TestUpdateHubProviderRejectsInvalidEvidenceWithoutChangingProfile(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.HubProvider{},
		&model.HubProviderWebsiteEvidenceAsset{},
	))
	provider := &model.HubProvider{
		OwnerUserId: 42,
		Name:        "Original provider",
		Website:     "https://old.example",
		Status:      model.HubProviderStatusPending,
	}
	require.NoError(t, model.CreateHubProvider(provider))
	ctx, recorder := newHubProviderMultipartContext(t, http.MethodPut, map[string]string{
		"name":          "Should not be saved",
		"slug":          provider.Slug,
		"website":       "https://new.example",
		"contact_type":  "qq",
		"contact_value": "123456789",
	}, true, "evidence.txt", []byte("not an image"), 42)

	UpdateHubProviderProfile(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	assert.False(t, response.Success)
	stored, err := model.GetHubProviderByOwnerUserID(42)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, "Original provider", stored.Name)
	assert.Equal(t, "https://old.example", stored.Website)
	var assetCount int64
	require.NoError(t, db.Model(&model.HubProviderWebsiteEvidenceAsset{}).Count(&assetCount).Error)
	assert.Zero(t, assetCount)
}

func TestUpdateHubProviderRequiresExistingProfile(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}))

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider", map[string]string{
		"name":          "Missing provider",
		"slug":          "missing-provider",
		"contact_type":  "email",
		"contact_value": "missing@example.com",
	}, 42)
	UpdateHubProviderProfile(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	assert.False(t, response.Success)
	assert.Nil(t, response.Data)
}

func TestRejectedHubProviderProfileUpdateResubmitsApplication(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}))
	provider := &model.HubProvider{OwnerUserId: 42, Name: "Rejected provider"}
	require.NoError(t, model.CreateHubProvider(provider))
	require.NoError(t, db.Model(&model.HubProvider{Id: provider.Id}).Updates(map[string]any{
		"status":              model.HubProviderStatusRejected,
		"review_remark":       "Missing service details",
		"reviewed_by_user_id": 7,
		"reviewed_at":         int64(12345),
	}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider", map[string]string{
		"name":          "Updated provider",
		"slug":          provider.Slug,
		"website":       "https://updated.example",
		"description":   "Service details added",
		"logo_url":      "",
		"contact_type":  "wechat",
		"contact_value": "acme-owner",
		"support_type":  "community",
		"support_value": "",
	}, 42)
	UpdateHubProviderProfile(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	require.True(t, response.Success, recorder.Body.String())
	require.NotNil(t, response.Data)
	assert.Equal(t, model.HubProviderStatusPending, response.Data.Status)
	assert.Empty(t, response.Data.ReviewRemark)
	assert.Zero(t, response.Data.ReviewedByUserId)
	assert.Zero(t, response.Data.ReviewedAt)
}

func TestHubProviderHTTPURLValidation(t *testing.T) {
	tests := []struct {
		name  string
		value string
		valid bool
	}{
		{name: "optional empty value", value: "", valid: true},
		{name: "https URL", value: "https://example.com/logo.png", valid: true},
		{name: "http URL", value: "http://example.com", valid: true},
		{name: "missing scheme", value: "example.com", valid: false},
		{name: "unsupported scheme", value: "javascript:alert(1)", valid: false},
		{name: "embedded credentials", value: "https://user:pass@example.com", valid: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.valid, isHubProviderHTTPURL(test.value))
		})
	}
}

func TestGetPublicHubProviderOnlyReturnsActiveProvider(t *testing.T) {
	require.NoError(t, i18n.Init())
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 52)
	require.NoError(t, model.DB.Model(&model.HubProvider{Id: provider.Id}).Updates(map[string]any{
		"contact_type":  "email",
		"contact_value": "private@example.com",
		"support_type":  "community",
		"support_value": "https://example.com/community",
	}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/public/providers/"+provider.Slug, nil, 0)
	ctx.Params = gin.Params{{Key: "slug", Value: provider.Slug}}
	GetPublicHubProvider(ctx)
	assert.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool                            `json:"success"`
		Data    *model.HubProviderPublicProfile `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.NotNil(t, response.Data)
	assert.Equal(t, provider.Id, response.Data.Provider.Id)
	assert.Equal(t, provider.Slug, response.Data.Provider.Slug)
	assert.Equal(t, "https://example.com/community", response.Data.Provider.SupportValue)
	assert.NotContains(t, recorder.Body.String(), "contact_value")

	require.NoError(t, model.DB.Model(&model.HubProvider{Id: provider.Id}).Update("status", model.HubProviderStatusDisabled).Error)
	disabledCtx, disabledRecorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/public/providers/"+provider.Slug, nil, 0)
	disabledCtx.Params = gin.Params{{Key: "slug", Value: provider.Slug}}
	GetPublicHubProvider(disabledCtx)
	assert.Equal(t, http.StatusNotFound, disabledRecorder.Code)
}

func TestCreateHubProviderRequiresPrivateReviewContact(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}))

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider", map[string]string{
		"name": "Missing contact", "slug": "missing-contact",
	}, 42)
	CreateHubProvider(ctx)

	response := decodeHubProviderAPIResponse(t, recorder.Body.Bytes())
	assert.False(t, response.Success)
	var count int64
	require.NoError(t, db.Model(&model.HubProvider{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestAdminListHubProvidersFiltersOwnersAndReturnsSupplyMetrics(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}))
	require.NoError(t, model.DB.Create(&model.User{
		Id: 42, Username: "alice", DisplayName: "Alice", Email: "alice@example.com",
		Password: "not-used", Status: common.UserStatusEnabled, AffCode: "alice-code",
	}).Error)
	require.NoError(t, model.DB.Create(&model.User{
		Id: 43, Username: "bob", DisplayName: "Bob", Email: "bob@example.com",
		Password: "not-used", Status: common.UserStatusEnabled, AffCode: "bob-code",
	}).Error)
	provider := &model.HubProvider{
		OwnerUserId: 42, Name: "Acme AI", Website: "https://acme.example",
	}
	require.NoError(t, model.CreateHubProvider(provider))
	zeroFee := 0
	_, err := model.UpdateHubProviderPlatformFeeBasisPoints(provider.Id, &zeroFee)
	require.NoError(t, err)
	disabledProvider := &model.HubProvider{OwnerUserId: 43, Name: "Paused AI"}
	require.NoError(t, model.CreateHubProvider(disabledProvider))
	require.NoError(t, model.DB.Model(&model.HubProvider{Id: disabledProvider.Id}).Update("status", model.HubProviderStatusDisabled).Error)

	baseURL := "https://upstream.example"
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "Acme Plus",
		BaseURL: &baseURL, Models: "gpt-5,gpt-5-mini", Group: "default",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))
	require.NoError(t, model.DB.Model(&model.Channel{Id: channel.Id}).Update("status", common.ChannelStatusEnabled).Error)
	require.NoError(t, model.DB.Model(&model.HubSupplyGroup{Id: group.Id}).Updates(map[string]any{
		"available_model_count": 1,
		"error_model_count":     1,
		"last_probe_at":         int64(12345),
	}).Error)
	sharedBaseURL := "https://upstream.example/v1"
	sharedGroup := &model.HubSupplyGroup{
		ProviderId: disabledProvider.Id, PriceMultiplier: 1,
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	sharedChannel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "shared-secret", Name: "Paused shared upstream",
		BaseURL: &sharedBaseURL, Models: "gpt-5", Group: "default",
		Status: common.ChannelStatusManuallyDisabled,
	}
	require.NoError(t, model.CreateHubSupplyGroup(sharedGroup, sharedChannel))

	ctx, recorder := newAuthenticatedContext(
		t,
		http.MethodGet,
		"/api/hub/admin/providers?keyword=alice%40example.com&p=1&page_size=10",
		nil,
		1,
	)
	AdminListHubProviders(ctx)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.HubProviderAdminListItem `json:"items"`
			Total int                              `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, 1, response.Data.Total)
	require.Len(t, response.Data.Items, 1)
	item := response.Data.Items[0]
	assert.Equal(t, provider.Id, item.Id)
	assert.Equal(t, 42, item.OwnerID)
	assert.Equal(t, "alice", item.OwnerUsername)
	assert.Equal(t, int64(1), item.ChannelCount)
	assert.Equal(t, int64(1), item.OnlineChannelCount)
	assert.Equal(t, int64(1), item.AvailableModelCount)
	assert.Equal(t, int64(1), item.ErrorModelCount)
	assert.Equal(t, int64(12345), item.LastProbeAt)
	require.NotNil(t, item.PlatformFeeOverrideBasisPoints)
	assert.Zero(t, *item.PlatformFeeOverrideBasisPoints)
	assert.Zero(t, item.EffectivePlatformFeeBasisPoints)
	assert.Equal(t, model.HubProviderPlatformFeeBasisPoints, item.GlobalPlatformFeeBasisPoints)
	require.Len(t, item.UpstreamUsages, 1)
	assert.Equal(t, "https://upstream.example", item.UpstreamUsages[0].Origin)
	assert.Equal(t, int64(2), item.UpstreamUsages[0].ProviderCount)
	assert.Equal(t, int64(2), item.UpstreamUsages[0].ChannelCount)

	disabledCtx, disabledRecorder := newAuthenticatedContext(
		t,
		http.MethodGet,
		"/api/hub/admin/providers?status=disabled",
		nil,
		1,
	)
	AdminListHubProviders(disabledCtx)
	var disabledResponse struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.HubProviderAdminListItem `json:"items"`
			Total int                              `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(disabledRecorder.Body.Bytes(), &disabledResponse))
	require.True(t, disabledResponse.Success, disabledRecorder.Body.String())
	assert.Equal(t, 1, disabledResponse.Data.Total)
	require.Len(t, disabledResponse.Data.Items, 1)
	assert.Equal(t, disabledProvider.Id, disabledResponse.Data.Items[0].Id)
}

func TestAdminUpdateHubProviderStatusRemovesAndRestoresPublishedModels(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	baseURL := "https://upstream.example"
	group := &model.HubSupplyGroup{
		ProviderId: provider.Id, PriceMultiplier: 0.8, PublishedModels: "gpt-5",
		TextProbeMinutes: 10, ImageProbeMinutes: 30,
	}
	channel := &model.Channel{
		Type: constant.ChannelTypeOpenAI, Key: "secret", Name: "Published supply",
		BaseURL: &baseURL, Models: "gpt-5", Group: "default",
		Status: common.ChannelStatusAutoDisabled,
	}
	require.NoError(t, model.CreateHubSupplyGroup(group, channel))
	var target model.HubSupplyGroupProbeTarget
	require.NoError(t, model.DB.Where("group_id = ? AND model_name = ?", group.Id, "gpt-5").First(&target).Error)
	_, _, err := model.RecordHubSupplyProbeResult(target.Id, true, 500, "", "", "")
	require.NoError(t, err)
	require.NoError(t, model.ReconcileHubSupplyGroupRouteState(group.Id))

	assertHubProviderRouteState := func(expectedProviderStatus string, expectedChannelStatus int, expectedEnabledAbilities int64) {
		t.Helper()
		var storedProvider model.HubProvider
		require.NoError(t, model.DB.First(&storedProvider, provider.Id).Error)
		assert.Equal(t, expectedProviderStatus, storedProvider.Status)
		storedChannel, err := model.GetChannelById(channel.Id, true)
		require.NoError(t, err)
		assert.Equal(t, expectedChannelStatus, storedChannel.Status)
		var enabledAbilities int64
		require.NoError(t, model.DB.Model(&model.Ability{}).
			Where("channel_id = ? AND enabled = ?", channel.Id, true).
			Count(&enabledAbilities).Error)
		assert.Equal(t, expectedEnabledAbilities, enabledAbilities)
	}
	assertHubProviderRouteState(model.HubProviderStatusActive, common.ChannelStatusEnabled, 1)

	disableCtx, disableRecorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/1/status", map[string]string{
		"status": model.HubProviderStatusDisabled,
	}, 1)
	disableCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(provider.Id)}}
	AdminUpdateHubProviderStatus(disableCtx)
	var disableResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(disableRecorder.Body.Bytes(), &disableResponse))
	require.True(t, disableResponse.Success, disableRecorder.Body.String())
	assertHubProviderRouteState(model.HubProviderStatusDisabled, common.ChannelStatusAutoDisabled, 0)

	enableCtx, enableRecorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/1/status", map[string]string{
		"status": model.HubProviderStatusActive,
	}, 1)
	enableCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(provider.Id)}}
	AdminUpdateHubProviderStatus(enableCtx)
	var enableResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(enableRecorder.Body.Bytes(), &enableResponse))
	require.True(t, enableResponse.Success, enableRecorder.Body.String())
	assertHubProviderRouteState(model.HubProviderStatusActive, common.ChannelStatusEnabled, 1)
}

func TestAdminRejectHubProviderRequiresReason(t *testing.T) {
	require.NoError(t, i18n.Init())
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	require.NoError(t, model.DB.Model(&model.HubProvider{Id: provider.Id}).Update(
		"status", model.HubProviderStatusPending,
	).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/1/status", map[string]string{
		"status": model.HubProviderStatusRejected,
	}, 7)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(provider.Id)}}
	AdminUpdateHubProviderStatus(ctx)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	var stored model.HubProvider
	require.NoError(t, model.DB.First(&stored, provider.Id).Error)
	assert.Equal(t, model.HubProviderStatusPending, stored.Status)
	assert.Empty(t, stored.ReviewRemark)
}

func TestAdminRejectHubProviderLimitsReviewReasonLength(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	require.NoError(t, model.DB.Model(&model.HubProvider{Id: provider.Id}).Update(
		"status", model.HubProviderStatusPending,
	).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/1/status", map[string]string{
		"status":        model.HubProviderStatusRejected,
		"review_remark": strings.Repeat("x", hubProviderReviewRemarkMaxLength+1),
	}, 7)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(provider.Id)}}
	AdminUpdateHubProviderStatus(ctx)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	var stored model.HubProvider
	require.NoError(t, model.DB.First(&stored, provider.Id).Error)
	assert.Equal(t, model.HubProviderStatusPending, stored.Status)
}

func TestAdminApproveHubProviderRecordsReview(t *testing.T) {
	setupHubSupplyGroupControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	require.NoError(t, model.DB.Model(&model.HubProvider{Id: provider.Id}).Update(
		"status", model.HubProviderStatusPending,
	).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/1/status", map[string]string{
		"status":        model.HubProviderStatusActive,
		"review_remark": "Upstream information verified",
	}, 7)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(provider.Id)}}
	AdminUpdateHubProviderStatus(ctx)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	var stored model.HubProvider
	require.NoError(t, model.DB.First(&stored, provider.Id).Error)
	assert.Equal(t, model.HubProviderStatusActive, stored.Status)
	assert.Equal(t, "Upstream information verified", stored.ReviewRemark)
	assert.Equal(t, 7, stored.ReviewedByUserId)
	assert.Positive(t, stored.ReviewedAt)
}

func TestAdminUpdateHubProviderSettlementSettingsSupportsZeroAndGlobalFee(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.HubProvider{}, &model.Log{}))
	provider := &model.HubProvider{OwnerUserId: 42, Name: "Fee Provider", Slug: "fee-provider"}
	require.NoError(t, model.CreateHubProvider(provider))

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/1/settlement-settings", map[string]any{
		"platform_fee_basis_points": 0,
	}, 7)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(provider.Id)}}
	AdminUpdateHubProviderSettlementSettings(ctx)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			PlatformFeeBasisPoints          *int `json:"platform_fee_basis_points"`
			EffectivePlatformFeeBasisPoints int  `json:"effective_platform_fee_basis_points"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	require.NotNil(t, response.Data.PlatformFeeBasisPoints)
	assert.Zero(t, *response.Data.PlatformFeeBasisPoints)
	assert.Zero(t, response.Data.EffectivePlatformFeeBasisPoints)

	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/1/settlement-settings", map[string]any{
		"platform_fee_basis_points": nil,
	}, 7)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(provider.Id)}}
	AdminUpdateHubProviderSettlementSettings(ctx)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.Nil(t, response.Data.PlatformFeeBasisPoints)
	assert.Equal(t, model.HubProviderPlatformFeeBasisPoints, response.Data.EffectivePlatformFeeBasisPoints)
}
