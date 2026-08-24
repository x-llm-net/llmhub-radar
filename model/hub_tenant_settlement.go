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
*/
package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_provider_settlement_setting"
	"gorm.io/gorm"
)

const (
	HubTenantWithdrawalStatusPending  = HubProviderWithdrawalStatusPending
	HubTenantWithdrawalStatusApproved = HubProviderWithdrawalStatusApproved
	HubTenantWithdrawalStatusPaid     = HubProviderWithdrawalStatusPaid
	HubTenantWithdrawalStatusRejected = HubProviderWithdrawalStatusRejected
)

var (
	ErrHubTenantFinanceOwnerRequired        = errors.New("an active tenant owner is required for this operation")
	ErrHubTenantWithdrawalPending           = errors.New("tenant already has a pending withdrawal")
	ErrHubTenantWithdrawalNotFound          = errors.New("tenant withdrawal not found")
	ErrHubTenantWithdrawalBelowMinimum      = errors.New("tenant withdrawal amount is below the minimum")
	ErrHubTenantWithdrawalInsufficient      = errors.New("tenant withdrawable balance is insufficient")
	ErrHubTenantWithdrawalTransition        = errors.New("invalid tenant withdrawal status transition")
	ErrHubTenantWithdrawalRemarkRequired    = errors.New("tenant withdrawal review remark is required")
	ErrHubTenantWithdrawalPaymentInvalid    = errors.New("tenant withdrawal payment details are invalid")
	ErrHubTenantBalanceTransferInsufficient = errors.New("tenant balance transfer amount exceeds withdrawable earnings")
)

type HubTenantPayoutAsset struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	TenantId    int    `json:"tenant_id" gorm:"not null;index"`
	ContentType string `json:"content_type" gorm:"type:varchar(64);not null"`
	Data        []byte `json:"-" gorm:"not null"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint;not null"`
}

func (HubTenantPayoutAsset) TableName() string {
	return "hub_tenant_payout_assets"
}

func (asset *HubTenantPayoutAsset) BeforeCreate(tx *gorm.DB) error {
	asset.CreatedAt = common.GetTimestamp()
	return nil
}

type HubTenantPayoutAccount struct {
	Id              int                             `json:"id" gorm:"primaryKey"`
	TenantId        int                             `json:"tenant_id" gorm:"not null;index"`
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

func (HubTenantPayoutAccount) TableName() string {
	return "hub_tenant_payout_accounts"
}

func (account *HubTenantPayoutAccount) BeforeCreate(tx *gorm.DB) error {
	account.CreatedAt = common.GetTimestamp()
	account.UpdatedAt = common.GetTimestamp()
	return nil
}

type HubTenantWithdrawal struct {
	Id                    int                               `json:"id" gorm:"primaryKey"`
	TenantId              int                               `json:"tenant_id" gorm:"not null;index"`
	OwnerUserId           int                               `json:"owner_user_id" gorm:"not null;index"`
	AmountQuota           int                               `json:"amount_quota" gorm:"not null"`
	Status                string                            `json:"status" gorm:"type:varchar(24);not null;index"`
	PayoutAccountId       int                               `json:"payout_account_id" gorm:"not null;default:0;index"`
	PayoutMethod          string                            `json:"payout_method" gorm:"type:varchar(32);not null;default:''"`
	PayoutAccountSnapshot string                            `json:"-" gorm:"type:text;not null"`
	PayoutAccount         *HubProviderPayoutAccountSnapshot `json:"payout_account,omitempty" gorm:"-"`
	ApplicantNote         string                            `json:"applicant_note" gorm:"type:varchar(1000);not null;default:''"`
	PayoutCurrency        string                            `json:"payout_currency" gorm:"type:varchar(8);not null;default:''"`
	PayoutAmountMinor     int64                             `json:"payout_amount_minor" gorm:"bigint;not null;default:0"`
	ExchangeRate          string                            `json:"exchange_rate" gorm:"type:varchar(32);not null;default:''"`
	AdminRemark           string                            `json:"admin_remark" gorm:"type:varchar(1000);not null;default:''"`
	AdminUserId           int                               `json:"admin_user_id" gorm:"not null;default:0"`
	ReviewedAt            int64                             `json:"reviewed_at" gorm:"bigint;not null;default:0"`
	PaidAt                int64                             `json:"paid_at" gorm:"bigint;not null;default:0"`
	CreatedAt             int64                             `json:"created_at" gorm:"bigint;not null"`
	UpdatedAt             int64                             `json:"updated_at" gorm:"bigint;not null"`
}

func (HubTenantWithdrawal) TableName() string {
	return "hub_tenant_withdrawals"
}

func (withdrawal *HubTenantWithdrawal) BeforeCreate(tx *gorm.DB) error {
	if withdrawal.Status == "" {
		withdrawal.Status = HubTenantWithdrawalStatusPending
	}
	now := common.GetTimestamp()
	withdrawal.CreatedAt = now
	withdrawal.UpdatedAt = now
	return nil
}

type HubTenantSettlementSummary struct {
	TenantId                int `json:"tenant_id"`
	GrossQuota              int `json:"gross_quota"`
	PlatformFeeQuota        int `json:"platform_fee_quota"`
	ResellerGrossQuota      int `json:"reseller_gross_quota"`
	ResellerNetIncomeQuota  int `json:"reseller_net_income_quota"`
	SettledIncomeQuota      int `json:"settled_income_quota"`
	PendingIncomeQuota      int `json:"pending_income_quota"`
	ReservedWithdrawalQuota int `json:"reserved_withdrawal_quota"`
	PaidWithdrawalQuota     int `json:"paid_withdrawal_quota"`
	TransferredBalanceQuota int `json:"transferred_balance_quota"`
	WithdrawableQuota       int `json:"withdrawable_quota"`
	PlatformFeeBasisPoints  int `json:"platform_fee_basis_points"`
	MinimumWithdrawalQuota  int `json:"minimum_withdrawal_quota"`
}

type HubTenantSettlementAdminItem struct {
	TenantId     int                        `json:"tenant_id"`
	TenantName   string                     `json:"tenant_name"`
	TenantSlug   string                     `json:"tenant_slug"`
	TenantStatus string                     `json:"tenant_status"`
	Summary      HubTenantSettlementSummary `json:"summary"`
}

type HubTenantWithdrawalAdminItem struct {
	HubTenantWithdrawal
	TenantName    string `json:"tenant_name" gorm:"column:tenant_name"`
	TenantSlug    string `json:"tenant_slug" gorm:"column:tenant_slug"`
	OwnerUsername string `json:"owner_username" gorm:"column:owner_username"`
	OwnerEmail    string `json:"owner_email" gorm:"column:owner_email"`
}

func hydrateHubTenantPayoutAccount(account *HubTenantPayoutAccount) error {
	if err := common.Unmarshal([]byte(account.DetailsJSON), &account.Details); err != nil {
		return fmt.Errorf("decode hub tenant payout account details: %w", err)
	}
	account.QRCodeAvailable = account.QRCodeAssetId > 0
	identifier := account.Details.Account
	if identifier == "" && account.QRCodeAvailable {
		identifier = account.Details.RecipientName
	}
	account.MaskedSummary = maskHubProviderPayoutIdentifier(identifier)
	return nil
}

func lockHubTenantFinanceTx(tx *gorm.DB, tenantID int) error {
	if tenantID <= 0 {
		return ErrTenantNotFound
	}
	var tenant Tenant
	if err := lockForUpdate(tx).Where("id = ? AND status = ?", tenantID, TenantStatusActive).First(&tenant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrTenantNotFound
		}
		return err
	}
	return nil
}

func requireActiveTenantOwnerTx(tx *gorm.DB, tenantID, ownerUserID int) error {
	var member TenantMember
	err := tx.Where(
		"tenant_id = ? AND user_id = ? AND role = ? AND status = ?",
		tenantID, ownerUserID, TenantMemberRoleOwner, TenantMemberStatusActive,
	).First(&member).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrHubTenantFinanceOwnerRequired
	}
	return err
}

func tenantSettlementIncomeTx(tx *gorm.DB, tenantID int) (settled, transferred, unavailable int, err error) {
	type quotaSum struct {
		Value int `gorm:"column:value"`
	}
	var earned quotaSum
	err = tx.Model(&HubProviderEarning{}).
		Select("COALESCE(SUM(reseller_net_income_quota), 0) AS value").
		Where("tenant_id = ? AND status = ? AND entry_type = ? AND settlement_version >= 2",
			tenantID, HubProviderEarningStatusSettled, HubProviderEarningTypeUsage).
		Scan(&earned).Error
	if err != nil {
		return
	}
	settled = earned.Value

	var transfers quotaSum
	err = tx.Model(&HubProviderEarning{}).
		Select("COALESCE(SUM(-reseller_net_income_quota), 0) AS value").
		Where("tenant_id = ? AND status = ? AND entry_type = ?",
			tenantID, HubProviderEarningStatusSettled, HubProviderEarningTypeBalanceTransfer).
		Scan(&transfers).Error
	if err != nil {
		return
	}
	transferred = transfers.Value

	var withdrawals quotaSum
	err = tx.Model(&HubTenantWithdrawal{}).
		Select("COALESCE(SUM(amount_quota), 0) AS value").
		Where("tenant_id = ? AND status <> ?", tenantID, HubTenantWithdrawalStatusRejected).
		Scan(&withdrawals).Error
	if err != nil {
		return
	}
	unavailable = withdrawals.Value
	return
}

func GetHubTenantSettlementSummary(tenantID int) (HubTenantSettlementSummary, error) {
	summary := HubTenantSettlementSummary{
		TenantId:               tenantID,
		PlatformFeeBasisPoints: hub_provider_settlement_setting.PlatformFeeBasisPoints(),
		MinimumWithdrawalQuota: hub_provider_settlement_setting.MinimumWithdrawalQuota(),
	}
	if tenantID <= 0 {
		return summary, ErrTenantNotFound
	}
	type earningSums struct {
		GrossQuota             int `gorm:"column:gross_quota"`
		PlatformFeeQuota       int `gorm:"column:platform_fee_quota"`
		ResellerGrossQuota     int `gorm:"column:reseller_gross_quota"`
		ResellerNetIncomeQuota int `gorm:"column:reseller_net_income_quota"`
		PendingIncomeQuota     int `gorm:"column:pending_income_quota"`
	}
	var earnings earningSums
	if err := DB.Model(&HubProviderEarning{}).
		Select(
			"COALESCE(SUM(CASE WHEN status = ? AND entry_type = ? AND settlement_version >= 2 THEN gross_quota ELSE 0 END), 0) AS gross_quota, "+
				"COALESCE(SUM(CASE WHEN status = ? AND entry_type = ? AND settlement_version >= 2 THEN platform_fee_quota ELSE 0 END), 0) AS platform_fee_quota, "+
				"COALESCE(SUM(CASE WHEN status = ? AND entry_type = ? AND settlement_version >= 2 THEN reseller_gross_quota ELSE 0 END), 0) AS reseller_gross_quota, "+
				"COALESCE(SUM(CASE WHEN status = ? AND entry_type = ? AND settlement_version >= 2 THEN reseller_net_income_quota ELSE 0 END), 0) AS reseller_net_income_quota, "+
				"COALESCE(SUM(CASE WHEN status = ? AND entry_type = ? AND settlement_version >= 2 THEN reseller_net_income_quota ELSE 0 END), 0) AS pending_income_quota",
			HubProviderEarningStatusSettled, HubProviderEarningTypeUsage,
			HubProviderEarningStatusSettled, HubProviderEarningTypeUsage,
			HubProviderEarningStatusSettled, HubProviderEarningTypeUsage,
			HubProviderEarningStatusSettled, HubProviderEarningTypeUsage,
			HubProviderEarningStatusPending, HubProviderEarningTypeUsage,
		).
		Where("tenant_id = ?", tenantID).
		Scan(&earnings).Error; err != nil {
		return summary, err
	}
	settled, transferred, unavailable, err := tenantSettlementIncomeTx(DB, tenantID)
	if err != nil {
		return summary, err
	}
	summary.GrossQuota = earnings.GrossQuota
	summary.PlatformFeeQuota = earnings.PlatformFeeQuota
	summary.ResellerGrossQuota = earnings.ResellerGrossQuota
	summary.ResellerNetIncomeQuota = earnings.ResellerNetIncomeQuota
	summary.SettledIncomeQuota = settled
	summary.PendingIncomeQuota = earnings.PendingIncomeQuota
	summary.TransferredBalanceQuota = transferred
	var paid int
	if err := DB.Model(&HubTenantWithdrawal{}).
		Select("COALESCE(SUM(amount_quota), 0)").
		Where("tenant_id = ? AND status = ?", tenantID, HubTenantWithdrawalStatusPaid).
		Scan(&paid).Error; err != nil {
		return summary, err
	}
	summary.PaidWithdrawalQuota = paid
	summary.ReservedWithdrawalQuota = unavailable - paid
	if summary.ReservedWithdrawalQuota < 0 {
		summary.ReservedWithdrawalQuota = 0
	}
	summary.WithdrawableQuota = settled - transferred - unavailable
	if summary.WithdrawableQuota < 0 {
		summary.WithdrawableQuota = 0
	}
	return summary, nil
}

// AdminListHubTenantSettlementSummaries is intentionally read-only and
// platform-scoped. Keep the per-tenant summary calculation in one place so
// this report cannot drift from the tenant finance page's balance rules.
func AdminListHubTenantSettlementSummaries() ([]HubTenantSettlementAdminItem, error) {
	var tenants []Tenant
	if err := DB.Order("id ASC").Find(&tenants).Error; err != nil {
		return nil, err
	}
	items := make([]HubTenantSettlementAdminItem, 0, len(tenants))
	for _, tenant := range tenants {
		summary, err := GetHubTenantSettlementSummary(tenant.Id)
		if err != nil {
			return nil, err
		}
		items = append(items, HubTenantSettlementAdminItem{
			TenantId:     tenant.Id,
			TenantName:   tenant.Name,
			TenantSlug:   tenant.Slug,
			TenantStatus: tenant.Status,
			Summary:      summary,
		})
	}
	return items, nil
}

func ListHubTenantEarnings(tenantID, offset, limit int) ([]HubProviderEarning, int64, error) {
	if tenantID <= 0 {
		return nil, 0, ErrTenantNotFound
	}
	query := DB.Model(&HubProviderEarning{}).Where(
		"tenant_id = ? AND ((entry_type = ? AND settlement_version >= 2) OR entry_type = ?)",
		tenantID, HubProviderEarningTypeUsage, HubProviderEarningTypeBalanceTransfer,
	)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]HubProviderEarning, 0)
	listQuery := query.Order("id DESC")
	if limit > 0 {
		listQuery = listQuery.Limit(limit).Offset(offset)
	}
	if err := listQuery.Find(&items).Error; err != nil {
		return nil, 0, err
	}
	for index := range items {
		items[index].EarningRole = "tenant"
	}
	return items, total, nil
}

func CreateHubTenantBalanceTransfer(tenantID, ownerUserID, amountQuota int, idempotencyKey string) (*HubProviderEarning, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if tenantID <= 0 || ownerUserID <= 0 || amountQuota <= 0 || idempotencyKey == "" || len(idempotencyKey) > 48 {
		return nil, errors.New("invalid hub tenant balance transfer")
	}
	requestID := fmt.Sprintf("tenant-balance-transfer:%d:%d:%s", tenantID, ownerUserID, idempotencyKey)
	var transfer HubProviderEarning
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockHubTenantFinanceTx(tx, tenantID); err != nil {
			return err
		}
		if err := requireActiveTenantOwnerTx(tx, tenantID, ownerUserID); err != nil {
			return err
		}
		var existing HubProviderEarning
		if err := tx.Where("request_id = ?", requestID).First(&existing).Error; err == nil {
			if existing.TenantId != tenantID || existing.OwnerUserId != ownerUserID ||
				existing.EntryType != HubProviderEarningTypeBalanceTransfer ||
				existing.Status != HubProviderEarningStatusSettled ||
				existing.ResellerNetIncomeQuota != -amountQuota {
				return ErrHubProviderEarningReferenceConflict
			}
			transfer = existing
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		settled, transferred, unavailable, err := tenantSettlementIncomeTx(tx, tenantID)
		if err != nil {
			return err
		}
		if amountQuota > settled-transferred-unavailable {
			return ErrHubTenantBalanceTransferInsufficient
		}
		now := common.GetTimestamp()
		transfer = HubProviderEarning{
			RequestId:              requestID,
			EntryType:              HubProviderEarningTypeBalanceTransfer,
			Status:                 HubProviderEarningStatusSettled,
			ProviderId:             0,
			TenantId:               tenantID,
			OwnerUserId:            ownerUserID,
			BillingSource:          "tenant_earnings",
			ResellerNetIncomeQuota: -amountQuota,
			OperatorUserId:         ownerUserID,
			Remark:                 "Transferred tenant earnings to account balance",
			SettledAt:              now,
		}
		if err := tx.Create(&transfer).Error; err != nil {
			return err
		}
		result := tx.Model(&User{}).Where("id = ?", ownerUserID).Update("quota", gorm.Expr("quota + ?", amountQuota))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("tenant owner user not found")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	var userQuota int
	if err := DB.Model(&User{}).Where("id = ?", ownerUserID).Select("quota").Scan(&userQuota).Error; err != nil {
		common.SysLog("failed to load user quota after tenant balance transfer: " + err.Error())
	} else if err := updateUserQuotaCache(ownerUserID, userQuota); err != nil {
		common.SysLog("failed to update user quota cache after tenant balance transfer: " + err.Error())
	}
	return &transfer, nil
}

func validateHubTenantPayoutAssetTx(tx *gorm.DB, tenantID, assetID int) error {
	if assetID <= 0 {
		return nil
	}
	var count int64
	if err := tx.Model(&HubTenantPayoutAsset{}).Where("id = ? AND tenant_id = ?", assetID, tenantID).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrHubProviderPayoutAssetInvalid
	}
	return nil
}

func CreateHubTenantPayoutAsset(tenantID, ownerUserID int, contentType string, data []byte) (*HubTenantPayoutAsset, error) {
	if tenantID <= 0 || ownerUserID <= 0 || len(data) == 0 || strings.TrimSpace(contentType) == "" {
		return nil, ErrHubProviderPayoutAssetInvalid
	}
	var asset HubTenantPayoutAsset
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockHubTenantFinanceTx(tx, tenantID); err != nil {
			return err
		}
		if err := requireActiveTenantOwnerTx(tx, tenantID, ownerUserID); err != nil {
			return err
		}
		asset = HubTenantPayoutAsset{TenantId: tenantID, ContentType: strings.TrimSpace(contentType), Data: data}
		return tx.Create(&asset).Error
	})
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func GetHubTenantPayoutAsset(id, tenantID int) (*HubTenantPayoutAsset, error) {
	if id <= 0 || tenantID <= 0 {
		return nil, ErrHubProviderPayoutAssetInvalid
	}
	var asset HubTenantPayoutAsset
	if err := DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&asset).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func GetHubTenantPayoutAssetForAdmin(id int, tenantID *int) (*HubTenantPayoutAsset, error) {
	if id <= 0 {
		return nil, ErrHubProviderPayoutAssetInvalid
	}
	query := DB.Where("id = ?", id)
	if tenantID != nil {
		if *tenantID <= 0 {
			return nil, ErrHubProviderPayoutAssetInvalid
		}
		query = query.Where("tenant_id = ?", *tenantID)
	}
	var asset HubTenantPayoutAsset
	if err := query.First(&asset).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func getHubTenantPayoutAccountTx(tx *gorm.DB, tenantID, accountID int) (*HubTenantPayoutAccount, error) {
	var account HubTenantPayoutAccount
	if err := tx.Where("id = ? AND tenant_id = ?", accountID, tenantID).First(&account).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrHubProviderPayoutAccountNotFound
		}
		return nil, err
	}
	if err := hydrateHubTenantPayoutAccount(&account); err != nil {
		return nil, err
	}
	return &account, nil
}

func CreateHubTenantPayoutAccount(tenantID, ownerUserID int, input HubProviderPayoutAccountInput) (*HubTenantPayoutAccount, error) {
	if tenantID <= 0 || ownerUserID <= 0 {
		return nil, ErrHubProviderPayoutAccountInvalid
	}
	input, err := normalizeHubProviderPayoutAccountInput(input)
	if err != nil {
		return nil, err
	}
	var created HubTenantPayoutAccount
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockHubTenantFinanceTx(tx, tenantID); err != nil {
			return err
		}
		if err := requireActiveTenantOwnerTx(tx, tenantID, ownerUserID); err != nil {
			return err
		}
		if err := validateHubTenantPayoutAssetTx(tx, tenantID, input.QRCodeAssetId); err != nil {
			return err
		}
		detailsJSON, err := common.Marshal(input.Details)
		if err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&HubTenantPayoutAccount{}).Where("tenant_id = ?", tenantID).Count(&count).Error; err != nil {
			return err
		}
		created = HubTenantPayoutAccount{
			TenantId:      tenantID,
			Method:        input.Method,
			DetailsJSON:   string(detailsJSON),
			QRCodeAssetId: input.QRCodeAssetId,
			IsDefault:     input.IsDefault || count == 0,
		}
		if created.IsDefault {
			if err := tx.Model(&HubTenantPayoutAccount{}).Where("tenant_id = ?", tenantID).Update("is_default", false).Error; err != nil {
				return err
			}
		}
		return tx.Create(&created).Error
	})
	if err != nil {
		return nil, err
	}
	if err := hydrateHubTenantPayoutAccount(&created); err != nil {
		return nil, err
	}
	return &created, nil
}

func ListHubTenantPayoutAccounts(tenantID int) ([]HubTenantPayoutAccount, error) {
	if tenantID <= 0 {
		return nil, ErrTenantNotFound
	}
	items := make([]HubTenantPayoutAccount, 0)
	if err := DB.Where("tenant_id = ?", tenantID).Order("is_default DESC, id ASC").Find(&items).Error; err != nil {
		return nil, err
	}
	for i := range items {
		if err := hydrateHubTenantPayoutAccount(&items[i]); err != nil {
			return nil, err
		}
	}
	return items, nil
}

func UpdateHubTenantPayoutAccount(tenantID, ownerUserID, id int, input HubProviderPayoutAccountInput) (*HubTenantPayoutAccount, error) {
	if tenantID <= 0 || ownerUserID <= 0 || id <= 0 {
		return nil, ErrHubProviderPayoutAccountInvalid
	}
	input, err := normalizeHubProviderPayoutAccountInput(input)
	if err != nil {
		return nil, err
	}
	var updated HubTenantPayoutAccount
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockHubTenantFinanceTx(tx, tenantID); err != nil {
			return err
		}
		if err := requireActiveTenantOwnerTx(tx, tenantID, ownerUserID); err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where("id = ? AND tenant_id = ?", id, tenantID).First(&updated).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrHubProviderPayoutAccountNotFound
			}
			return err
		}
		if err := validateHubTenantPayoutAssetTx(tx, tenantID, input.QRCodeAssetId); err != nil {
			return err
		}
		detailsJSON, err := common.Marshal(input.Details)
		if err != nil {
			return err
		}
		if input.IsDefault {
			if err := tx.Model(&HubTenantPayoutAccount{}).Where("tenant_id = ? AND id <> ?", tenantID, id).Update("is_default", false).Error; err != nil {
				return err
			}
		}
		isDefault := updated.IsDefault || input.IsDefault
		if err := tx.Model(&HubTenantPayoutAccount{}).Where("id = ?", id).Updates(map[string]any{
			"method": input.Method, "details": string(detailsJSON), "qr_code_asset_id": input.QRCodeAssetId,
			"is_default": isDefault, "updated_at": common.GetTimestamp(),
		}).Error; err != nil {
			return err
		}
		return tx.First(&updated, id).Error
	})
	if err != nil {
		return nil, err
	}
	if err := hydrateHubTenantPayoutAccount(&updated); err != nil {
		return nil, err
	}
	return &updated, nil
}

func DeleteHubTenantPayoutAccount(tenantID, ownerUserID, id int) error {
	if tenantID <= 0 || ownerUserID <= 0 || id <= 0 {
		return ErrHubProviderPayoutAccountInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockHubTenantFinanceTx(tx, tenantID); err != nil {
			return err
		}
		if err := requireActiveTenantOwnerTx(tx, tenantID, ownerUserID); err != nil {
			return err
		}
		var account HubTenantPayoutAccount
		if err := lockForUpdate(tx).Where("id = ? AND tenant_id = ?", id, tenantID).First(&account).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrHubProviderPayoutAccountNotFound
			}
			return err
		}
		if err := tx.Delete(&HubTenantPayoutAccount{}, id).Error; err != nil {
			return err
		}
		if !account.IsDefault {
			return nil
		}
		var replacement HubTenantPayoutAccount
		if err := tx.Where("tenant_id = ?", tenantID).Order("id ASC").First(&replacement).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		return tx.Model(&replacement).Updates(map[string]any{"is_default": true, "updated_at": common.GetTimestamp()}).Error
	})
}

func snapshotHubTenantPayoutAccount(account *HubTenantPayoutAccount) (string, error) {
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

func CreateHubTenantWithdrawal(tenantID, ownerUserID, amountQuota, payoutAccountID int) (*HubTenantWithdrawal, error) {
	if tenantID <= 0 || ownerUserID <= 0 || amountQuota <= 0 || payoutAccountID <= 0 {
		return nil, errors.New("invalid hub tenant withdrawal")
	}
	var created HubTenantWithdrawal
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockHubTenantFinanceTx(tx, tenantID); err != nil {
			return err
		}
		if err := requireActiveTenantOwnerTx(tx, tenantID, ownerUserID); err != nil {
			return err
		}
		if amountQuota < hub_provider_settlement_setting.MinimumWithdrawalQuota() {
			return ErrHubTenantWithdrawalBelowMinimum
		}
		var openCount int64
		if err := tx.Model(&HubTenantWithdrawal{}).Where("tenant_id = ? AND status IN ?", tenantID, []string{HubTenantWithdrawalStatusPending, HubTenantWithdrawalStatusApproved}).Count(&openCount).Error; err != nil {
			return err
		}
		if openCount > 0 {
			return ErrHubTenantWithdrawalPending
		}
		settled, transferred, unavailable, err := tenantSettlementIncomeTx(tx, tenantID)
		if err != nil {
			return err
		}
		if amountQuota > settled-transferred-unavailable {
			return ErrHubTenantWithdrawalInsufficient
		}
		account, err := getHubTenantPayoutAccountTx(tx, tenantID, payoutAccountID)
		if err != nil {
			return err
		}
		snapshot, err := snapshotHubTenantPayoutAccount(account)
		if err != nil {
			return err
		}
		created = HubTenantWithdrawal{
			TenantId: tenantID, OwnerUserId: ownerUserID, AmountQuota: amountQuota,
			Status: HubTenantWithdrawalStatusPending, PayoutAccountId: account.Id,
			PayoutMethod: account.Method, PayoutAccountSnapshot: snapshot,
			ApplicantNote: account.MaskedSummary,
		}
		return tx.Create(&created).Error
	})
	if err != nil {
		return nil, err
	}
	if err := hydrateHubTenantWithdrawal(&created); err != nil {
		return nil, err
	}
	return &created, nil
}

func hydrateHubTenantWithdrawal(withdrawal *HubTenantWithdrawal) error {
	withdrawal.PayoutAccount = nil
	if strings.TrimSpace(withdrawal.PayoutAccountSnapshot) == "" {
		return nil
	}
	var snapshot HubProviderPayoutAccountSnapshot
	if err := common.Unmarshal([]byte(withdrawal.PayoutAccountSnapshot), &snapshot); err != nil {
		return fmt.Errorf("decode hub tenant withdrawal payout snapshot: %w", err)
	}
	withdrawal.PayoutAccount = &snapshot
	return nil
}

func ListHubTenantWithdrawals(tenantID, offset, limit int) ([]HubTenantWithdrawal, int64, error) {
	if tenantID <= 0 {
		return nil, 0, ErrTenantNotFound
	}
	query := DB.Model(&HubTenantWithdrawal{}).Where("tenant_id = ?", tenantID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]HubTenantWithdrawal, 0)
	listQuery := query.Order("id DESC")
	if limit > 0 {
		listQuery = listQuery.Limit(limit).Offset(offset)
	}
	if err := listQuery.Find(&items).Error; err != nil {
		return nil, 0, err
	}
	for i := range items {
		if err := hydrateHubTenantWithdrawal(&items[i]); err != nil {
			return nil, 0, err
		}
	}
	return items, total, nil
}

func GetHubTenantWithdrawalByID(id int) (*HubTenantWithdrawal, error) {
	if id <= 0 {
		return nil, ErrHubTenantWithdrawalNotFound
	}
	var withdrawal HubTenantWithdrawal
	if err := DB.First(&withdrawal, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrHubTenantWithdrawalNotFound
		}
		return nil, err
	}
	if err := hydrateHubTenantWithdrawal(&withdrawal); err != nil {
		return nil, err
	}
	return &withdrawal, nil
}

func listAdminHubTenantWithdrawals(status string, offset, limit int, tenantID *int) ([]HubTenantWithdrawalAdminItem, int64, error) {
	query := DB.Table("hub_tenant_withdrawals AS withdrawals").
		Joins("JOIN tenants ON tenants.id = withdrawals.tenant_id").
		Joins("JOIN users ON users.id = withdrawals.owner_user_id")
	if tenantID != nil {
		query = query.Where("withdrawals.tenant_id = ?", *tenantID)
	}
	if IsValidHubTenantWithdrawalStatus(status) {
		query = query.Where("withdrawals.status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]HubTenantWithdrawalAdminItem, 0)
	listQuery := query.Select("withdrawals.*, tenants.name AS tenant_name, tenants.slug AS tenant_slug, users.username AS owner_username, users.email AS owner_email").Order("withdrawals.id DESC")
	if limit > 0 {
		listQuery = listQuery.Limit(limit).Offset(offset)
	}
	if err := listQuery.Scan(&items).Error; err != nil {
		return nil, 0, err
	}
	for i := range items {
		if err := hydrateHubTenantWithdrawal(&items[i].HubTenantWithdrawal); err != nil {
			return nil, 0, err
		}
	}
	return items, total, nil
}

func IsValidHubTenantWithdrawalStatus(status string) bool {
	return status == HubTenantWithdrawalStatusPending || status == HubTenantWithdrawalStatusApproved || status == HubTenantWithdrawalStatusPaid || status == HubTenantWithdrawalStatusRejected
}

func AdminListHubTenantWithdrawals(status string, offset, limit int) ([]HubTenantWithdrawalAdminItem, int64, error) {
	return listAdminHubTenantWithdrawals(status, offset, limit, nil)
}

func AdminListHubTenantWithdrawalsInTenant(status string, offset, limit, tenantID int) ([]HubTenantWithdrawalAdminItem, int64, error) {
	if tenantID <= 0 {
		return nil, 0, ErrTenantNotFound
	}
	return listAdminHubTenantWithdrawals(status, offset, limit, &tenantID)
}

func UpdateHubTenantWithdrawalStatus(id int, status string, adminUserID int, adminRemark string, payment *HubProviderWithdrawalPayment) (*HubTenantWithdrawal, error) {
	if id <= 0 || adminUserID <= 0 || !IsValidHubTenantWithdrawalStatus(status) || status == HubTenantWithdrawalStatusPending {
		return nil, errors.New("invalid hub tenant withdrawal update")
	}
	adminRemark = strings.TrimSpace(adminRemark)
	var normalizedPayment HubProviderWithdrawalPayment
	if status == HubTenantWithdrawalStatusPaid {
		if payment == nil {
			return nil, ErrHubTenantWithdrawalPaymentInvalid
		}
		var err error
		normalizedPayment, err = normalizeHubProviderWithdrawalPayment(*payment)
		if err != nil {
			return nil, ErrHubTenantWithdrawalPaymentInvalid
		}
	}
	var updated HubTenantWithdrawal
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&updated, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrHubTenantWithdrawalNotFound
			}
			return err
		}
		if updated.Status == status {
			return nil
		}
		if (status == HubTenantWithdrawalStatusPaid || status == HubTenantWithdrawalStatusRejected) && adminRemark == "" {
			return ErrHubTenantWithdrawalRemarkRequired
		}
		validTransition := updated.Status == HubTenantWithdrawalStatusPending && (status == HubTenantWithdrawalStatusApproved || status == HubTenantWithdrawalStatusPaid || status == HubTenantWithdrawalStatusRejected)
		validTransition = validTransition || updated.Status == HubTenantWithdrawalStatusApproved && (status == HubTenantWithdrawalStatusPaid || status == HubTenantWithdrawalStatusRejected)
		if !validTransition {
			return ErrHubTenantWithdrawalTransition
		}
		now := common.GetTimestamp()
		updates := map[string]any{"status": status, "admin_user_id": adminUserID, "admin_remark": adminRemark, "updated_at": now}
		if updated.Status == HubTenantWithdrawalStatusPending || status == HubTenantWithdrawalStatusRejected {
			updates["reviewed_at"] = now
		}
		if status == HubTenantWithdrawalStatusPaid {
			updates["paid_at"] = now
			updates["payout_currency"] = normalizedPayment.Currency
			updates["payout_amount_minor"] = normalizedPayment.AmountMinor
			updates["exchange_rate"] = normalizedPayment.ExchangeRate
		}
		if err := tx.Model(&HubTenantWithdrawal{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return err
		}
		return tx.First(&updated, id).Error
	})
	if err != nil {
		return nil, fmt.Errorf("update hub tenant withdrawal: %w", err)
	}
	if err := hydrateHubTenantWithdrawal(&updated); err != nil {
		return nil, err
	}
	return &updated, nil
}
