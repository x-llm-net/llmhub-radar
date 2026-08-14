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
	"net/http"
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
	assert.Equal(t, "acme-ai", response.Data.Slug)
	assert.Equal(t, "owner@acme.example", response.Data.ContactValue)
	assert.Equal(t, "https://acme.example/community", response.Data.SupportValue)
	assert.Equal(t, model.HubProviderStatusPending, response.Data.Status)

	stored, err := model.GetHubProviderByOwnerUserID(42)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, response.Data.Id, stored.Id)
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
