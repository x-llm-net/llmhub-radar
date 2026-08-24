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
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const tenantBrandAssetPathPrefix = "/api/hub/public/brand-assets/"

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
	if len(brand.LogoURL) > 1024 || !isTenantBrandLogoURL(brand.LogoURL) {
		return brand, errors.New("brand logo must be an HTTP or HTTPS URL")
	}
	return brand, nil
}

func tenantBrandAssetPath(assetID int) string {
	return tenantBrandAssetPathPrefix + strconv.Itoa(assetID)
}

func tenantBrandAssetID(logoURL string) int {
	if !strings.HasPrefix(logoURL, tenantBrandAssetPathPrefix) {
		return 0
	}
	assetID, err := strconv.Atoi(strings.TrimPrefix(logoURL, tenantBrandAssetPathPrefix))
	if err != nil || assetID <= 0 {
		return 0
	}
	return assetID
}

func isTenantBrandLogoURL(logoURL string) bool {
	if tenantBrandAssetID(logoURL) > 0 {
		return true
	}
	return isHubProviderHTTPURL(logoURL)
}

func tenantBrandData(tenant *model.Tenant) tenantBrandResponse {
	if tenant == nil {
		return tenantBrandResponse{Brand: model.TenantBrandConfig{}}
	}
	return tenantBrandResponse{IsTenantHost: true, Brand: tenant.Brand()}
}

func decodeTenantBrandRequest(c *gin.Context) (tenantBrandRequest, string, []byte, error) {
	var request tenantBrandRequest
	if !strings.HasPrefix(strings.ToLower(c.GetHeader("Content-Type")), "multipart/form-data") {
		return request, "", nil, common.DecodeJson(c.Request.Body, &request)
	}
	if c.Request.ContentLength > hubProviderLogoMaxBytes+64*1024 {
		return request, "", nil, model.ErrHubProviderLogoInvalid
	}
	if err := common.Unmarshal([]byte(c.PostForm("brand")), &request); err != nil {
		return request, "", nil, err
	}
	contentType, data, err := readHubProviderLogo(c)
	return request, contentType, data, err
}

func updateTenantBrand(c *gin.Context, tenant *model.Tenant) {
	request, logoContentType, logoData, err := decodeTenantBrandRequest(c)
	if errors.Is(err, model.ErrHubProviderLogoInvalid) {
		hubProviderLogoError(c, err)
		return
	}
	if err != nil {
		common.ApiError(c, errors.New("invalid tenant brand payload"))
		return
	}
	if len(logoData) > 0 {
		request.LogoURL = ""
	}
	brand, err := normalizeTenantBrand(request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	previousAssetID := tenantBrandAssetID(tenant.Brand().LogoURL)
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if len(logoData) > 0 {
			asset, createErr := model.CreateTenantBrandAssetTx(tx, tenant.Id, logoContentType, logoData)
			if createErr != nil {
				return createErr
			}
			brand.LogoURL = tenantBrandAssetPath(asset.Id)
		}
		encoded, encodeErr := model.EncodeTenantBrandConfig(brand)
		if encodeErr != nil {
			return encodeErr
		}
		tenant.BrandConfig = encoded
		tenant.UpdatedAt = time.Now().Unix()
		if updateErr := tx.Model(tenant).Updates(map[string]any{
			"brand_config": tenant.BrandConfig,
			"updated_at":   tenant.UpdatedAt,
		}).Error; updateErr != nil {
			return updateErr
		}
		newAssetID := tenantBrandAssetID(brand.LogoURL)
		if previousAssetID > 0 && previousAssetID != newAssetID {
			return tx.Where("id = ? AND tenant_id = ?", previousAssetID, tenant.Id).
				Delete(&model.TenantBrandAsset{}).Error
		}
		return nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tenantBrandData(tenant))
}

func GetPublicHubTenantBrandAsset(c *gin.Context) {
	assetID, err := strconv.Atoi(c.Param("asset_id"))
	if err != nil || assetID <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	asset, err := model.GetActiveTenantBrandAsset(assetID)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "public, max-age=300")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, asset.ContentType, asset.Data)
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
