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
*/
package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type hubProviderAdminCreateRequest struct {
	OwnerUserID        int    `json:"owner_user_id"`
	TenantID           *int   `json:"tenant_id"`
	Name               string `json:"name"`
	Slug               string `json:"slug"`
	Website            string `json:"website"`
	Description        string `json:"description"`
	ContactType        string `json:"contact_type"`
	ContactValue       string `json:"contact_value"`
	SupportType        string `json:"support_type"`
	SupportValue       string `json:"support_value"`
	UseProvisionalSlug *bool  `json:"use_provisional_slug"`
}

func (request *hubProviderAdminCreateRequest) profileRequest() hubProviderProfileRequest {
	return hubProviderProfileRequest{
		Name:         request.Name,
		Slug:         request.Slug,
		Website:      request.Website,
		Description:  request.Description,
		ContactType:  request.ContactType,
		ContactValue: request.ContactValue,
		SupportType:  request.SupportType,
		SupportValue: request.SupportValue,
	}
}

func adminCreateTenantID(c *gin.Context, requested *int) (*int, error) {
	if c.GetInt("role") >= common.RoleRootUser {
		if requested == nil || *requested <= 0 {
			return nil, errors.New("tenant_id is required for platform administrators")
		}
		if _, err := model.GetActiveTenantByID(*requested); err != nil {
			return nil, err
		}
		return requested, nil
	}

	current := hubProviderAdminTenantID(c)
	if current == nil {
		return nil, errors.New("a trusted tenant domain is required")
	}
	if requested != nil && (*requested <= 0 || *requested != *current) {
		return nil, errors.New("tenant_id does not match the current tenant")
	}
	if _, err := model.GetActiveTenantByID(*current); err != nil {
		return nil, err
	}
	return current, nil
}

func AdminListHubProviderOwnerCandidates(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	candidates, total, err := model.ListHubProviderOwnerCandidates(
		c.Query("keyword"),
		pageInfo.GetStartIdx(),
		pageInfo.GetPageSize(),
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(candidates)
	common.ApiSuccess(c, pageInfo)
}

func AdminCreateHubProvider(c *gin.Context) {
	var request hubProviderAdminCreateRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	tenantID, err := adminCreateTenantID(c, request.TenantID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	profile := request.profileRequest()
	if errorKey := validateHubProviderProfileRequest(&profile); errorKey != "" {
		common.ApiErrorI18n(c, errorKey)
		return
	}
	if request.OwnerUserID <= 0 {
		common.ApiError(c, errors.New("owner_user_id is required"))
		return
	}
	owner, err := model.GetUserById(request.OwnerUserID, false)
	if err != nil || owner.Status != common.UserStatusEnabled {
		common.ApiError(c, errors.New("owner user must be an enabled user"))
		return
	}
	useProvisionalSlug := true
	if request.UseProvisionalSlug != nil {
		useProvisionalSlug = *request.UseProvisionalSlug
	}
	provider := &model.HubProvider{
		OwnerUserId:        request.OwnerUserID,
		TenantId:           tenantID,
		Name:               profile.Name,
		Slug:               profile.Slug,
		Website:            profile.Website,
		Description:        profile.Description,
		ContactType:        profile.ContactType,
		ContactValue:       profile.ContactValue,
		SupportType:        profile.SupportType,
		SupportValue:       profile.SupportValue,
		Status:             model.HubProviderStatusActive,
		UseProvisionalSlug: useProvisionalSlug,
	}
	if err := model.CreateHubProvider(provider); err != nil {
		switch {
		case errors.Is(err, model.ErrHubProviderAlreadyExists):
			common.ApiErrorI18n(c, i18n.MsgHubProviderAlreadyExists)
		case errors.Is(err, model.ErrHubProviderSlugAlreadyExists):
			common.ApiErrorI18n(c, i18n.MsgHubProviderSlugAlreadyExists)
		default:
			common.ApiError(c, err)
		}
		return
	}

	model.HydrateHubProviderVerificationFields(provider)
	model.HydrateHubProviderLogoURL(provider, "/api/hub/admin/providers/"+strconv.Itoa(provider.Id)+"/logo")
	common.ApiSuccess(c, provider)
}
