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
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	HubProviderPayoutMethodAlipay = "alipay"
	HubProviderPayoutMethodWeChat = "wechat"
	HubProviderPayoutMethodBank   = "bank"

	HubProviderPayoutAccountTypePersonal = "personal"
	HubProviderPayoutAccountTypeBusiness = "business"
)

var (
	ErrHubProviderPayoutAccountInvalid  = errors.New("invalid hub provider payout account")
	ErrHubProviderPayoutAccountNotFound = errors.New("hub provider payout account not found")
	ErrHubProviderPayoutAssetInvalid    = errors.New("invalid hub provider payout asset")
)

type HubProviderPayoutAccountDetails struct {
	Version       int    `json:"version"`
	RecipientName string `json:"recipient_name"`
	Account       string `json:"account,omitempty"`
	AccountType   string `json:"account_type,omitempty"`
	BankName      string `json:"bank_name,omitempty"`
	BankBranch    string `json:"bank_branch,omitempty"`
}

type HubProviderPayoutAccountInput struct {
	Method        string
	Details       HubProviderPayoutAccountDetails
	QRCodeAssetId int
	IsDefault     bool
}

type HubProviderPayoutAccount struct {
	Id              int                             `json:"id" gorm:"primaryKey"`
	ProviderId      int                             `json:"provider_id" gorm:"not null;index"`
	Method          string                          `json:"method" gorm:"type:varchar(32);not null;index"`
	DetailsJSON     string                          `json:"-" gorm:"column:details;type:text;not null"`
	QRCodeAssetId   int                             `json:"qr_code_asset_id" gorm:"not null;default:0;index"`
	IsDefault       bool                            `json:"is_default" gorm:"not null;default:false;index"`
	CreatedAt       int64                           `json:"created_at" gorm:"bigint;not null"`
	UpdatedAt       int64                           `json:"updated_at" gorm:"bigint;not null"`
	Details         HubProviderPayoutAccountDetails `json:"details" gorm:"-"`
	MaskedSummary   string                          `json:"masked_summary" gorm:"-"`
	QRCodeAvailable bool                            `json:"qr_code_available" gorm:"-"`
}

func (HubProviderPayoutAccount) TableName() string {
	return "hub_provider_payout_accounts"
}

func (account *HubProviderPayoutAccount) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	account.CreatedAt = now
	account.UpdatedAt = now
	return nil
}

type HubProviderPayoutAsset struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	ProviderId  int    `json:"provider_id" gorm:"not null;index"`
	ContentType string `json:"content_type" gorm:"type:varchar(64);not null"`
	Data        []byte `json:"-" gorm:"not null"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint;not null"`
}

func (HubProviderPayoutAsset) TableName() string {
	return "hub_provider_payout_assets"
}

func (asset *HubProviderPayoutAsset) BeforeCreate(tx *gorm.DB) error {
	asset.CreatedAt = common.GetTimestamp()
	return nil
}

type HubProviderPayoutAccountSnapshot struct {
	Method        string                          `json:"method"`
	Details       HubProviderPayoutAccountDetails `json:"details"`
	QRCodeAssetId int                             `json:"qr_code_asset_id,omitempty"`
	MaskedSummary string                          `json:"masked_summary"`
}

func IsValidHubProviderPayoutMethod(method string) bool {
	return method == HubProviderPayoutMethodAlipay ||
		method == HubProviderPayoutMethodWeChat ||
		method == HubProviderPayoutMethodBank
}

func normalizeHubProviderPayoutAccountInput(input HubProviderPayoutAccountInput) (HubProviderPayoutAccountInput, error) {
	input.Method = strings.ToLower(strings.TrimSpace(input.Method))
	input.Details.Version = 1
	input.Details.RecipientName = strings.TrimSpace(input.Details.RecipientName)
	input.Details.Account = strings.TrimSpace(input.Details.Account)
	input.Details.AccountType = strings.ToLower(strings.TrimSpace(input.Details.AccountType))
	input.Details.BankName = strings.TrimSpace(input.Details.BankName)
	input.Details.BankBranch = strings.TrimSpace(input.Details.BankBranch)

	if !IsValidHubProviderPayoutMethod(input.Method) ||
		input.Details.RecipientName == "" ||
		utf8.RuneCountInString(input.Details.RecipientName) > 128 ||
		utf8.RuneCountInString(input.Details.Account) > 255 ||
		utf8.RuneCountInString(input.Details.BankName) > 128 ||
		utf8.RuneCountInString(input.Details.BankBranch) > 255 {
		return input, ErrHubProviderPayoutAccountInvalid
	}

	switch input.Method {
	case HubProviderPayoutMethodAlipay:
		if input.Details.Account == "" {
			return input, ErrHubProviderPayoutAccountInvalid
		}
		input.Details.AccountType = ""
		input.Details.BankName = ""
		input.Details.BankBranch = ""
	case HubProviderPayoutMethodWeChat:
		if input.QRCodeAssetId <= 0 {
			return input, ErrHubProviderPayoutAccountInvalid
		}
		input.Details.AccountType = ""
		input.Details.BankName = ""
		input.Details.BankBranch = ""
	case HubProviderPayoutMethodBank:
		if input.Details.Account == "" || input.Details.BankName == "" ||
			(input.Details.AccountType != HubProviderPayoutAccountTypePersonal &&
				input.Details.AccountType != HubProviderPayoutAccountTypeBusiness) {
			return input, ErrHubProviderPayoutAccountInvalid
		}
		input.QRCodeAssetId = 0
	}
	return input, nil
}

func maskHubProviderPayoutIdentifier(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) == 0 {
		return ""
	}
	if len(runes) <= 4 {
		return strings.Repeat("*", len(runes))
	}
	if len(runes) <= 8 {
		return string(runes[:2]) + strings.Repeat("*", len(runes)-4) + string(runes[len(runes)-2:])
	}
	return string(runes[:3]) + "****" + string(runes[len(runes)-4:])
}

func hydrateHubProviderPayoutAccount(account *HubProviderPayoutAccount) error {
	if err := common.Unmarshal([]byte(account.DetailsJSON), &account.Details); err != nil {
		return fmt.Errorf("decode hub provider payout account details: %w", err)
	}
	account.QRCodeAvailable = account.QRCodeAssetId > 0
	identifier := account.Details.Account
	if identifier == "" && account.QRCodeAvailable {
		identifier = account.Details.RecipientName
	}
	account.MaskedSummary = maskHubProviderPayoutIdentifier(identifier)
	return nil
}

func hubProviderForOwnerTx(tx *gorm.DB, providerId, ownerUserId int) (*HubProvider, error) {
	var provider HubProvider
	if err := tx.Where("id = ? AND owner_user_id = ?", providerId, ownerUserId).First(&provider).Error; err != nil {
		return nil, err
	}
	return &provider, nil
}

func validateHubProviderPayoutAssetTx(tx *gorm.DB, providerId, assetId int) error {
	if assetId <= 0 {
		return nil
	}
	var count int64
	if err := tx.Model(&HubProviderPayoutAsset{}).
		Where("id = ? AND provider_id = ?", assetId, providerId).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrHubProviderPayoutAssetInvalid
	}
	return nil
}

func CreateHubProviderPayoutAsset(providerId, ownerUserId int, contentType string, data []byte) (*HubProviderPayoutAsset, error) {
	if providerId <= 0 || ownerUserId <= 0 || len(data) == 0 || strings.TrimSpace(contentType) == "" {
		return nil, ErrHubProviderPayoutAssetInvalid
	}
	provider, err := hubProviderForOwnerTx(DB, providerId, ownerUserId)
	if err != nil {
		return nil, err
	}
	asset := &HubProviderPayoutAsset{
		ProviderId:  provider.Id,
		ContentType: strings.TrimSpace(contentType),
		Data:        data,
	}
	if err := DB.Create(asset).Error; err != nil {
		return nil, err
	}
	return asset, nil
}

func GetHubProviderPayoutAsset(id int) (*HubProviderPayoutAsset, error) {
	if id <= 0 {
		return nil, ErrHubProviderPayoutAssetInvalid
	}
	var asset HubProviderPayoutAsset
	if err := DB.First(&asset, id).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func CreateHubProviderPayoutAccount(providerId, ownerUserId int, input HubProviderPayoutAccountInput) (*HubProviderPayoutAccount, error) {
	if providerId <= 0 || ownerUserId <= 0 {
		return nil, ErrHubProviderPayoutAccountInvalid
	}
	input, err := normalizeHubProviderPayoutAccountInput(input)
	if err != nil {
		return nil, err
	}
	var created HubProviderPayoutAccount
	err = DB.Transaction(func(tx *gorm.DB) error {
		provider, err := hubProviderForOwnerTx(tx, providerId, ownerUserId)
		if err != nil {
			return err
		}
		if err := validateHubProviderPayoutAssetTx(tx, provider.Id, input.QRCodeAssetId); err != nil {
			return err
		}
		detailsJSON, err := common.Marshal(input.Details)
		if err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&HubProviderPayoutAccount{}).Where("provider_id = ?", provider.Id).Count(&count).Error; err != nil {
			return err
		}
		created = HubProviderPayoutAccount{
			ProviderId:    provider.Id,
			Method:        input.Method,
			DetailsJSON:   string(detailsJSON),
			QRCodeAssetId: input.QRCodeAssetId,
			IsDefault:     input.IsDefault || count == 0,
		}
		if created.IsDefault {
			if err := tx.Model(&HubProviderPayoutAccount{}).
				Where("provider_id = ?", provider.Id).
				Update("is_default", false).Error; err != nil {
				return err
			}
		}
		return tx.Create(&created).Error
	})
	if err != nil {
		return nil, err
	}
	if err := hydrateHubProviderPayoutAccount(&created); err != nil {
		return nil, err
	}
	return &created, nil
}

func ListHubProviderPayoutAccounts(providerId, ownerUserId int) ([]HubProviderPayoutAccount, error) {
	provider, err := hubProviderForOwnerTx(DB, providerId, ownerUserId)
	if err != nil {
		return nil, err
	}
	items := make([]HubProviderPayoutAccount, 0)
	if err := DB.Where("provider_id = ?", provider.Id).
		Order("is_default DESC, id ASC").Find(&items).Error; err != nil {
		return nil, err
	}
	for i := range items {
		if err := hydrateHubProviderPayoutAccount(&items[i]); err != nil {
			return nil, err
		}
	}
	return items, nil
}

func UpdateHubProviderPayoutAccount(providerId, ownerUserId, id int, input HubProviderPayoutAccountInput) (*HubProviderPayoutAccount, error) {
	if providerId <= 0 || ownerUserId <= 0 || id <= 0 {
		return nil, ErrHubProviderPayoutAccountInvalid
	}
	input, err := normalizeHubProviderPayoutAccountInput(input)
	if err != nil {
		return nil, err
	}
	var updated HubProviderPayoutAccount
	err = DB.Transaction(func(tx *gorm.DB) error {
		provider, err := hubProviderForOwnerTx(tx, providerId, ownerUserId)
		if err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where("id = ? AND provider_id = ?", id, provider.Id).First(&updated).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrHubProviderPayoutAccountNotFound
			}
			return err
		}
		if err := validateHubProviderPayoutAssetTx(tx, provider.Id, input.QRCodeAssetId); err != nil {
			return err
		}
		detailsJSON, err := common.Marshal(input.Details)
		if err != nil {
			return err
		}
		isDefault := updated.IsDefault || input.IsDefault
		if input.IsDefault {
			if err := tx.Model(&HubProviderPayoutAccount{}).
				Where("provider_id = ? AND id <> ?", provider.Id, id).
				Update("is_default", false).Error; err != nil {
				return err
			}
		}
		updates := map[string]any{
			"method":           input.Method,
			"details":          string(detailsJSON),
			"qr_code_asset_id": input.QRCodeAssetId,
			"is_default":       isDefault,
			"updated_at":       common.GetTimestamp(),
		}
		if err := tx.Model(&HubProviderPayoutAccount{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return err
		}
		return tx.First(&updated, id).Error
	})
	if err != nil {
		return nil, err
	}
	if err := hydrateHubProviderPayoutAccount(&updated); err != nil {
		return nil, err
	}
	return &updated, nil
}

func DeleteHubProviderPayoutAccount(providerId, ownerUserId, id int) error {
	if providerId <= 0 || ownerUserId <= 0 || id <= 0 {
		return ErrHubProviderPayoutAccountInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		provider, err := hubProviderForOwnerTx(tx, providerId, ownerUserId)
		if err != nil {
			return err
		}
		var account HubProviderPayoutAccount
		if err := lockForUpdate(tx).Where("id = ? AND provider_id = ?", id, provider.Id).First(&account).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrHubProviderPayoutAccountNotFound
			}
			return err
		}
		if err := tx.Delete(&HubProviderPayoutAccount{}, id).Error; err != nil {
			return err
		}
		if !account.IsDefault {
			return nil
		}
		var replacement HubProviderPayoutAccount
		if err := tx.Where("provider_id = ?", provider.Id).Order("id ASC").First(&replacement).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		return tx.Model(&replacement).Updates(map[string]any{
			"is_default": true,
			"updated_at": common.GetTimestamp(),
		}).Error
	})
}

func getHubProviderPayoutAccountTx(tx *gorm.DB, providerId, accountId int) (*HubProviderPayoutAccount, error) {
	var account HubProviderPayoutAccount
	if err := tx.Where("id = ? AND provider_id = ?", accountId, providerId).First(&account).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrHubProviderPayoutAccountNotFound
		}
		return nil, err
	}
	if err := hydrateHubProviderPayoutAccount(&account); err != nil {
		return nil, err
	}
	return &account, nil
}

func snapshotHubProviderPayoutAccount(account *HubProviderPayoutAccount) (string, error) {
	snapshot := HubProviderPayoutAccountSnapshot{
		Method:        account.Method,
		Details:       account.Details,
		QRCodeAssetId: account.QRCodeAssetId,
		MaskedSummary: account.MaskedSummary,
	}
	data, err := common.Marshal(snapshot)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
