/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var ErrHubProviderLogoInvalid = errors.New("invalid hub provider logo")

type HubProviderLogoAsset struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	ProviderId  int    `json:"provider_id" gorm:"not null;index"`
	ContentType string `json:"content_type" gorm:"type:varchar(64);not null"`
	Data        []byte `json:"-" gorm:"not null"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint;not null"`
}

func (HubProviderLogoAsset) TableName() string {
	return "hub_provider_logo_assets"
}

func (asset *HubProviderLogoAsset) BeforeCreate(tx *gorm.DB) error {
	asset.CreatedAt = common.GetTimestamp()
	return nil
}

func createHubProviderLogoAssetTx(tx *gorm.DB, providerID int, contentType string, data []byte) (*HubProviderLogoAsset, error) {
	contentType = strings.TrimSpace(contentType)
	if providerID <= 0 || contentType == "" || len(data) == 0 {
		return nil, ErrHubProviderLogoInvalid
	}
	asset := &HubProviderLogoAsset{
		ProviderId:  providerID,
		ContentType: contentType,
		Data:        data,
	}
	if err := tx.Create(asset).Error; err != nil {
		return nil, err
	}
	return asset, nil
}

func GetHubProviderLogoAsset(providerID int) (*HubProviderLogoAsset, error) {
	if providerID <= 0 {
		return nil, ErrHubProviderLogoInvalid
	}
	var asset HubProviderLogoAsset
	if err := DB.Where("provider_id = ?", providerID).Order("id DESC").First(&asset).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func HydrateHubProviderLogoURL(provider *HubProvider, path string) {
	if provider == nil || provider.LogoAssetId <= 0 {
		return
	}
	provider.LogoURL = path
}
