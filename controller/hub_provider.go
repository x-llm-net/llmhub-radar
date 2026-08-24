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
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	hubProviderNameMaxLength         = 80
	hubProviderDescriptionMaxLength  = 1000
	hubProviderReviewRemarkMaxLength = 1000
	hubProviderContactMaxLength      = 256
	hubProviderSupportMaxLength      = 512
)

type hubProviderProfileRequest struct {
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	Website      string `json:"website"`
	Description  string `json:"description"`
	LogoURL      string `json:"logo_url"`
	ContactType  string `json:"contact_type"`
	ContactValue string `json:"contact_value"`
	SupportType  string `json:"support_type"`
	SupportValue string `json:"support_value"`
}

type hubProviderCreateRequest = hubProviderProfileRequest

type hubProviderProfileAssets struct {
	VerifyWebsite       bool
	EvidenceContentType string
	Evidence            []byte
	LogoContentType     string
	Logo                []byte
}

type hubProviderStatusUpdateRequest struct {
	Status         string `json:"status"`
	ReviewRemark   string `json:"review_remark"`
	ApproveWebsite bool   `json:"approve_website"`
}

type hubProviderSettlementSettingsUpdateRequest struct {
	ProviderServiceFeeBasisPoints *int `json:"provider_service_fee_basis_points"`
	PlatformFeeBasisPoints        *int `json:"platform_fee_basis_points"` // legacy alias
}

func decodeHubProviderProfileRequest(c *gin.Context) (hubProviderProfileRequest, hubProviderProfileAssets, error) {
	var req hubProviderProfileRequest
	var assets hubProviderProfileAssets
	if !strings.HasPrefix(strings.ToLower(c.GetHeader("Content-Type")), "multipart/form-data") {
		return req, assets, common.DecodeJson(c.Request.Body, &req)
	}
	if c.Request.ContentLength > hubProviderWebsiteEvidenceMaxBytes+hubProviderLogoMaxBytes+256*1024 {
		return req, assets, model.ErrHubProviderWebsiteEvidenceInvalid
	}
	if err := common.Unmarshal([]byte(c.PostForm("profile")), &req); err != nil {
		return req, assets, err
	}
	assets.VerifyWebsite = strings.EqualFold(strings.TrimSpace(c.PostForm("verify_website")), "true")
	if assets.VerifyWebsite {
		contentType, evidence, err := readHubProviderWebsiteEvidence(c)
		if err != nil {
			return req, assets, err
		}
		assets.EvidenceContentType = contentType
		assets.Evidence = evidence
	}
	if form, err := c.MultipartForm(); err == nil && form != nil {
		if _, ok := form.File["logo"]; ok {
			contentType, logo, err := readHubProviderLogo(c)
			if err != nil {
				return req, assets, err
			}
			assets.LogoContentType = contentType
			assets.Logo = logo
		}
	}
	return req, assets, nil
}

func GetHubProviderSelf(c *gin.Context) {
	provider, err := model.GetHubProviderByOwnerUserID(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.HydrateHubProviderVerificationFields(provider)
	model.HydrateHubProviderLogoURL(provider, "/api/hub/provider/logo")
	common.ApiSuccess(c, provider)
}

func GetPublicHubProvider(c *gin.Context) {
	providerSlug, err := model.NormalizeHubProviderSlug(c.Param("slug"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": i18n.T(c, i18n.MsgNotFound)})
		return
	}
	profile, err := model.GetHubProviderPublicProfile(providerSlug, common.GetTimestamp())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if profile == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": i18n.T(c, i18n.MsgNotFound)})
		return
	}
	common.ApiSuccess(c, profile)
}

func GetPublicHubHome(c *gin.Context) {
	home, err := model.GetHubPublicHome(common.GetTimestamp())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, home)
}

func CreateHubProvider(c *gin.Context) {
	req, assets, err := decodeHubProviderProfileRequest(c)
	if err != nil {
		if errors.Is(err, model.ErrHubProviderLogoInvalid) {
			hubProviderLogoError(c, err)
			return
		}
		if errors.Is(err, model.ErrHubProviderWebsiteEvidenceInvalid) {
			common.ApiErrorI18n(c, i18n.MsgHubProviderWebsiteEvidenceInvalid)
			return
		}
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	if errorKey := validateHubProviderProfileRequest(&req); errorKey != "" {
		common.ApiErrorI18n(c, errorKey)
		return
	}
	tenantID := common.GetContextKeyInt(c, constant.ContextKeyTenantId)
	if tenantID <= 0 {
		common.ApiError(c, errors.New("a trusted tenant domain is required"))
		return
	}

	provider := &model.HubProvider{
		OwnerUserId:        c.GetInt("id"),
		TenantId:           &tenantID,
		Name:               req.Name,
		Slug:               req.Slug,
		Website:            req.Website,
		Description:        req.Description,
		LogoURL:            req.LogoURL,
		ContactType:        req.ContactType,
		ContactValue:       req.ContactValue,
		SupportType:        req.SupportType,
		SupportValue:       req.SupportValue,
		Status:             model.HubProviderStatusPending,
		UseProvisionalSlug: true,
	}
	if assets.VerifyWebsite || len(assets.Logo) > 0 {
		err = model.CreateHubProviderWithAssets(
			provider,
			assets.LogoContentType, assets.Logo,
			assets.EvidenceContentType, assets.Evidence,
		)
	} else {
		err = model.CreateHubProvider(provider)
	}
	if err != nil {
		if err == model.ErrHubProviderAlreadyExists {
			common.ApiErrorI18n(c, i18n.MsgHubProviderAlreadyExists)
			return
		}
		if err == model.ErrHubProviderSlugAlreadyExists {
			common.ApiErrorI18n(c, i18n.MsgHubProviderSlugAlreadyExists)
			return
		}
		if errors.Is(err, model.ErrHubProviderWebsiteRequired) ||
			errors.Is(err, model.ErrHubProviderWebsiteEvidenceInvalid) {
			hubProviderWebsiteVerificationError(c, err)
			return
		}
		if errors.Is(err, model.ErrHubProviderLogoInvalid) {
			hubProviderLogoError(c, err)
			return
		}
		common.ApiError(c, err)
		return
	}

	model.HydrateHubProviderVerificationFields(provider)
	model.HydrateHubProviderLogoURL(provider, "/api/hub/provider/logo")
	service.NotifyHubProviderApplication(provider)
	common.ApiSuccess(c, provider)
}

func UpdateHubProviderProfile(c *gin.Context) {
	req, assets, err := decodeHubProviderProfileRequest(c)
	if err != nil {
		if errors.Is(err, model.ErrHubProviderLogoInvalid) {
			hubProviderLogoError(c, err)
			return
		}
		if errors.Is(err, model.ErrHubProviderWebsiteEvidenceInvalid) {
			common.ApiErrorI18n(c, i18n.MsgHubProviderWebsiteEvidenceInvalid)
			return
		}
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if errorKey := validateHubProviderProfileRequest(&req); errorKey != "" {
		common.ApiErrorI18n(c, errorKey)
		return
	}

	var provider *model.HubProvider
	if assets.VerifyWebsite || len(assets.Logo) > 0 {
		provider, err = model.UpdateHubProviderProfileWithAssets(
			c.GetInt("id"), req.Name, req.Website, req.Description, req.LogoURL,
			req.ContactType, req.ContactValue, req.SupportType, req.SupportValue,
			assets.LogoContentType, assets.Logo,
			assets.EvidenceContentType, assets.Evidence,
		)
	} else {
		provider, err = model.UpdateHubProviderProfile(
			c.GetInt("id"), req.Name, req.Website, req.Description, req.LogoURL,
			req.ContactType, req.ContactValue, req.SupportType, req.SupportValue,
		)
	}
	if err != nil {
		if err == model.ErrHubProviderNotFound {
			common.ApiErrorI18n(c, i18n.MsgHubProviderRequired)
			return
		}
		if err == model.ErrHubProviderSlugAlreadyExists {
			common.ApiErrorI18n(c, i18n.MsgHubProviderSlugAlreadyExists)
			return
		}
		if errors.Is(err, model.ErrHubProviderWebsiteRequired) ||
			errors.Is(err, model.ErrHubProviderWebsiteEvidenceInvalid) {
			hubProviderWebsiteVerificationError(c, err)
			return
		}
		if errors.Is(err, model.ErrHubProviderLogoInvalid) {
			hubProviderLogoError(c, err)
			return
		}
		common.ApiError(c, err)
		return
	}
	model.HydrateHubProviderVerificationFields(provider)
	model.HydrateHubProviderLogoURL(provider, "/api/hub/provider/logo")
	common.ApiSuccess(c, provider)
}

func validateHubProviderProfileRequest(req *hubProviderProfileRequest) string {
	req.Name = strings.TrimSpace(req.Name)
	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
	req.Website = strings.TrimSpace(req.Website)
	req.Description = strings.TrimSpace(req.Description)
	req.LogoURL = strings.TrimSpace(req.LogoURL)
	if strings.HasPrefix(req.LogoURL, "/api/hub/") {
		req.LogoURL = ""
	}
	req.ContactType = strings.ToLower(strings.TrimSpace(req.ContactType))
	req.ContactValue = strings.TrimSpace(req.ContactValue)
	req.SupportType = strings.ToLower(strings.TrimSpace(req.SupportType))
	req.SupportValue = strings.TrimSpace(req.SupportValue)
	if req.SupportValue == "" {
		req.SupportType = ""
	}
	normalizedSlug, slugErr := model.NormalizeHubProviderSlug(req.Slug)
	if slugErr == nil {
		req.Slug = normalizedSlug
	}

	switch {
	case req.Name == "":
		return i18n.MsgHubProviderNameEmpty
	case slugErr != nil:
		return i18n.MsgHubProviderSlugInvalid
	case utf8.RuneCountInString(req.Name) > hubProviderNameMaxLength:
		return i18n.MsgHubProviderNameTooLong
	case !isHubProviderHTTPURL(req.Website):
		return i18n.MsgHubProviderWebsiteInvalid
	case !isHubProviderHTTPURL(req.LogoURL):
		return i18n.MsgHubProviderLogoURLInvalid
	case utf8.RuneCountInString(req.Description) > hubProviderDescriptionMaxLength:
		return i18n.MsgHubProviderDescriptionLong
	case !isHubProviderContactType(req.ContactType) || req.ContactValue == "" || utf8.RuneCountInString(req.ContactValue) > hubProviderContactMaxLength:
		return i18n.MsgHubProviderContactInvalid
	case req.SupportValue != "" && (!isHubProviderSupportType(req.SupportType) || utf8.RuneCountInString(req.SupportValue) > hubProviderSupportMaxLength):
		return i18n.MsgHubProviderSupportInvalid
	default:
		return ""
	}
}

func isHubProviderContactType(value string) bool {
	switch value {
	case "qq", "wechat", "telegram", "email", "phone", "other":
		return true
	default:
		return false
	}
}

func isHubProviderSupportType(value string) bool {
	switch value {
	case "community", "qq_group", "telegram_group", "customer_service", "announcement", "email", "other":
		return true
	default:
		return false
	}
}

func AdminListHubProviders(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	var providers []model.HubProviderAdminListItem
	var total int64
	var err error
	if isPlatformAdmin(c) {
		tenantFilter := strings.TrimSpace(c.Query("tenant_id"))
		switch tenantFilter {
		case "", "all":
			providers, total, err = model.ListHubProvidersForOverview(
				c.Query("keyword"), c.Query("status"),
				pageInfo.GetStartIdx(), pageInfo.GetPageSize(), nil, false,
			)
		case "platform":
			providers, total, err = model.ListHubProvidersForOverview(
				c.Query("keyword"), c.Query("status"),
				pageInfo.GetStartIdx(), pageInfo.GetPageSize(), nil, true,
			)
		default:
			parsedTenantID, parseErr := strconv.Atoi(tenantFilter)
			if parseErr != nil || parsedTenantID <= 0 {
				common.ApiErrorI18n(c, i18n.MsgInvalidParams)
				return
			}
			providers, total, err = model.ListHubProvidersForOverview(
				c.Query("keyword"), c.Query("status"),
				pageInfo.GetStartIdx(), pageInfo.GetPageSize(), &parsedTenantID, false,
			)
		}
	} else if tenantID := hubProviderAdminTenantID(c); tenantID != nil {
		providers, total, err = model.ListHubProvidersInTenant(
			c.Query("keyword"), c.Query("status"),
			pageInfo.GetStartIdx(), pageInfo.GetPageSize(), *tenantID,
		)
	} else {
		providers, total, err = model.ListHubProviders(
			c.Query("keyword"), c.Query("status"),
			pageInfo.GetStartIdx(), pageInfo.GetPageSize(),
		)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range providers {
		if providers[i].LogoAssetId > 0 {
			providers[i].LogoURL = "/api/hub/admin/providers/" + strconv.Itoa(providers[i].Id) + "/logo"
		}
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(providers)
	common.ApiSuccess(c, pageInfo)
}

// AdminListHubProviderOverview is intentionally separate from the tenant
// scoped provider page. It is a read-only, platform-wide view for root users.
func AdminListHubProviderOverview(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	var tenantID *int
	platformOnly := false
	tenantFilter := strings.TrimSpace(c.Query("tenant_id"))
	if tenantFilter != "" && tenantFilter != "all" {
		if tenantFilter == "platform" {
			platformOnly = true
		} else {
			parsedTenantID, err := strconv.Atoi(tenantFilter)
			if err != nil || parsedTenantID <= 0 {
				common.ApiErrorI18n(c, i18n.MsgInvalidParams)
				return
			}
			tenantID = &parsedTenantID
		}
	}
	providers, total, err := model.ListHubProvidersForOverview(
		c.Query("keyword"), c.Query("status"),
		pageInfo.GetStartIdx(), pageInfo.GetPageSize(), tenantID, platformOnly,
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range providers {
		if providers[i].LogoAssetId > 0 {
			providers[i].LogoURL = "/api/hub/admin/provider-overview/" + strconv.Itoa(providers[i].Id) + "/logo"
		}
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(providers)
	common.ApiSuccess(c, pageInfo)
}

func AdminUpdateHubProviderStatus(c *gin.Context) {
	providerID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if !requireHubProviderAdminScope(c, providerID) {
		return
	}
	var req hubProviderStatusUpdateRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.Status = strings.TrimSpace(req.Status)
	req.ReviewRemark = strings.TrimSpace(req.ReviewRemark)
	if !model.IsValidHubProviderStatus(req.Status) {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if req.Status == model.HubProviderStatusRejected && req.ReviewRemark == "" {
		common.ApiErrorI18n(c, i18n.MsgHubProviderReviewRemarkRequired)
		return
	}
	if utf8.RuneCountInString(req.ReviewRemark) > hubProviderReviewRemarkMaxLength {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	groupIDs, err := model.UpdateHubProviderStatusWithReviewAndWebsite(
		providerID,
		req.Status,
		c.GetInt("id"),
		req.ReviewRemark,
		req.ApproveWebsite,
	)
	if err != nil {
		if errors.Is(err, model.ErrHubProviderSlugAlreadyExists) {
			common.ApiErrorI18n(c, i18n.MsgHubProviderSlugAlreadyExists)
			return
		}
		if errors.Is(err, model.ErrHubProviderWebsiteVerificationInvalid) {
			common.ApiErrorI18n(c, i18n.MsgHubProviderWebsiteVerificationInvalid)
			return
		}
		common.ApiError(c, err)
		return
	}
	for _, groupID := range groupIDs {
		if err := model.ReconcileHubSupplyGroupRouteState(groupID); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	service.NotifyHubProviderReview(providerID, req.Status, req.ReviewRemark)
	common.ApiSuccess(c, gin.H{"id": providerID, "status": req.Status})
}

func AdminUpdateHubProviderSettlementSettings(c *gin.Context) {
	providerID, err := strconv.Atoi(c.Param("id"))
	if err != nil || providerID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if !requireHubProviderAdminScope(c, providerID) {
		return
	}
	var req hubProviderSettlementSettingsUpdateRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	override := req.ProviderServiceFeeBasisPoints
	if override == nil {
		override = req.PlatformFeeBasisPoints
	}
	if override != nil && (*override < 0 || *override > 10000) {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	provider, err := model.UpdateHubProviderServiceFeeBasisPoints(providerID, override)
	if err != nil {
		if errors.Is(err, model.ErrHubProviderNotFound) {
			common.ApiErrorI18n(c, i18n.MsgNotFound)
			return
		}
		common.ApiError(c, err)
		return
	}
	effectiveFee, err := model.ResolveHubProviderServiceFeeBasisPoints(providerID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "hub_provider.settlement_settings_update", map[string]interface{}{
		"provider_id": providerID,
	})
	common.ApiSuccess(c, gin.H{
		"id":                                provider.Id,
		"provider_service_fee_basis_points": provider.PlatformFeeBasisPoints,
		"effective_provider_service_fee_basis_points": effectiveFee,
		// Deprecated response aliases for older admin clients.
		"platform_fee_basis_points":           provider.PlatformFeeBasisPoints,
		"effective_platform_fee_basis_points": effectiveFee,
	})
}

func isHubProviderHTTPURL(value string) bool {
	if value == "" {
		return true
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return false
	}
	return parsed.Scheme == "http" || parsed.Scheme == "https"
}
