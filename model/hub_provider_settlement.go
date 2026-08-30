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
package model

import (
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_provider_settlement_setting"
	"gorm.io/gorm"
)

const (
	HubProviderPlatformFeeBasisPoints = hub_provider_settlement_setting.DefaultPlatformFeeBasisPoints

	HubProviderEarningTypeUsage           = "usage"
	HubProviderEarningTypeAdjustment      = "adjustment"
	HubProviderEarningTypeBalanceTransfer = "balance_transfer"

	HubProviderEarningStatusPending   = "pending"
	HubProviderEarningStatusSettled   = "settled"
	HubProviderEarningStatusCancelled = "cancelled"

	HubProviderWithdrawalStatusPending  = "pending"
	HubProviderWithdrawalStatusApproved = "approved"
	HubProviderWithdrawalStatusPaid     = "paid"
	HubProviderWithdrawalStatusRejected = "rejected"
)

var (
	ErrHubProviderEarningReferenceConflict    = errors.New("hub provider earning reference conflict")
	ErrHubProviderEarningCancelled            = errors.New("hub provider earning is cancelled")
	ErrHubProviderEarningAlreadySettled       = errors.New("hub provider earning is already settled")
	ErrHubProviderEarningSettlementDeferred   = errors.New("hub provider earning settlement is deferred")
	ErrHubProviderWithdrawalPending           = errors.New("hub provider already has a pending withdrawal")
	ErrHubProviderWithdrawalNotFound          = errors.New("hub provider withdrawal not found")
	ErrHubProviderWithdrawalBelowMinimum      = errors.New("hub provider withdrawal amount is below the minimum")
	ErrHubProviderWithdrawalInsufficient      = errors.New("hub provider withdrawable balance is insufficient")
	ErrHubProviderWithdrawalTransition        = errors.New("invalid hub provider withdrawal status transition")
	ErrHubProviderWithdrawalPayoutRequired    = errors.New("hub provider withdrawal payout information is required")
	ErrHubProviderWithdrawalRemarkRequired    = errors.New("hub provider withdrawal review remark is required")
	ErrHubProviderWithdrawalPaymentInvalid    = errors.New("hub provider withdrawal payment details are invalid")
	ErrHubProviderBalanceTransferInsufficient = errors.New("hub provider balance transfer amount exceeds withdrawable earnings")
)

var hubProviderPayoutCurrencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

// HubProviderEarning is the provider-side settlement snapshot for one final
// billable request or one administrator adjustment. It intentionally remains
// separate from the consumer wallet balance.
type HubProviderEarning struct {
	Id                 int    `json:"id" gorm:"primaryKey"`
	RequestId          string `json:"request_id" gorm:"type:varchar(96);not null;uniqueIndex"`
	EntryType          string `json:"entry_type" gorm:"type:varchar(24);not null;index"`
	Status             string `json:"status" gorm:"type:varchar(24);not null;index"`
	SettlementDeferred *bool  `json:"settlement_deferred,omitempty" gorm:"index"`
	ProviderId         int    `json:"provider_id" gorm:"not null;index"`
	TenantId           int    `json:"tenant_id" gorm:"not null;default:0;index"`
	OwnerUserId        int    `json:"owner_user_id" gorm:"not null;index"`
	ConsumerUserId     int    `json:"consumer_user_id" gorm:"not null;index"`
	TokenId            int    `json:"token_id" gorm:"not null;default:0;index"`
	SupplyGroupId      int    `json:"supply_group_id" gorm:"not null;default:0;index"`
	ChannelId          int    `json:"channel_id" gorm:"not null;default:0;index"`
	ModelName          string `json:"model_name" gorm:"type:varchar(255);not null;default:'';index"`
	BillingSource      string `json:"billing_source" gorm:"type:varchar(24);not null;default:''"`
	GrossQuota         int    `json:"gross_quota" gorm:"not null;default:0"`
	// ProviderServiceFeeBasisPoints is the share paid by the user-side
	// marketplace to the serving provider's tenant before the platform cut.
	ProviderServiceFeeBasisPoints int     `json:"provider_service_fee_basis_points" gorm:"not null;default:0"`
	PlatformFeeBasisPoints        int     `json:"platform_fee_basis_points" gorm:"not null;default:0"`
	PlatformFeeQuota              int     `json:"platform_fee_quota" gorm:"not null;default:0"`
	ProviderIncomeQuota           int     `json:"provider_income_quota" gorm:"not null;default:0"`
	ResellerGrossQuota            int     `json:"reseller_gross_quota" gorm:"not null;default:0"`
	ResellerNetIncomeQuota        int     `json:"reseller_net_income_quota" gorm:"not null;default:0"`
	SettlementVersion             int     `json:"settlement_version" gorm:"not null;default:0"`
	ReferralProviderId            int     `json:"referral_provider_id" gorm:"not null;default:0;index"`
	ReferralOwnerUserId           int     `json:"-" gorm:"not null;default:0;index"`
	ReferralBasisPoints           int     `json:"referral_basis_points" gorm:"not null;default:0"`
	ReferralIncomeQuota           int     `json:"referral_income_quota" gorm:"not null;default:0"`
	BaseGroupRatio                float64 `json:"base_group_ratio" gorm:"type:real;not null;default:0"`
	SupplyMultiplier              float64 `json:"supply_multiplier" gorm:"type:real;not null;default:0"`
	BillingRatio                  float64 `json:"billing_ratio" gorm:"type:real;not null;default:0"`
	OperatorUserId                int     `json:"operator_user_id" gorm:"not null;default:0"`
	Remark                        string  `json:"remark" gorm:"type:varchar(1000);not null;default:''"`
	SettledAt                     int64   `json:"settled_at" gorm:"bigint;not null;default:0"`
	CancelledAt                   int64   `json:"cancelled_at" gorm:"bigint;not null;default:0"`
	CreatedAt                     int64   `json:"created_at" gorm:"bigint;not null"`
	UpdatedAt                     int64   `json:"updated_at" gorm:"bigint;not null"`
	EarningRole                   string  `json:"earning_role,omitempty" gorm:"-"`
}

func (HubProviderEarning) TableName() string {
	return "hub_provider_earnings"
}

func (earning *HubProviderEarning) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if earning.EntryType == "" {
		earning.EntryType = HubProviderEarningTypeUsage
	}
	if earning.Status == "" {
		earning.Status = HubProviderEarningStatusPending
	}
	earning.CreatedAt = now
	earning.UpdatedAt = now
	return nil
}

type HubProviderWithdrawal struct {
	Id                    int                               `json:"id" gorm:"primaryKey"`
	ProviderId            int                               `json:"provider_id" gorm:"not null;index"`
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

func (HubProviderWithdrawal) TableName() string {
	return "hub_provider_withdrawals"
}

func (withdrawal *HubProviderWithdrawal) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if withdrawal.Status == "" {
		withdrawal.Status = HubProviderWithdrawalStatusPending
	}
	withdrawal.CreatedAt = now
	withdrawal.UpdatedAt = now
	return nil
}

func hydrateHubProviderWithdrawal(withdrawal *HubProviderWithdrawal) error {
	withdrawal.PayoutAccount = nil
	if strings.TrimSpace(withdrawal.PayoutAccountSnapshot) == "" {
		return nil
	}
	var snapshot HubProviderPayoutAccountSnapshot
	if err := common.Unmarshal([]byte(withdrawal.PayoutAccountSnapshot), &snapshot); err != nil {
		return fmt.Errorf("decode hub provider withdrawal payout snapshot: %w", err)
	}
	withdrawal.PayoutAccount = &snapshot
	return nil
}

type HubProviderWithdrawalPayment struct {
	Currency     string
	AmountMinor  int64
	ExchangeRate string
}

func normalizeHubProviderWithdrawalPayment(payment HubProviderWithdrawalPayment) (HubProviderWithdrawalPayment, error) {
	payment.Currency = strings.ToUpper(strings.TrimSpace(payment.Currency))
	payment.ExchangeRate = strings.TrimSpace(payment.ExchangeRate)
	if !hubProviderPayoutCurrencyPattern.MatchString(payment.Currency) || payment.AmountMinor <= 0 {
		return payment, ErrHubProviderWithdrawalPaymentInvalid
	}
	rate, ok := new(big.Rat).SetString(payment.ExchangeRate)
	if !ok || rate.Sign() <= 0 {
		return payment, ErrHubProviderWithdrawalPaymentInvalid
	}
	return payment, nil
}

type HubProviderEarningParams struct {
	RequestId                        string
	ProviderId                       int
	OwnerUserId                      int
	ConsumerUserId                   int
	TokenId                          int
	SupplyGroupId                    int
	ChannelId                        int
	ModelName                        string
	BillingSource                    string
	GrossQuota                       int
	BaseGroupRatio                   float64
	SupplyMultiplier                 float64
	BillingRatio                     float64
	TenantId                         int
	ProviderServiceFeeBasisPoints    int
	HasProviderServiceFeeBasisPoints bool
	PlatformFeeBasisPoints           int
	HasPlatformFeeBasisPoints        bool
	ReferralProviderId               int
	ReferralBasisPoints              int
	SettlementDeferred               *bool
}

type HubProviderSettlementSummary struct {
	ProviderId                    int `json:"provider_id"`
	GrossQuota                    int `json:"gross_quota"`
	PlatformFeeQuota              int `json:"platform_fee_quota"`
	ResellerGrossQuota            int `json:"reseller_gross_quota"`
	ResellerNetIncomeQuota        int `json:"reseller_net_income_quota"`
	ProviderServiceFeeBasisPoints int `json:"provider_service_fee_basis_points"`
	SettledIncomeQuota            int `json:"settled_income_quota"`
	PendingIncomeQuota            int `json:"pending_income_quota"`
	ReservedWithdrawalQuota       int `json:"reserved_withdrawal_quota"`
	PaidWithdrawalQuota           int `json:"paid_withdrawal_quota"`
	TransferredBalanceQuota       int `json:"transferred_balance_quota"`
	WithdrawableQuota             int `json:"withdrawable_quota"`
	PlatformFeeBasisPoints        int `json:"platform_fee_basis_points"`
	MinimumWithdrawalQuota        int `json:"minimum_withdrawal_quota"`
	ReferralIncomeQuota           int `json:"referral_income_quota"`
}

type HubProviderWithdrawalAdminItem struct {
	HubProviderWithdrawal
	ProviderName  string `json:"provider_name" gorm:"column:provider_name"`
	OwnerUsername string `json:"owner_username" gorm:"column:owner_username"`
	OwnerEmail    string `json:"owner_email" gorm:"column:owner_email"`
}

func CalculateHubProviderRevenueSplit(grossQuota int, feeBasisPoints int) (int, int) {
	if grossQuota <= 0 {
		return 0, 0
	}
	if feeBasisPoints < 0 {
		feeBasisPoints = 0
	}
	if feeBasisPoints > 10000 {
		feeBasisPoints = 10000
	}
	platformFee := int((int64(grossQuota)*int64(feeBasisPoints) + 5000) / 10000)
	return platformFee, grossQuota - platformFee
}

func CalculateHubProviderRevenueSplitWithReferral(grossQuota, feeBasisPoints, referralBasisPoints int) (int, int, int) {
	platformFee, providerIncome := CalculateHubProviderRevenueSplit(grossQuota, feeBasisPoints)
	if providerIncome <= 0 || referralBasisPoints <= 0 {
		return platformFee, providerIncome, 0
	}
	if referralBasisPoints > 10000 {
		referralBasisPoints = 10000
	}
	referralIncome := int((int64(grossQuota)*int64(referralBasisPoints) + 5000) / 10000)
	if referralIncome > providerIncome {
		referralIncome = providerIncome
	}
	return platformFee, providerIncome - referralIncome, referralIncome
}

// CalculateHubProviderTwoLayerRevenueSplit splits one successful user charge
// into the serving provider, the tenant reseller, and the platform. The
// platform fee is calculated from resellerGrossQuota, never directly from the
// user charge.
func CalculateHubProviderTwoLayerRevenueSplit(grossQuota, providerServiceFeeBasisPoints, platformFeeBasisPoints, referralBasisPoints int) (platformFee, providerIncome, referralIncome, resellerGross, resellerNet int) {
	if grossQuota <= 0 {
		return 0, 0, 0, 0, 0
	}
	providerServiceFeeBasisPoints = clampHubProviderBasisPoints(providerServiceFeeBasisPoints)
	platformFeeBasisPoints = clampHubProviderBasisPoints(platformFeeBasisPoints)
	resellerGross = int((int64(grossQuota)*int64(providerServiceFeeBasisPoints) + 5000) / 10000)
	providerGross := grossQuota - resellerGross
	platformFee = int((int64(resellerGross)*int64(platformFeeBasisPoints) + 5000) / 10000)
	resellerNet = resellerGross - platformFee
	if providerGross > 0 && referralBasisPoints > 0 {
		referralIncome = int((int64(grossQuota)*int64(clampHubProviderBasisPoints(referralBasisPoints)) + 5000) / 10000)
		if referralIncome > providerGross {
			referralIncome = providerGross
		}
	}
	providerIncome = providerGross - referralIncome
	return platformFee, providerIncome, referralIncome, resellerGross, resellerNet
}

func clampHubProviderBasisPoints(value int) int {
	if value < 0 {
		return 0
	}
	if value > 10000 {
		return 10000
	}
	return value
}

func calculateHubProviderEarningRevenueSplit(tx *gorm.DB, earning HubProviderEarning, grossQuota int) (int, int, int, int, int, error) {
	referralBasisPoints := earning.ReferralBasisPoints
	if referralBasisPoints > 0 && earning.ReferralProviderId > 0 {
		var referralProvider HubProvider
		err := lockForUpdate(tx).
			Select("id", "owner_user_id", "status").
			First(&referralProvider, earning.ReferralProviderId).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, 0, 0, 0, 0, err
		}
		if err != nil || referralProvider.Status != HubProviderStatusActive ||
			referralProvider.OwnerUserId != earning.ReferralOwnerUserId {
			referralBasisPoints = 0
		}
	}
	if earning.SettlementVersion < 2 {
		platformFee, providerIncome, referralIncome := CalculateHubProviderRevenueSplitWithReferral(
			grossQuota,
			earning.PlatformFeeBasisPoints,
			referralBasisPoints,
		)
		return platformFee, providerIncome, referralIncome, 0, 0, nil
	}
	platformFee, providerIncome, referralIncome, resellerGross, resellerNet := CalculateHubProviderTwoLayerRevenueSplit(
		grossQuota,
		earning.ProviderServiceFeeBasisPoints,
		earning.PlatformFeeBasisPoints,
		referralBasisPoints,
	)
	return platformFee, providerIncome, referralIncome, resellerGross, resellerNet, nil
}

func ResolveHubProviderPlatformFeeBasisPoints(providerId int) (int, error) {
	globalFee := hub_provider_settlement_setting.PlatformFeeBasisPoints()
	if providerId <= 0 {
		return globalFee, nil
	}
	var provider HubProvider
	err := DB.Select("id", "platform_fee_basis_points").First(&provider, providerId).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return globalFee, nil
	}
	if err != nil {
		return 0, err
	}
	if provider.PlatformFeeBasisPoints == nil {
		return globalFee, nil
	}
	override := *provider.PlatformFeeBasisPoints
	if override < 0 || override > 10000 {
		return globalFee, nil
	}
	return override, nil
}

// ResolveHubProviderServiceFeeBasisPoints resolves the rate paid to the
// provider's tenant. The existing provider column remains the per-provider
// override for compatibility with the first settlement version.
func ResolveHubProviderServiceFeeBasisPoints(providerId int) (int, error) {
	globalFee := hub_provider_settlement_setting.ProviderServiceFeeBasisPoints()
	if providerId <= 0 {
		return globalFee, nil
	}
	var provider HubProvider
	err := DB.Select("id", "platform_fee_basis_points").First(&provider, providerId).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return globalFee, nil
	}
	if err != nil {
		return 0, err
	}
	if provider.PlatformFeeBasisPoints == nil {
		return globalFee, nil
	}
	override := *provider.PlatformFeeBasisPoints
	if override < 0 || override > 10000 {
		return globalFee, nil
	}
	return override, nil
}

func ResolveHubProviderTenantId(providerId int) (int, error) {
	if providerId <= 0 {
		return 0, nil
	}
	var provider HubProvider
	if err := DB.Select("id", "tenant_id").First(&provider, providerId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, nil
		}
		return 0, err
	}
	if provider.TenantId == nil {
		return 0, nil
	}
	return *provider.TenantId, nil
}

func PrepareHubProviderEarning(params HubProviderEarningParams) (*HubProviderEarning, error) {
	params.RequestId = strings.TrimSpace(params.RequestId)
	if params.RequestId == "" || params.ProviderId <= 0 || params.OwnerUserId <= 0 ||
		params.SupplyGroupId <= 0 || params.ChannelId <= 0 || params.GrossQuota <= 0 {
		return nil, errors.New("invalid hub provider earning")
	}
	platformFeeBasisPoints := params.PlatformFeeBasisPoints
	if !params.HasPlatformFeeBasisPoints {
		var err error
		tenantId := params.TenantId
		if tenantId <= 0 {
			tenantId, err = ResolveHubProviderTenantId(params.ProviderId)
			if err != nil {
				return nil, err
			}
		}
		if tenantId > 0 {
			platformFeeBasisPoints, err = ResolveHubTenantPlatformFeeBasisPoints(tenantId)
		} else {
			platformFeeBasisPoints, err = ResolveHubProviderPlatformFeeBasisPoints(params.ProviderId)
		}
		if err != nil {
			return nil, err
		}
	} else if platformFeeBasisPoints < 0 || platformFeeBasisPoints > 10000 {
		return nil, errors.New("invalid hub provider platform fee snapshot")
	}
	providerServiceFeeBasisPoints := params.ProviderServiceFeeBasisPoints
	if !params.HasProviderServiceFeeBasisPoints {
		var err error
		providerServiceFeeBasisPoints, err = ResolveHubProviderServiceFeeBasisPoints(params.ProviderId)
		if err != nil {
			return nil, err
		}
	} else if providerServiceFeeBasisPoints < 0 || providerServiceFeeBasisPoints > 10000 {
		return nil, errors.New("invalid hub provider service fee snapshot")
	}
	tenantId := params.TenantId
	if tenantId <= 0 {
		var err error
		tenantId, err = ResolveHubProviderTenantId(params.ProviderId)
		if err != nil {
			return nil, err
		}
	}
	// A two-layer split is only valid after the provider has an explicit
	// tenant owner. This keeps migration-era records on their old semantics.
	useTwoLayerSettlement := params.HasProviderServiceFeeBasisPoints && tenantId > 0
	referralProviderId := 0
	referralOwnerUserId := 0
	referralBasisPoints := 0
	if params.ReferralProviderId > 0 && params.ReferralProviderId != params.ProviderId && params.ReferralBasisPoints > 0 {
		if params.ReferralBasisPoints > 10000 {
			return nil, errors.New("invalid fallback referral commission snapshot")
		}
		var referralProvider HubProvider
		err := DB.Select("id", "owner_user_id", "status").First(&referralProvider, params.ReferralProviderId).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		if err == nil && referralProvider.Status == HubProviderStatusActive && referralProvider.OwnerUserId > 0 {
			referralProviderId = referralProvider.Id
			referralOwnerUserId = referralProvider.OwnerUserId
			referralBasisPoints = params.ReferralBasisPoints
		}
	}
	platformFee, providerIncome, referralIncome := CalculateHubProviderRevenueSplitWithReferral(
		params.GrossQuota,
		platformFeeBasisPoints,
		referralBasisPoints,
	)
	resellerGross, resellerNet := 0, 0
	settlementVersion := 0
	if useTwoLayerSettlement {
		platformFee, providerIncome, referralIncome, resellerGross, resellerNet = CalculateHubProviderTwoLayerRevenueSplit(
			params.GrossQuota,
			providerServiceFeeBasisPoints,
			platformFeeBasisPoints,
			referralBasisPoints,
		)
		settlementVersion = 2
	} else {
		providerServiceFeeBasisPoints = 0
	}
	earning := &HubProviderEarning{
		RequestId:                     params.RequestId,
		EntryType:                     HubProviderEarningTypeUsage,
		Status:                        HubProviderEarningStatusPending,
		SettlementDeferred:            params.SettlementDeferred,
		ProviderId:                    params.ProviderId,
		TenantId:                      tenantId,
		OwnerUserId:                   params.OwnerUserId,
		ConsumerUserId:                params.ConsumerUserId,
		TokenId:                       params.TokenId,
		SupplyGroupId:                 params.SupplyGroupId,
		ChannelId:                     params.ChannelId,
		ModelName:                     strings.TrimSpace(params.ModelName),
		BillingSource:                 strings.TrimSpace(params.BillingSource),
		GrossQuota:                    params.GrossQuota,
		ProviderServiceFeeBasisPoints: providerServiceFeeBasisPoints,
		PlatformFeeBasisPoints:        platformFeeBasisPoints,
		PlatformFeeQuota:              platformFee,
		ProviderIncomeQuota:           providerIncome,
		ResellerGrossQuota:            resellerGross,
		ResellerNetIncomeQuota:        resellerNet,
		ReferralProviderId:            referralProviderId,
		ReferralOwnerUserId:           referralOwnerUserId,
		ReferralBasisPoints:           referralBasisPoints,
		ReferralIncomeQuota:           referralIncome,
		BaseGroupRatio:                params.BaseGroupRatio,
		SupplyMultiplier:              params.SupplyMultiplier,
		BillingRatio:                  params.BillingRatio,
		SettlementVersion:             settlementVersion,
	}
	if err := DB.Create(earning).Error; err == nil {
		return earning, nil
	}

	var existing HubProviderEarning
	if err := DB.Where("request_id = ?", params.RequestId).First(&existing).Error; err != nil {
		return nil, err
	}
	if existing.ProviderId != params.ProviderId || existing.OwnerUserId != params.OwnerUserId ||
		existing.ConsumerUserId != params.ConsumerUserId || existing.ChannelId != params.ChannelId ||
		existing.SupplyGroupId != params.SupplyGroupId || existing.TokenId != params.TokenId ||
		existing.ModelName != strings.TrimSpace(params.ModelName) ||
		existing.EntryType != HubProviderEarningTypeUsage {
		return nil, ErrHubProviderEarningReferenceConflict
	}
	if existing.Status == HubProviderEarningStatusCancelled {
		now := common.GetTimestamp()
		result := DB.Model(&HubProviderEarning{}).
			Where("id = ? AND status = ?", existing.Id, HubProviderEarningStatusCancelled).
			Updates(map[string]any{
				"status":                            HubProviderEarningStatusPending,
				"settlement_deferred":               params.SettlementDeferred,
				"billing_source":                    strings.TrimSpace(params.BillingSource),
				"gross_quota":                       params.GrossQuota,
				"tenant_id":                         tenantId,
				"provider_service_fee_basis_points": providerServiceFeeBasisPoints,
				"platform_fee_basis_points":         platformFeeBasisPoints,
				"platform_fee_quota":                platformFee,
				"provider_income_quota":             providerIncome,
				"reseller_gross_quota":              resellerGross,
				"reseller_net_income_quota":         resellerNet,
				"settlement_version":                settlementVersion,
				"referral_provider_id":              referralProviderId,
				"referral_owner_user_id":            referralOwnerUserId,
				"referral_basis_points":             referralBasisPoints,
				"referral_income_quota":             referralIncome,
				"base_group_ratio":                  params.BaseGroupRatio,
				"supply_multiplier":                 params.SupplyMultiplier,
				"billing_ratio":                     params.BillingRatio,
				"settled_at":                        0,
				"cancelled_at":                      0,
				"updated_at":                        now,
			})
		if result.Error != nil {
			return nil, result.Error
		}
		if err := DB.First(&existing, existing.Id).Error; err != nil {
			return nil, err
		}
	}
	return &existing, nil
}

func SettleHubProviderEarning(requestId string, grossQuota int) error {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" || grossQuota <= 0 {
		return errors.New("invalid hub provider earning settlement")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var earning HubProviderEarning
		if err := lockForUpdate(tx).Where("request_id = ?", requestId).First(&earning).Error; err != nil {
			return err
		}
		if earning.Status == HubProviderEarningStatusCancelled {
			return ErrHubProviderEarningCancelled
		}
		if earning.SettlementDeferred != nil && *earning.SettlementDeferred {
			return ErrHubProviderEarningSettlementDeferred
		}
		if earning.Status == HubProviderEarningStatusSettled {
			platformFee, providerIncome, referralIncome, resellerGross, resellerNet, err := calculateHubProviderEarningRevenueSplit(tx, earning, grossQuota)
			if err != nil {
				return err
			}
			if earning.GrossQuota != grossQuota || earning.PlatformFeeQuota != platformFee ||
				earning.ProviderIncomeQuota != providerIncome || earning.ReferralIncomeQuota != referralIncome ||
				earning.SettlementVersion >= 2 && (earning.ResellerGrossQuota != resellerGross || earning.ResellerNetIncomeQuota != resellerNet) {
				return ErrHubProviderEarningReferenceConflict
			}
			return nil
		}
		platformFee, providerIncome, referralIncome, resellerGross, resellerNet, err := calculateHubProviderEarningRevenueSplit(tx, earning, grossQuota)
		if err != nil {
			return err
		}
		now := common.GetTimestamp()
		return tx.Model(&HubProviderEarning{}).Where("id = ?", earning.Id).Updates(map[string]any{
			"status":                    HubProviderEarningStatusSettled,
			"gross_quota":               grossQuota,
			"platform_fee_quota":        platformFee,
			"provider_income_quota":     providerIncome,
			"referral_income_quota":     referralIncome,
			"reseller_gross_quota":      resellerGross,
			"reseller_net_income_quota": resellerNet,
			"settled_at":                now,
			"updated_at":                now,
		}).Error
	})
}

// MarkHubProviderEarningReady atomically publishes the final gross amount and
// releases a deferred earning after consumer billing is durable.
func MarkHubProviderEarningReady(requestId string, grossQuota int) error {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" || grossQuota <= 0 {
		return errors.New("invalid hub provider earning release")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var earning HubProviderEarning
		if err := lockForUpdate(tx).Where("request_id = ?", requestId).First(&earning).Error; err != nil {
			return err
		}
		switch earning.Status {
		case HubProviderEarningStatusSettled:
			if earning.GrossQuota != grossQuota {
				return ErrHubProviderEarningReferenceConflict
			}
			return nil
		case HubProviderEarningStatusCancelled:
			return ErrHubProviderEarningCancelled
		}
		platformFee, providerIncome, referralIncome, resellerGross, resellerNet, err := calculateHubProviderEarningRevenueSplit(tx, earning, grossQuota)
		if err != nil {
			return err
		}
		falseValue := false
		result := tx.Model(&HubProviderEarning{}).
			Where("id = ? AND status = ?", earning.Id, HubProviderEarningStatusPending).
			Updates(map[string]any{
				"settlement_deferred":       &falseValue,
				"gross_quota":               grossQuota,
				"platform_fee_quota":        platformFee,
				"provider_income_quota":     providerIncome,
				"referral_income_quota":     referralIncome,
				"reseller_gross_quota":      resellerGross,
				"reseller_net_income_quota": resellerNet,
				"updated_at":                common.GetTimestamp(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrHubProviderEarningReferenceConflict
		}
		return nil
	})
}

func ListReadyPendingHubProviderEarnings(limit int) ([]HubProviderEarning, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	var earnings []HubProviderEarning
	err := DB.Where("status = ? AND settlement_deferred = ?", HubProviderEarningStatusPending, false).
		Order("id asc").Limit(limit).Find(&earnings).Error
	return earnings, err
}

func HasReadyPendingHubProviderEarnings() (bool, error) {
	var count int64
	err := DB.Model(&HubProviderEarning{}).
		Where("status = ? AND settlement_deferred = ?", HubProviderEarningStatusPending, false).
		Count(&count).Error
	return count > 0, err
}

func CancelHubProviderEarning(requestId string) error {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		return cancelHubProviderEarningTx(tx, requestId)
	})
}

func cancelHubProviderEarningTx(tx *gorm.DB, requestId string) error {
	var earning HubProviderEarning
	err := lockForUpdate(tx).Where("request_id = ?", requestId).First(&earning).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	switch earning.Status {
	case HubProviderEarningStatusCancelled:
		return nil
	case HubProviderEarningStatusSettled:
		return ErrHubProviderEarningAlreadySettled
	case HubProviderEarningStatusPending:
	default:
		return ErrHubProviderEarningReferenceConflict
	}
	now := common.GetTimestamp()
	result := tx.Model(&HubProviderEarning{}).
		Where("id = ? AND status = ?", earning.Id, HubProviderEarningStatusPending).
		Updates(map[string]any{
			"status":       HubProviderEarningStatusCancelled,
			"cancelled_at": now,
			"updated_at":   now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrHubProviderEarningReferenceConflict
	}
	return nil
}

func CreateHubProviderManualAdjustment(providerId, amountQuota, operatorUserId int, remark string) (*HubProviderEarning, error) {
	if providerId <= 0 || amountQuota == 0 || operatorUserId <= 0 || strings.TrimSpace(remark) == "" {
		return nil, errors.New("invalid hub provider earning adjustment")
	}
	var provider HubProvider
	if err := DB.First(&provider, providerId).Error; err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	earning := &HubProviderEarning{
		RequestId:           "adjustment:" + common.GetUUID(),
		EntryType:           HubProviderEarningTypeAdjustment,
		Status:              HubProviderEarningStatusSettled,
		ProviderId:          provider.Id,
		OwnerUserId:         provider.OwnerUserId,
		ProviderIncomeQuota: amountQuota,
		OperatorUserId:      operatorUserId,
		Remark:              strings.TrimSpace(remark),
		SettledAt:           now,
	}
	if err := DB.Create(earning).Error; err != nil {
		return nil, err
	}
	return earning, nil
}

func CreateHubProviderBalanceTransfer(providerId, ownerUserId, amountQuota int, idempotencyKey string) (*HubProviderEarning, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if providerId <= 0 || ownerUserId <= 0 || amountQuota <= 0 || idempotencyKey == "" || len(idempotencyKey) > 48 {
		return nil, errors.New("invalid hub provider balance transfer")
	}
	requestId := fmt.Sprintf("balance-transfer:%d:%d:%s", providerId, ownerUserId, idempotencyKey)
	var transfer HubProviderEarning
	err := DB.Transaction(func(tx *gorm.DB) error {
		var provider HubProvider
		if err := lockForUpdate(tx).Where("id = ? AND owner_user_id = ?", providerId, ownerUserId).First(&provider).Error; err != nil {
			return err
		}

		var existing HubProviderEarning
		if err := tx.Where("request_id = ?", requestId).First(&existing).Error; err == nil {
			if existing.ProviderId != provider.Id || existing.OwnerUserId != ownerUserId ||
				existing.EntryType != HubProviderEarningTypeBalanceTransfer ||
				existing.Status != HubProviderEarningStatusSettled ||
				existing.ProviderIncomeQuota != -amountQuota {
				return ErrHubProviderEarningReferenceConflict
			}
			transfer = existing
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		type quotaSum struct {
			Value int `gorm:"column:value"`
		}
		var earned quotaSum
		if err := tx.Model(&HubProviderEarning{}).
			Select(
				"COALESCE(SUM(CASE WHEN provider_id = ? THEN provider_income_quota ELSE 0 END + "+
					"CASE WHEN referral_provider_id = ? THEN referral_income_quota ELSE 0 END), 0) AS value",
				provider.Id,
				provider.Id,
			).
			Where("status = ? AND (provider_id = ? OR referral_provider_id = ?)", HubProviderEarningStatusSettled, provider.Id, provider.Id).
			Scan(&earned).Error; err != nil {
			return err
		}
		var unavailable quotaSum
		if err := tx.Model(&HubProviderWithdrawal{}).
			Select("COALESCE(SUM(amount_quota), 0) AS value").
			Where("provider_id = ? AND status <> ?", provider.Id, HubProviderWithdrawalStatusRejected).
			Scan(&unavailable).Error; err != nil {
			return err
		}
		if amountQuota > earned.Value-unavailable.Value {
			return ErrHubProviderBalanceTransferInsufficient
		}

		now := common.GetTimestamp()
		transfer = HubProviderEarning{
			RequestId:           requestId,
			EntryType:           HubProviderEarningTypeBalanceTransfer,
			Status:              HubProviderEarningStatusSettled,
			ProviderId:          provider.Id,
			OwnerUserId:         ownerUserId,
			BillingSource:       "provider_earnings",
			ProviderIncomeQuota: -amountQuota,
			OperatorUserId:      ownerUserId,
			Remark:              "Transferred provider earnings to account balance",
			SettledAt:           now,
		}
		if err := tx.Create(&transfer).Error; err != nil {
			return err
		}
		result := tx.Model(&User{}).
			Where("id = ?", ownerUserId).
			Update("quota", gorm.Expr("quota + ?", amountQuota))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("hub provider owner user not found")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	var userQuota int
	if err := DB.Model(&User{}).Where("id = ?", ownerUserId).Select("quota").Scan(&userQuota).Error; err != nil {
		common.SysLog("failed to load user quota after provider balance transfer: " + err.Error())
	} else if err := updateUserQuotaCache(ownerUserId, userQuota); err != nil {
		common.SysLog("failed to update user quota cache after provider balance transfer: " + err.Error())
	}
	return &transfer, nil
}

func listHubProviderEarnings(providerId, offset, limit int, sanitize bool) ([]HubProviderEarning, int64, error) {
	query := DB.Model(&HubProviderEarning{}).
		Where("provider_id = ? OR (referral_provider_id = ? AND referral_income_quota > 0)", providerId, providerId)
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
		items[index].EarningRole = "service"
		if items[index].ProviderId != providerId && items[index].ReferralProviderId == providerId {
			items[index].EarningRole = "referral"
			if !sanitize {
				continue
			}
			items[index].ProviderId = providerId
			items[index].OwnerUserId = items[index].ReferralOwnerUserId
			items[index].ConsumerUserId = 0
			items[index].TokenId = 0
			items[index].SupplyGroupId = 0
			items[index].ChannelId = 0
			items[index].BillingSource = ""
			items[index].PlatformFeeBasisPoints = 0
			items[index].PlatformFeeQuota = 0
			items[index].ProviderIncomeQuota = items[index].ReferralIncomeQuota
			items[index].BaseGroupRatio = 0
			items[index].SupplyMultiplier = 0
			items[index].BillingRatio = 0
		}
		if sanitize {
			items[index].ReferralProviderId = 0
		}
	}
	return items, total, nil
}

// ListHubProviderEarnings returns the provider-facing ledger projection. It
// hides the other provider's channel and ownership details on referral rows.
func ListHubProviderEarnings(providerId, offset, limit int) ([]HubProviderEarning, int64, error) {
	return listHubProviderEarnings(providerId, offset, limit, true)
}

// ListHubProviderEarningsForAdmin preserves the original settlement snapshot
// so administrators can audit both sides of a fallback referral split.
func ListHubProviderEarningsForAdmin(providerId, offset, limit int) ([]HubProviderEarning, int64, error) {
	return listHubProviderEarnings(providerId, offset, limit, false)
}

func GetHubProviderSettlementSummary(providerId int) (HubProviderSettlementSummary, error) {
	summary := HubProviderSettlementSummary{
		ProviderId:             providerId,
		MinimumWithdrawalQuota: hub_provider_settlement_setting.MinimumWithdrawalQuota(),
	}
	if providerId <= 0 {
		return summary, errors.New("invalid hub provider")
	}
	feeBasisPoints, err := ResolveHubProviderPlatformFeeBasisPoints(providerId)
	if err != nil {
		return summary, err
	}
	summary.PlatformFeeBasisPoints = feeBasisPoints
	providerServiceFeeBasisPoints, err := ResolveHubProviderServiceFeeBasisPoints(providerId)
	if err != nil {
		return summary, err
	}
	summary.ProviderServiceFeeBasisPoints = providerServiceFeeBasisPoints
	type earningSums struct {
		GrossQuota              int `gorm:"column:gross_quota"`
		PlatformFeeQuota        int `gorm:"column:platform_fee_quota"`
		ResellerGrossQuota      int `gorm:"column:reseller_gross_quota"`
		ResellerNetIncomeQuota  int `gorm:"column:reseller_net_income_quota"`
		SettledIncomeQuota      int `gorm:"column:settled_income_quota"`
		PendingIncomeQuota      int `gorm:"column:pending_income_quota"`
		TransferredBalanceQuota int `gorm:"column:transferred_balance_quota"`
		ReferralIncomeQuota     int `gorm:"column:referral_income_quota"`
	}
	var earnings earningSums
	if err := DB.Model(&HubProviderEarning{}).
		Select(
			"COALESCE(SUM(CASE WHEN provider_id = ? AND status = ? THEN gross_quota ELSE 0 END), 0) AS gross_quota, "+
				"COALESCE(SUM(CASE WHEN provider_id = ? AND status = ? THEN platform_fee_quota ELSE 0 END), 0) AS platform_fee_quota, "+
				"COALESCE(SUM(CASE WHEN provider_id = ? AND status = ? THEN reseller_gross_quota ELSE 0 END), 0) AS reseller_gross_quota, "+
				"COALESCE(SUM(CASE WHEN provider_id = ? AND status = ? THEN reseller_net_income_quota ELSE 0 END), 0) AS reseller_net_income_quota, "+
				"COALESCE(SUM(CASE WHEN status = ? AND entry_type <> ? THEN "+
				"(CASE WHEN provider_id = ? THEN provider_income_quota ELSE 0 END + CASE WHEN referral_provider_id = ? THEN referral_income_quota ELSE 0 END) ELSE 0 END), 0) AS settled_income_quota, "+
				"COALESCE(SUM(CASE WHEN status = ? AND entry_type <> ? THEN "+
				"(CASE WHEN provider_id = ? THEN provider_income_quota ELSE 0 END + CASE WHEN referral_provider_id = ? THEN referral_income_quota ELSE 0 END) ELSE 0 END), 0) AS pending_income_quota, "+
				"COALESCE(SUM(CASE WHEN provider_id = ? AND status = ? AND entry_type = ? THEN -provider_income_quota ELSE 0 END), 0) AS transferred_balance_quota, "+
				"COALESCE(SUM(CASE WHEN referral_provider_id = ? AND status = ? THEN referral_income_quota ELSE 0 END), 0) AS referral_income_quota",
			providerId,
			HubProviderEarningStatusSettled,
			providerId,
			HubProviderEarningStatusSettled,
			providerId,
			HubProviderEarningStatusSettled,
			providerId,
			HubProviderEarningStatusSettled,
			HubProviderEarningStatusSettled,
			HubProviderEarningTypeBalanceTransfer,
			providerId,
			providerId,
			HubProviderEarningStatusPending,
			HubProviderEarningTypeBalanceTransfer,
			providerId,
			providerId,
			providerId,
			HubProviderEarningStatusSettled,
			HubProviderEarningTypeBalanceTransfer,
			providerId,
			HubProviderEarningStatusSettled,
		).
		Where("provider_id = ? OR referral_provider_id = ?", providerId, providerId).
		Scan(&earnings).Error; err != nil {
		return summary, err
	}

	type withdrawalSums struct {
		ReservedQuota int `gorm:"column:reserved_quota"`
		PaidQuota     int `gorm:"column:paid_quota"`
	}
	var withdrawals withdrawalSums
	if err := DB.Model(&HubProviderWithdrawal{}).
		Select(
			"COALESCE(SUM(CASE WHEN status IN ? THEN amount_quota ELSE 0 END), 0) AS reserved_quota, "+
				"COALESCE(SUM(CASE WHEN status = ? THEN amount_quota ELSE 0 END), 0) AS paid_quota",
			[]string{HubProviderWithdrawalStatusPending, HubProviderWithdrawalStatusApproved},
			HubProviderWithdrawalStatusPaid,
		).
		Where("provider_id = ?", providerId).
		Scan(&withdrawals).Error; err != nil {
		return summary, err
	}

	summary.GrossQuota = earnings.GrossQuota
	summary.PlatformFeeQuota = earnings.PlatformFeeQuota
	summary.ResellerGrossQuota = earnings.ResellerGrossQuota
	summary.ResellerNetIncomeQuota = earnings.ResellerNetIncomeQuota
	summary.SettledIncomeQuota = earnings.SettledIncomeQuota
	summary.PendingIncomeQuota = earnings.PendingIncomeQuota
	summary.ReservedWithdrawalQuota = withdrawals.ReservedQuota
	summary.PaidWithdrawalQuota = withdrawals.PaidQuota
	summary.TransferredBalanceQuota = earnings.TransferredBalanceQuota
	summary.ReferralIncomeQuota = earnings.ReferralIncomeQuota
	summary.WithdrawableQuota = earnings.SettledIncomeQuota - withdrawals.ReservedQuota - withdrawals.PaidQuota - earnings.TransferredBalanceQuota
	if summary.WithdrawableQuota < 0 {
		summary.WithdrawableQuota = 0
	}
	return summary, nil
}

func CreateHubProviderWithdrawal(providerId, ownerUserId, amountQuota, payoutAccountId int) (*HubProviderWithdrawal, error) {
	if providerId <= 0 || ownerUserId <= 0 || amountQuota <= 0 || payoutAccountId <= 0 {
		return nil, errors.New("invalid hub provider withdrawal")
	}
	var created HubProviderWithdrawal
	err := DB.Transaction(func(tx *gorm.DB) error {
		var provider HubProvider
		if err := lockForUpdate(tx).Where("id = ? AND owner_user_id = ?", providerId, ownerUserId).First(&provider).Error; err != nil {
			return err
		}
		if amountQuota < hub_provider_settlement_setting.MinimumWithdrawalQuota() {
			return ErrHubProviderWithdrawalBelowMinimum
		}
		var openCount int64
		if err := tx.Model(&HubProviderWithdrawal{}).
			Where("provider_id = ? AND status IN ?", provider.Id, []string{
				HubProviderWithdrawalStatusPending,
				HubProviderWithdrawalStatusApproved,
			}).Count(&openCount).Error; err != nil {
			return err
		}
		if openCount > 0 {
			return ErrHubProviderWithdrawalPending
		}

		type quotaSum struct {
			Value int `gorm:"column:value"`
		}
		var earned quotaSum
		if err := tx.Model(&HubProviderEarning{}).
			Select(
				"COALESCE(SUM(CASE WHEN provider_id = ? THEN provider_income_quota ELSE 0 END + "+
					"CASE WHEN referral_provider_id = ? THEN referral_income_quota ELSE 0 END), 0) AS value",
				provider.Id,
				provider.Id,
			).
			Where("status = ? AND (provider_id = ? OR referral_provider_id = ?)", HubProviderEarningStatusSettled, provider.Id, provider.Id).
			Scan(&earned).Error; err != nil {
			return err
		}
		var unavailable quotaSum
		if err := tx.Model(&HubProviderWithdrawal{}).
			Select("COALESCE(SUM(amount_quota), 0) AS value").
			Where("provider_id = ? AND status <> ?", provider.Id, HubProviderWithdrawalStatusRejected).
			Scan(&unavailable).Error; err != nil {
			return err
		}
		if amountQuota > earned.Value-unavailable.Value {
			return ErrHubProviderWithdrawalInsufficient
		}
		payoutAccount, err := getHubProviderPayoutAccountTx(tx, provider.Id, payoutAccountId)
		if err != nil {
			return err
		}
		payoutSnapshot, err := snapshotHubProviderPayoutAccount(payoutAccount)
		if err != nil {
			return err
		}

		created = HubProviderWithdrawal{
			ProviderId:            provider.Id,
			OwnerUserId:           provider.OwnerUserId,
			AmountQuota:           amountQuota,
			Status:                HubProviderWithdrawalStatusPending,
			PayoutAccountId:       payoutAccount.Id,
			PayoutMethod:          payoutAccount.Method,
			PayoutAccountSnapshot: payoutSnapshot,
			ApplicantNote:         payoutAccount.MaskedSummary,
		}
		return tx.Create(&created).Error
	})
	if err != nil {
		return nil, err
	}
	if err := hydrateHubProviderWithdrawal(&created); err != nil {
		return nil, err
	}
	return &created, nil
}

func ListHubProviderWithdrawals(providerId, offset, limit int) ([]HubProviderWithdrawal, int64, error) {
	query := DB.Model(&HubProviderWithdrawal{}).Where("provider_id = ?", providerId)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]HubProviderWithdrawal, 0)
	listQuery := query.Order("id DESC")
	if limit > 0 {
		listQuery = listQuery.Limit(limit).Offset(offset)
	}
	if err := listQuery.Find(&items).Error; err != nil {
		return nil, 0, err
	}
	for i := range items {
		if err := hydrateHubProviderWithdrawal(&items[i]); err != nil {
			return nil, 0, err
		}
	}
	return items, total, nil
}

func GetHubProviderWithdrawalByID(withdrawalID int) (*HubProviderWithdrawal, error) {
	if withdrawalID <= 0 {
		return nil, ErrHubProviderWithdrawalNotFound
	}
	var withdrawal HubProviderWithdrawal
	err := DB.First(&withdrawal, withdrawalID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrHubProviderWithdrawalNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := hydrateHubProviderWithdrawal(&withdrawal); err != nil {
		return nil, err
	}
	return &withdrawal, nil
}

func listAdminHubProviderWithdrawals(status string, offset, limit int, tenantID *int) ([]HubProviderWithdrawalAdminItem, int64, error) {
	query := DB.Table("hub_provider_withdrawals AS withdrawals").
		Joins("JOIN hub_providers AS providers ON providers.id = withdrawals.provider_id").
		Joins("JOIN users ON users.id = withdrawals.owner_user_id")
	if tenantID != nil {
		query = query.Where("providers.tenant_id = ?", *tenantID)
	}
	if IsValidHubProviderWithdrawalStatus(status) {
		query = query.Where("withdrawals.status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]HubProviderWithdrawalAdminItem, 0)
	listQuery := query.Select(
		"withdrawals.*, providers.name AS provider_name, users.username AS owner_username, users.email AS owner_email",
	).Order("withdrawals.id DESC")
	if limit > 0 {
		listQuery = listQuery.Limit(limit).Offset(offset)
	}
	if err := listQuery.Scan(&items).Error; err != nil {
		return nil, 0, err
	}
	for i := range items {
		if err := hydrateHubProviderWithdrawal(&items[i].HubProviderWithdrawal); err != nil {
			return nil, 0, err
		}
	}
	return items, total, nil
}

func AdminListHubProviderWithdrawals(status string, offset, limit int) ([]HubProviderWithdrawalAdminItem, int64, error) {
	return listAdminHubProviderWithdrawals(status, offset, limit, nil)
}

func AdminListHubProviderWithdrawalsInTenant(status string, offset, limit, tenantID int) ([]HubProviderWithdrawalAdminItem, int64, error) {
	if tenantID <= 0 {
		return nil, 0, ErrTenantNotFound
	}
	return listAdminHubProviderWithdrawals(status, offset, limit, &tenantID)
}

func IsValidHubProviderWithdrawalStatus(status string) bool {
	return status == HubProviderWithdrawalStatusPending ||
		status == HubProviderWithdrawalStatusApproved ||
		status == HubProviderWithdrawalStatusPaid ||
		status == HubProviderWithdrawalStatusRejected
}

func UpdateHubProviderWithdrawalStatus(
	id int,
	status string,
	adminUserId int,
	adminRemark string,
	payment *HubProviderWithdrawalPayment,
) (*HubProviderWithdrawal, error) {
	if id <= 0 || adminUserId <= 0 || !IsValidHubProviderWithdrawalStatus(status) ||
		status == HubProviderWithdrawalStatusPending {
		return nil, errors.New("invalid hub provider withdrawal update")
	}
	adminRemark = strings.TrimSpace(adminRemark)
	var normalizedPayment HubProviderWithdrawalPayment
	if status == HubProviderWithdrawalStatusPaid {
		if payment == nil {
			return nil, ErrHubProviderWithdrawalPaymentInvalid
		}
		var err error
		normalizedPayment, err = normalizeHubProviderWithdrawalPayment(*payment)
		if err != nil {
			return nil, err
		}
	}
	var updated HubProviderWithdrawal
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&updated, id).Error; err != nil {
			return err
		}
		if updated.Status == status {
			return nil
		}
		if (status == HubProviderWithdrawalStatusPaid || status == HubProviderWithdrawalStatusRejected) && adminRemark == "" {
			return ErrHubProviderWithdrawalRemarkRequired
		}
		validTransition := updated.Status == HubProviderWithdrawalStatusPending &&
			(status == HubProviderWithdrawalStatusApproved ||
				status == HubProviderWithdrawalStatusPaid ||
				status == HubProviderWithdrawalStatusRejected)
		validTransition = validTransition || updated.Status == HubProviderWithdrawalStatusApproved &&
			(status == HubProviderWithdrawalStatusPaid || status == HubProviderWithdrawalStatusRejected)
		if !validTransition {
			return ErrHubProviderWithdrawalTransition
		}
		now := common.GetTimestamp()
		updates := map[string]any{
			"status":        status,
			"admin_user_id": adminUserId,
			"admin_remark":  adminRemark,
			"updated_at":    now,
		}
		if updated.Status == HubProviderWithdrawalStatusPending || status == HubProviderWithdrawalStatusRejected {
			updates["reviewed_at"] = now
		}
		if status == HubProviderWithdrawalStatusPaid {
			updates["paid_at"] = now
			updates["payout_currency"] = normalizedPayment.Currency
			updates["payout_amount_minor"] = normalizedPayment.AmountMinor
			updates["exchange_rate"] = normalizedPayment.ExchangeRate
		}
		if err := tx.Model(&HubProviderWithdrawal{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return err
		}
		return tx.First(&updated, id).Error
	})
	if err != nil {
		return nil, fmt.Errorf("update hub provider withdrawal: %w", err)
	}
	if err := hydrateHubProviderWithdrawal(&updated); err != nil {
		return nil, err
	}
	return &updated, nil
}
