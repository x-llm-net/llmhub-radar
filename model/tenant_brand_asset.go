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
package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var ErrTenantBrandAssetInvalid = errors.New("invalid tenant brand asset")

type TenantBrandAsset struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	TenantId    int    `json:"tenant_id" gorm:"not null;index"`
	ContentType string `json:"content_type" gorm:"type:varchar(64);not null"`
	Data        []byte `json:"-" gorm:"not null"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint;not null"`
}

func (TenantBrandAsset) TableName() string {
	return "tenant_brand_assets"
}

func (asset *TenantBrandAsset) BeforeCreate(tx *gorm.DB) error {
	asset.CreatedAt = common.GetTimestamp()
	return nil
}

func CreateTenantBrandAssetTx(tx *gorm.DB, tenantID int, contentType string, data []byte) (*TenantBrandAsset, error) {
	contentType = strings.TrimSpace(contentType)
	if tx == nil || tenantID <= 0 || contentType == "" || len(data) == 0 {
		return nil, ErrTenantBrandAssetInvalid
	}
	asset := &TenantBrandAsset{
		TenantId:    tenantID,
		ContentType: contentType,
		Data:        data,
	}
	if err := tx.Create(asset).Error; err != nil {
		return nil, err
	}
	return asset, nil
}

func GetActiveTenantBrandAsset(assetID int) (*TenantBrandAsset, error) {
	if assetID <= 0 {
		return nil, ErrTenantBrandAssetInvalid
	}
	var asset TenantBrandAsset
	err := DB.Joins("JOIN tenants ON tenants.id = tenant_brand_assets.tenant_id").
		Where("tenant_brand_assets.id = ? AND tenants.status = ?", assetID, TenantStatusActive).
		First(&asset).Error
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func GetActiveTenantBrandAssetInTenant(assetID, tenantID int) (*TenantBrandAsset, error) {
	if assetID <= 0 || tenantID <= 0 {
		return nil, ErrTenantBrandAssetInvalid
	}
	var asset TenantBrandAsset
	err := DB.Joins("JOIN tenants ON tenants.id = tenant_brand_assets.tenant_id").
		Where("tenant_brand_assets.id = ? AND tenant_brand_assets.tenant_id = ? AND tenants.status = ?", assetID, tenantID, TenantStatusActive).
		First(&asset).Error
	if err != nil {
		return nil, err
	}
	return &asset, nil
}
