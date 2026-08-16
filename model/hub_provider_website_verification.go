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
	"github.com/QuantumNous/new-api/setting/hub_provider_setting"
	"gorm.io/gorm"
)

const (
	HubProviderWebsiteVerificationStatusUnverified = "unverified"
	HubProviderWebsiteVerificationStatusPending    = "pending"
	HubProviderWebsiteVerificationStatusVerified   = "verified"
	HubProviderWebsiteVerificationStatusRejected   = "rejected"

	HubProviderWebsiteVerificationMethodManual = "manual"
	HubProviderWebsiteVerificationMethodDNS    = "dns"
	HubProviderWebsiteVerificationMethodHTTP   = "http"

	HubProviderWebsiteVerificationPrefix = "llm-hub-website-verification="
)

var ErrHubProviderWebsiteRequired = errors.New("hub provider website is required")
var ErrHubProviderWebsiteVerificationInvalid = errors.New("hub provider website verification is invalid")
var ErrHubProviderWebsiteEvidenceInvalid = errors.New("hub provider website evidence is invalid")

type HubProviderWebsiteEvidenceAsset struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	ProviderId  int    `json:"provider_id" gorm:"not null;index"`
	ContentType string `json:"content_type" gorm:"type:varchar(64);not null"`
	Data        []byte `json:"-" gorm:"not null"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint;not null"`
}

func (HubProviderWebsiteEvidenceAsset) TableName() string {
	return "hub_provider_website_evidence_assets"
}

func (asset *HubProviderWebsiteEvidenceAsset) BeforeCreate(tx *gorm.DB) error {
	asset.CreatedAt = common.GetTimestamp()
	return nil
}

func IsValidHubProviderWebsiteVerificationMethod(method string) bool {
	return method == HubProviderWebsiteVerificationMethodManual ||
		method == HubProviderWebsiteVerificationMethodDNS ||
		method == HubProviderWebsiteVerificationMethodHTTP
}

func HydrateHubProviderVerificationFields(provider *HubProvider) {
	if provider == nil {
		return
	}
	if provider.SlugBase == "" {
		provider.SlugBase = provider.Slug
	}
	provider.OriginVerificationEnabled = hub_provider_setting.IsOriginVerificationEnabled()
	if provider.Website == "" || provider.WebsiteVerificationToken == "" {
		return
	}
	origin, hostname, err := NormalizeHubProviderOrigin(provider.Website)
	if err != nil {
		return
	}
	expectedValue := HubProviderWebsiteVerificationPrefix + provider.WebsiteVerificationToken
	provider.WebsiteVerificationDNSRecord = "_llm-hub-verification." + hostname
	provider.WebsiteVerificationDNSValue = expectedValue
	provider.WebsiteVerificationHTTPURL = origin + HubProviderOriginClaimHTTPPath
	provider.WebsiteVerificationHTTPBody = expectedValue
}

func CreateHubProviderWebsiteEvidenceAsset(ownerUserID int, contentType string, data []byte) (*HubProviderWebsiteEvidenceAsset, error) {
	if ownerUserID <= 0 || len(data) == 0 || strings.TrimSpace(contentType) == "" {
		return nil, ErrHubProviderWebsiteEvidenceInvalid
	}
	provider, err := GetHubProviderByOwnerUserID(ownerUserID)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return nil, ErrHubProviderNotFound
	}
	asset := &HubProviderWebsiteEvidenceAsset{
		ProviderId:  provider.Id,
		ContentType: strings.TrimSpace(contentType),
		Data:        data,
	}
	if err := DB.Create(asset).Error; err != nil {
		return nil, err
	}
	return asset, nil
}

func CreateHubProviderWithManualWebsiteVerification(provider *HubProvider, contentType string, data []byte) error {
	contentType = strings.TrimSpace(contentType)
	if provider == nil || contentType == "" || len(data) == 0 {
		return ErrHubProviderWebsiteEvidenceInvalid
	}
	origin, _, err := NormalizeHubProviderOrigin(provider.Website)
	if err != nil {
		return ErrHubProviderWebsiteRequired
	}
	if err := prepareHubProviderForCreate(provider); err != nil {
		return err
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		provider.WebsiteVerifiedOrigin = origin
		provider.WebsiteVerificationStatus = HubProviderWebsiteVerificationStatusPending
		provider.WebsiteVerificationMethod = HubProviderWebsiteVerificationMethodManual
		if err := tx.Create(provider).Error; err != nil {
			return err
		}
		asset := &HubProviderWebsiteEvidenceAsset{
			ProviderId:  provider.Id,
			ContentType: contentType,
			Data:        data,
		}
		if err := tx.Create(asset).Error; err != nil {
			return err
		}
		provider.WebsiteEvidenceAssetId = asset.Id
		return tx.Model(&HubProvider{}).
			Where("id = ?", provider.Id).
			Update("website_evidence_asset_id", asset.Id).Error
	})
	if err != nil {
		return mapHubProviderCreateError(provider, err)
	}
	refreshHubProviderRoutingCache()
	HydrateHubProviderVerificationFields(provider)
	return nil
}

func UpdateHubProviderProfileWithManualWebsiteVerification(
	ownerUserID int,
	name, website, description, logoURL string,
	contactType, contactValue, supportType, supportValue string,
	contentType string,
	data []byte,
) (*HubProvider, error) {
	contentType = strings.TrimSpace(contentType)
	if contentType == "" || len(data) == 0 {
		return nil, ErrHubProviderWebsiteEvidenceInvalid
	}
	origin, _, err := NormalizeHubProviderOrigin(website)
	if err != nil {
		return nil, ErrHubProviderWebsiteRequired
	}

	var updated *HubProvider
	err = DB.Transaction(func(tx *gorm.DB) error {
		var previous HubProvider
		if err := tx.Where("owner_user_id = ?", ownerUserID).First(&previous).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrHubProviderNotFound
			}
			return err
		}

		updated, err = updateHubProviderProfile(
			tx, ownerUserID, name, website, description, logoURL,
			contactType, contactValue, supportType, supportValue,
		)
		if err != nil {
			return err
		}

		asset := &HubProviderWebsiteEvidenceAsset{
			ProviderId:  updated.Id,
			ContentType: contentType,
			Data:        data,
		}
		if err := tx.Create(asset).Error; err != nil {
			return err
		}
		updates := map[string]any{
			"website_verified_origin":         origin,
			"website_verification_status":     HubProviderWebsiteVerificationStatusPending,
			"website_verification_method":     HubProviderWebsiteVerificationMethodManual,
			"website_verification_token":      "",
			"website_evidence_asset_id":       asset.Id,
			"website_verification_remark":     "",
			"website_verification_last_error": "",
			"website_verified_at":             0,
			"updated_at":                      common.GetTimestamp(),
		}
		if err := tx.Model(&HubProvider{}).Where("id = ?", updated.Id).Updates(updates).Error; err != nil {
			return err
		}
		if previous.WebsiteEvidenceAssetId > 0 && previous.WebsiteEvidenceAssetId != asset.Id {
			if err := tx.Delete(&HubProviderWebsiteEvidenceAsset{}, previous.WebsiteEvidenceAssetId).Error; err != nil {
				return err
			}
		}
		return tx.First(updated, updated.Id).Error
	})
	if err != nil {
		return nil, err
	}
	refreshHubProviderRoutingCache()
	HydrateHubProviderVerificationFields(updated)
	return updated, nil
}

func GetHubProviderWebsiteEvidenceAsset(assetID int) (*HubProviderWebsiteEvidenceAsset, error) {
	if assetID <= 0 {
		return nil, ErrHubProviderWebsiteEvidenceInvalid
	}
	var asset HubProviderWebsiteEvidenceAsset
	if err := DB.First(&asset, assetID).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func SubmitHubProviderWebsiteVerification(ownerUserID int, method string, evidenceAssetID int) (*HubProvider, error) {
	method = strings.ToLower(strings.TrimSpace(method))
	if ownerUserID <= 0 || !IsValidHubProviderWebsiteVerificationMethod(method) {
		return nil, ErrHubProviderWebsiteVerificationInvalid
	}
	var updated HubProvider
	err := DB.Transaction(func(tx *gorm.DB) error {
		var provider HubProvider
		if err := tx.Where("owner_user_id = ?", ownerUserID).First(&provider).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrHubProviderNotFound
			}
			return err
		}
		origin, _, err := NormalizeHubProviderOrigin(provider.Website)
		if err != nil {
			return ErrHubProviderWebsiteRequired
		}
		token := ""
		if method == HubProviderWebsiteVerificationMethodManual {
			var count int64
			if evidenceAssetID <= 0 || tx.Model(&HubProviderWebsiteEvidenceAsset{}).
				Where("id = ? AND provider_id = ?", evidenceAssetID, provider.Id).
				Count(&count).Error != nil || count != 1 {
				return ErrHubProviderWebsiteEvidenceInvalid
			}
		} else {
			evidenceAssetID = 0
			token, err = GenerateHubProviderOriginVerificationToken()
			if err != nil {
				return err
			}
		}
		updates := map[string]any{
			"website_verified_origin":         origin,
			"website_verification_status":     HubProviderWebsiteVerificationStatusPending,
			"website_verification_method":     method,
			"website_verification_token":      token,
			"website_evidence_asset_id":       evidenceAssetID,
			"website_verification_remark":     "",
			"website_verification_last_error": "",
			"website_verified_at":             0,
			"updated_at":                      common.GetTimestamp(),
		}
		if err := tx.Model(&HubProvider{}).Where("id = ?", provider.Id).Updates(updates).Error; err != nil {
			return err
		}
		return tx.First(&updated, provider.Id).Error
	})
	if err != nil {
		return nil, err
	}
	HydrateHubProviderVerificationFields(&updated)
	return &updated, nil
}

func UpdateHubProviderWebsiteVerificationResult(ownerUserID int, verified bool, lastError string) (*HubProvider, error) {
	if ownerUserID <= 0 {
		return nil, ErrHubProviderWebsiteVerificationInvalid
	}
	var provider HubProvider
	if err := DB.Where("owner_user_id = ?", ownerUserID).First(&provider).Error; err != nil {
		return nil, err
	}
	if provider.WebsiteVerificationStatus != HubProviderWebsiteVerificationStatusPending ||
		(provider.WebsiteVerificationMethod != HubProviderWebsiteVerificationMethodDNS &&
			provider.WebsiteVerificationMethod != HubProviderWebsiteVerificationMethodHTTP) {
		return nil, ErrHubProviderWebsiteVerificationInvalid
	}
	status := HubProviderWebsiteVerificationStatusPending
	verifiedAt := int64(0)
	if verified {
		status = HubProviderWebsiteVerificationStatusVerified
		verifiedAt = common.GetTimestamp()
		lastError = ""
	}
	if err := DB.Model(&HubProvider{}).Where("id = ?", provider.Id).Updates(map[string]any{
		"website_verification_status":     status,
		"website_verification_last_error": strings.TrimSpace(lastError),
		"website_verified_at":             verifiedAt,
		"updated_at":                      common.GetTimestamp(),
	}).Error; err != nil {
		return nil, err
	}
	if err := DB.First(&provider, provider.Id).Error; err != nil {
		return nil, err
	}
	HydrateHubProviderVerificationFields(&provider)
	return &provider, nil
}

func PublicHubProviderWebsite(provider HubProvider) string {
	if provider.WebsiteVerificationStatus != HubProviderWebsiteVerificationStatusVerified {
		return ""
	}
	origin, _, err := NormalizeHubProviderOrigin(provider.Website)
	if err != nil || origin != provider.WebsiteVerifiedOrigin {
		return ""
	}
	return provider.Website
}
