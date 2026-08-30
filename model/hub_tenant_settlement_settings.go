/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_provider_settlement_setting"
	"gorm.io/gorm"
)

// ResolveHubTenantPlatformFeeBasisPoints returns the tenant-specific platform
// fee when configured, otherwise the global default.
func ResolveHubTenantPlatformFeeBasisPoints(tenantID int) (int, error) {
	return resolveHubTenantPlatformFeeBasisPoints(DB, tenantID)
}

func resolveHubTenantPlatformFeeBasisPoints(db *gorm.DB, tenantID int) (int, error) {
	globalFee := hub_provider_settlement_setting.PlatformFeeBasisPoints()
	if tenantID <= 0 || db == nil {
		return globalFee, nil
	}

	var tenant Tenant
	err := db.Select("id", "platform_fee_basis_points").First(&tenant, tenantID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return globalFee, nil
	}
	if err != nil {
		return 0, err
	}
	if tenant.PlatformFeeBasisPoints == nil {
		return globalFee, nil
	}
	override := *tenant.PlatformFeeBasisPoints
	if override < 0 || override > 10000 {
		return globalFee, nil
	}
	return override, nil
}

// UpdateHubTenantPlatformFeeBasisPoints stores a nullable tenant override.
// A nil value makes the tenant follow the global platform fee again.
func UpdateHubTenantPlatformFeeBasisPoints(tenantID int, override *int) (*Tenant, error) {
	if tenantID <= 0 || (override != nil && (*override < 0 || *override > 10000)) {
		return nil, errors.New("invalid tenant platform fee")
	}
	result := DB.Model(&Tenant{}).Where("id = ?", tenantID).Updates(map[string]any{
		"platform_fee_basis_points": override,
		"updated_at":                common.GetTimestamp(),
	})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, ErrTenantNotFound
	}
	var tenant Tenant
	if err := DB.First(&tenant, tenantID).Error; err != nil {
		return nil, err
	}
	return &tenant, nil
}
