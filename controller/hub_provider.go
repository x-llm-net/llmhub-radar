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
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const (
	hubProviderNameMaxLength        = 80
	hubProviderDescriptionMaxLength = 1000
)

type hubProviderProfileRequest struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Website     string `json:"website"`
	Description string `json:"description"`
	LogoURL     string `json:"logo_url"`
}

type hubProviderCreateRequest = hubProviderProfileRequest

type hubProviderStatusUpdateRequest struct {
	Status string `json:"status"`
}

func GetHubProviderSelf(c *gin.Context) {
	provider, err := model.GetHubProviderByOwnerUserID(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
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
	var req hubProviderProfileRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	if errorKey := validateHubProviderProfileRequest(&req); errorKey != "" {
		common.ApiErrorI18n(c, errorKey)
		return
	}

	provider := &model.HubProvider{
		OwnerUserId: c.GetInt("id"),
		Name:        req.Name,
		Slug:        req.Slug,
		Website:     req.Website,
		Description: req.Description,
		LogoURL:     req.LogoURL,
	}
	if err := model.CreateHubProvider(provider); err != nil {
		if err == model.ErrHubProviderAlreadyExists {
			common.ApiErrorI18n(c, i18n.MsgHubProviderAlreadyExists)
			return
		}
		if err == model.ErrHubProviderSlugAlreadyExists {
			common.ApiErrorI18n(c, i18n.MsgHubProviderSlugAlreadyExists)
			return
		}
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, provider)
}

func UpdateHubProviderProfile(c *gin.Context) {
	var req hubProviderProfileRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if errorKey := validateHubProviderProfileRequest(&req); errorKey != "" {
		common.ApiErrorI18n(c, errorKey)
		return
	}

	provider, err := model.UpdateHubProviderProfile(
		c.GetInt("id"), req.Slug, req.Name, req.Website, req.Description, req.LogoURL,
	)
	if err != nil {
		if err == model.ErrHubProviderNotFound {
			common.ApiErrorI18n(c, i18n.MsgHubProviderRequired)
			return
		}
		if err == model.ErrHubProviderSlugAlreadyExists {
			common.ApiErrorI18n(c, i18n.MsgHubProviderSlugAlreadyExists)
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, provider)
}

func validateHubProviderProfileRequest(req *hubProviderProfileRequest) string {
	req.Name = strings.TrimSpace(req.Name)
	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
	req.Website = strings.TrimSpace(req.Website)
	req.Description = strings.TrimSpace(req.Description)
	req.LogoURL = strings.TrimSpace(req.LogoURL)
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
	default:
		return ""
	}
}

func AdminListHubProviders(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	providers, total, err := model.ListHubProviders(
		c.Query("keyword"),
		c.Query("status"),
		pageInfo.GetStartIdx(),
		pageInfo.GetPageSize(),
	)
	if err != nil {
		common.ApiError(c, err)
		return
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
	var req hubProviderStatusUpdateRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.Status = strings.TrimSpace(req.Status)
	if !model.IsValidHubProviderStatus(req.Status) {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	groupIDs, err := model.UpdateHubProviderStatus(providerID, req.Status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for _, groupID := range groupIDs {
		if err := model.ReconcileHubSupplyGroupRouteState(groupID); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	common.ApiSuccess(c, gin.H{"id": providerID, "status": req.Status})
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
