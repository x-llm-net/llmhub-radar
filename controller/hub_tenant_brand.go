/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

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
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type tenantBrandRequest struct {
	Name    string `json:"name"`
	LogoURL string `json:"logo_url"`
}

type tenantBrandResponse struct {
	IsTenantHost bool                    `json:"is_tenant_host"`
	Brand        model.TenantBrandConfig `json:"brand"`
}

func normalizeTenantBrand(request tenantBrandRequest) (model.TenantBrandConfig, error) {
	brand := model.TenantBrandConfig{
		Name:    strings.TrimSpace(request.Name),
		LogoURL: strings.TrimSpace(request.LogoURL),
	}
	if len([]rune(brand.Name)) > 120 {
		return brand, errors.New("brand name must be at most 120 characters")
	}
	if len(brand.LogoURL) > 1024 || !isHubProviderHTTPURL(brand.LogoURL) {
		return brand, errors.New("brand logo must be an HTTP or HTTPS URL")
	}
	return brand, nil
}

func tenantBrandData(tenant *model.Tenant) tenantBrandResponse {
	if tenant == nil {
		return tenantBrandResponse{Brand: model.TenantBrandConfig{}}
	}
	return tenantBrandResponse{IsTenantHost: true, Brand: tenant.Brand()}
}

func updateTenantBrand(c *gin.Context, tenant *model.Tenant) {
	var request tenantBrandRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, errors.New("invalid tenant brand payload"))
		return
	}
	brand, err := normalizeTenantBrand(request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	encoded, err := model.EncodeTenantBrandConfig(brand)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	tenant.BrandConfig = encoded
	tenant.UpdatedAt = time.Now().Unix()
	if err := model.DB.Model(tenant).Updates(map[string]any{
		"brand_config": tenant.BrandConfig,
		"updated_at":   tenant.UpdatedAt,
	}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tenantBrandData(tenant))
}

func GetPublicHubTenantBrand(c *gin.Context) {
	resolution, err := model.ResolveTenantHost(c.Request.Host)
	if errors.Is(err, model.ErrTenantHostInvalid) || (err == nil && !resolution.IsTenantHost) {
		common.ApiSuccess(c, tenantBrandData(nil))
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	tenant, err := model.GetActiveTenantByID(resolution.TenantID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tenantBrandData(tenant))
}

func GetCurrentHubTenantBrand(c *gin.Context) {
	tenantID := common.GetContextKeyInt(c, constant.ContextKeyTenantId)
	tenant, err := model.GetActiveTenantByID(tenantID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tenantBrandData(tenant))
}

func UpdateCurrentHubTenantBrand(c *gin.Context) {
	tenantID := common.GetContextKeyInt(c, constant.ContextKeyTenantId)
	tenant, err := model.GetActiveTenantByID(tenantID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	updateTenantBrand(c, tenant)
}

func AdminUpdateHubTenantBrand(c *gin.Context) {
	tenant, err := adminTenantByID(parseIDParam(c, "id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	updateTenantBrand(c, tenant)
}
