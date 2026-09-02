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
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_provider_settlement_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedSettlementPayoutAccount(t *testing.T, provider HubProvider) *HubProviderPayoutAccount {
	t.Helper()
	account, err := CreateHubProviderPayoutAccount(provider.Id, provider.OwnerUserId, HubProviderPayoutAccountInput{
		Method: HubProviderPayoutMethodAlipay,
		Details: HubProviderPayoutAccountDetails{
			RecipientName: "Alice",
			Account:       "alice@example.com",
		},
		IsDefault: true,
	})
	require.NoError(t, err)
	return account
}

func TestCalculateHubProviderRevenueSplitKeepsGrossQuotaExact(t *testing.T) {
	tests := []struct {
		name           string
		gross          int
		feeBasisPoints int
		wantFee        int
		wantIncome     int
	}{
		{name: "ten percent", gross: 1000, feeBasisPoints: 1000, wantFee: 100, wantIncome: 900},
		{name: "round nearest quota", gross: 1005, feeBasisPoints: 1000, wantFee: 101, wantIncome: 904},
		{name: "zero gross", gross: 0, feeBasisPoints: 1000, wantFee: 0, wantIncome: 0},
		{name: "fee upper bound", gross: 25, feeBasisPoints: 20000, wantFee: 25, wantIncome: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fee, income := CalculateHubProviderRevenueSplit(test.gross, test.feeBasisPoints)
			assert.Equal(t, test.wantFee, fee)
			assert.Equal(t, test.wantIncome, income)
			assert.Equal(t, test.gross, fee+income)
		})
	}
}

func TestCalculateHubProviderRevenueSplitWithReferralKeepsPlatformFee(t *testing.T) {
	platformFee, providerIncome, referralIncome := CalculateHubProviderRevenueSplitWithReferral(1000, 1000, 100)
	assert.Equal(t, 100, platformFee)
	assert.Equal(t, 890, providerIncome)
	assert.Equal(t, 10, referralIncome)
	assert.Equal(t, 1000, platformFee+providerIncome+referralIncome)

	platformFee, providerIncome, referralIncome = CalculateHubProviderRevenueSplitWithReferral(1000, 10000, 100)
	assert.Equal(t, 1000, platformFee)
	assert.Zero(t, providerIncome)
	assert.Zero(t, referralIncome)
}

func TestCalculateHubProviderTwoLayerRevenueSplitKeepsUserChargeExact(t *testing.T) {
	tests := []struct {
		name              string
		gross             int
		providerFee       int
		platformFee       int
		referralFee       int
		wantPlatform      int
		wantProvider      int
		wantReferral      int
		wantResellerGross int
		wantResellerNet   int
	}{
		{name: "ten percent reseller and platform", gross: 100, providerFee: 1000, platformFee: 1000, wantPlatform: 1, wantProvider: 90, wantResellerGross: 10, wantResellerNet: 9},
		{name: "five percent reseller", gross: 1000, providerFee: 500, platformFee: 1000, wantPlatform: 5, wantProvider: 950, wantResellerGross: 50, wantResellerNet: 45},
		{name: "fallback commission comes from provider", gross: 1000, providerFee: 1000, platformFee: 1000, referralFee: 100, wantPlatform: 10, wantProvider: 890, wantReferral: 10, wantResellerGross: 100, wantResellerNet: 90},
		{name: "default platform share with fallback commission", gross: 10000, providerFee: 1000, platformFee: 3000, referralFee: 100, wantPlatform: 300, wantProvider: 8900, wantReferral: 100, wantResellerGross: 1000, wantResellerNet: 700},
		{name: "free reseller", gross: 1000, providerFee: 0, platformFee: 1000, wantProvider: 1000},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			platform, provider, referral, resellerGross, resellerNet := CalculateHubProviderTwoLayerRevenueSplit(
				test.gross, test.providerFee, test.platformFee, test.referralFee,
			)
			assert.Equal(t, test.wantPlatform, platform)
			assert.Equal(t, test.wantProvider, provider)
			assert.Equal(t, test.wantReferral, referral)
			assert.Equal(t, test.wantResellerGross, resellerGross)
			assert.Equal(t, test.wantResellerNet, resellerNet)
			assert.Equal(t, test.gross, platform+provider+referral+resellerNet)
		})
	}
}

func TestFallbackPriceProtectionSplitsSpreadWithoutReducingServingProviderIncome(t *testing.T) {
	truncateTables(t)
	tenantID := 901
	serviceProvider := HubProvider{
		OwnerUserId: 902, TenantId: &tenantID, Slot: 1,
		Name: "Protected Service", Slug: "protected-service", Status: HubProviderStatusActive,
	}
	referralProvider := HubProvider{
		OwnerUserId: 903, TenantId: &tenantID, Slot: 1,
		Name: "Protected Referral", Slug: "protected-referral", Status: HubProviderStatusActive,
	}
	require.NoError(t, DB.Create(&serviceProvider).Error)
	require.NoError(t, DB.Create(&referralProvider).Error)

	earning, err := PrepareHubProviderEarning(HubProviderEarningParams{
		RequestId: "req-price-protection-spread", ProviderId: serviceProvider.Id, OwnerUserId: serviceProvider.OwnerUserId,
		ConsumerUserId: 904, TokenId: 905, SupplyGroupId: 906, ChannelId: 907,
		ModelName: "gpt-5", BillingSource: "wallet", GrossQuota: 3000,
		BaseGroupRatio: 1, SupplyMultiplier: 0.2, SupplyBillingRatio: 0.2, BillingRatio: 0.3,
		TenantId: tenantID, ProviderServiceFeeBasisPoints: 1000, HasProviderServiceFeeBasisPoints: true,
		PlatformFeeBasisPoints: 3000, HasPlatformFeeBasisPoints: true,
		ReferralProviderId: referralProvider.Id, ReferralBasisPoints: 2000, FallbackPriceProtection: true,
	})
	require.NoError(t, err)

	assert.Equal(t, 3000, earning.GrossQuota)
	assert.Equal(t, 2000, earning.SupplyGrossQuota)
	assert.Equal(t, 860, earning.PlatformFeeQuota)
	assert.Equal(t, 1800, earning.ProviderIncomeQuota)
	assert.Equal(t, 200, earning.ReferralIncomeQuota)
	assert.Equal(t, 200, earning.ResellerGrossQuota)
	assert.Equal(t, 140, earning.ResellerNetIncomeQuota)
	assert.Equal(t, 800, earning.FallbackSpreadPlatformQuota)
	assert.Equal(t, earning.GrossQuota, earning.PlatformFeeQuota+earning.ProviderIncomeQuota+earning.ReferralIncomeQuota+earning.ResellerNetIncomeQuota)

	require.NoError(t, SettleHubProviderEarning(earning.RequestId, earning.GrossQuota))
	var settled HubProviderEarning
	require.NoError(t, DB.First(&settled, earning.Id).Error)
	assert.Equal(t, 2000, settled.SupplyGrossQuota)
	assert.Equal(t, 860, settled.PlatformFeeQuota)
}

func TestHubProviderSettlementOptionsSaveTogether(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Option{}))
	settings := hub_provider_settlement_setting.Get()
	original := *settings
	originalOptionMap := common.OptionMap
	common.OptionMap = make(map[string]string)
	t.Cleanup(func() {
		*settings = original
		for _, key := range []string{
			hub_provider_settlement_setting.OptionKeyPlatformFeeBasisPoints,
			hub_provider_settlement_setting.OptionKeyProviderServiceFeeBasisPoints,
			hub_provider_settlement_setting.OptionKeyMinimumWithdrawalQuota,
			hub_provider_settlement_setting.OptionKeyFallbackReferralEnabled,
			hub_provider_settlement_setting.OptionKeyFallbackReferralBasisPoints,
		} {
			DB.Delete(&Option{}, "key = ?", key)
		}
		common.OptionMap = originalOptionMap
	})

	values := map[string]string{
		hub_provider_settlement_setting.OptionKeyPlatformFeeBasisPoints:        "1200",
		hub_provider_settlement_setting.OptionKeyProviderServiceFeeBasisPoints: "700",
		hub_provider_settlement_setting.OptionKeyMinimumWithdrawalQuota:        "500",
		hub_provider_settlement_setting.OptionKeyFallbackReferralEnabled:       "false",
		hub_provider_settlement_setting.OptionKeyFallbackReferralBasisPoints:   "150",
	}
	require.NoError(t, UpdateOptionsBulk(values))
	assert.Equal(t, 1200, settings.PlatformFeeBasisPoints)
	assert.Equal(t, 700, settings.ProviderServiceFeeBasisPoints)
	assert.Equal(t, 500, settings.MinimumWithdrawalQuota)
	assert.False(t, settings.FallbackReferralEnabled)
	assert.Equal(t, 150, settings.FallbackReferralBasisPoints)

	invalid := map[string]string{
		hub_provider_settlement_setting.OptionKeyPlatformFeeBasisPoints:      "1300",
		hub_provider_settlement_setting.OptionKeyFallbackReferralBasisPoints: "10001",
	}
	require.Error(t, UpdateOptionsBulk(invalid))
	var persisted Option
	require.NoError(t, DB.First(&persisted, "key = ?", hub_provider_settlement_setting.OptionKeyPlatformFeeBasisPoints).Error)
	assert.Equal(t, "1200", persisted.Value)
	assert.Equal(t, 1200, settings.PlatformFeeBasisPoints)
}

func TestFallbackReferralIncomeIsSettledAndWithdrawable(t *testing.T) {
	truncateTables(t)
	referralOwner := User{Id: 72, Username: "referral-owner", Quota: 0, Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(&referralOwner).Error)
	serviceProvider := HubProvider{OwnerUserId: 71, Slot: 1, Name: "Service Provider", Slug: "service-provider", Status: HubProviderStatusActive}
	referralProvider := HubProvider{OwnerUserId: referralOwner.Id, Slot: 1, Name: "Referral Provider", Slug: "referral-provider", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&serviceProvider).Error)
	require.NoError(t, DB.Create(&referralProvider).Error)

	params := HubProviderEarningParams{
		RequestId: "req-fallback-referral", ProviderId: serviceProvider.Id, OwnerUserId: serviceProvider.OwnerUserId,
		ConsumerUserId: 80, TokenId: 90, SupplyGroupId: 11, ChannelId: 12,
		ModelName: "gpt-5", BillingSource: "wallet", GrossQuota: 1000,
		BaseGroupRatio: 1, SupplyMultiplier: 1, BillingRatio: 1,
		PlatformFeeBasisPoints: 1000, HasPlatformFeeBasisPoints: true,
		ReferralProviderId: referralProvider.Id, ReferralBasisPoints: 100,
	}
	first, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	second, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	assert.Equal(t, first.Id, second.Id)
	require.NoError(t, SettleHubProviderEarning(params.RequestId, params.GrossQuota))
	require.NoError(t, SettleHubProviderEarning(params.RequestId, params.GrossQuota))

	var earning HubProviderEarning
	require.NoError(t, DB.First(&earning, first.Id).Error)
	assert.Equal(t, 100, earning.PlatformFeeQuota)
	assert.Equal(t, 890, earning.ProviderIncomeQuota)
	assert.Equal(t, 10, earning.ReferralIncomeQuota)
	assert.Equal(t, params.GrossQuota, earning.PlatformFeeQuota+earning.ProviderIncomeQuota+earning.ReferralIncomeQuota)

	serviceSummary, err := GetHubProviderSettlementSummary(serviceProvider.Id)
	require.NoError(t, err)
	assert.Equal(t, 890, serviceSummary.SettledIncomeQuota)
	assert.Zero(t, serviceSummary.ReferralIncomeQuota)
	referralSummary, err := GetHubProviderSettlementSummary(referralProvider.Id)
	require.NoError(t, err)
	assert.Equal(t, 10, referralSummary.SettledIncomeQuota)
	assert.Equal(t, 10, referralSummary.ReferralIncomeQuota)
	assert.Equal(t, 10, referralSummary.WithdrawableQuota)

	items, total, err := ListHubProviderEarnings(referralProvider.Id, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	assert.Equal(t, "referral", items[0].EarningRole)
	assert.Equal(t, 10, items[0].ProviderIncomeQuota)
	assert.Equal(t, referralProvider.Id, items[0].ProviderId)
	assert.Zero(t, items[0].ConsumerUserId)
	assert.Zero(t, items[0].TokenId)
	assert.Zero(t, items[0].SupplyGroupId)
	assert.Zero(t, items[0].ChannelId)
	assert.Zero(t, items[0].PlatformFeeQuota)
	assert.Zero(t, items[0].ReferralProviderId)

	adminItems, adminTotal, err := ListHubProviderEarningsForAdmin(referralProvider.Id, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), adminTotal)
	require.Len(t, adminItems, 1)
	assert.Equal(t, "referral", adminItems[0].EarningRole)
	assert.Equal(t, serviceProvider.Id, adminItems[0].ProviderId)
	assert.Equal(t, referralProvider.Id, adminItems[0].ReferralProviderId)
	assert.Equal(t, params.ConsumerUserId, adminItems[0].ConsumerUserId)
	assert.Equal(t, params.ChannelId, adminItems[0].ChannelId)
	assert.Equal(t, 890, adminItems[0].ProviderIncomeQuota)
	assert.Equal(t, 10, adminItems[0].ReferralIncomeQuota)

	transfer, err := CreateHubProviderBalanceTransfer(referralProvider.Id, referralProvider.OwnerUserId, 6, "referral-transfer")
	require.NoError(t, err)
	assert.Equal(t, -6, transfer.ProviderIncomeQuota)
	require.NoError(t, DB.First(&referralOwner, referralOwner.Id).Error)
	assert.Equal(t, 6, referralOwner.Quota)
	referralSummary, err = GetHubProviderSettlementSummary(referralProvider.Id)
	require.NoError(t, err)
	assert.Equal(t, 10, referralSummary.SettledIncomeQuota)
	assert.Equal(t, 6, referralSummary.TransferredBalanceQuota)
	assert.Equal(t, 4, referralSummary.WithdrawableQuota)
}

func TestFallbackReferralRequiresDistinctActiveProvider(t *testing.T) {
	truncateTables(t)
	serviceProvider := HubProvider{OwnerUserId: 73, Slot: 1, Name: "Service Provider", Slug: "referral-service", Status: HubProviderStatusActive}
	disabledProvider := HubProvider{OwnerUserId: 74, Slot: 1, Name: "Disabled Provider", Slug: "referral-disabled", Status: HubProviderStatusDisabled}
	require.NoError(t, DB.Create(&serviceProvider).Error)
	require.NoError(t, DB.Create(&disabledProvider).Error)

	base := HubProviderEarningParams{
		ProviderId: serviceProvider.Id, OwnerUserId: serviceProvider.OwnerUserId,
		ConsumerUserId: 80, TokenId: 90, SupplyGroupId: 11, ChannelId: 12,
		ModelName: "gpt-5", BillingSource: "wallet", GrossQuota: 1000,
		BaseGroupRatio: 1, SupplyMultiplier: 1, BillingRatio: 1,
		PlatformFeeBasisPoints: 1000, HasPlatformFeeBasisPoints: true,
		ReferralBasisPoints: 100,
	}
	tests := []struct {
		name               string
		requestID          string
		referralProviderID int
	}{
		{name: "normal request", requestID: "req-no-fallback-referral"},
		{name: "same provider", requestID: "req-same-provider-referral", referralProviderID: serviceProvider.Id},
		{name: "disabled provider", requestID: "req-disabled-provider-referral", referralProviderID: disabledProvider.Id},
		{name: "missing provider", requestID: "req-missing-provider-referral", referralProviderID: 999999},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			params := base
			params.RequestId = test.requestID
			params.ReferralProviderId = test.referralProviderID
			earning, err := PrepareHubProviderEarning(params)
			require.NoError(t, err)
			assert.Zero(t, earning.ReferralProviderId)
			assert.Zero(t, earning.ReferralOwnerUserId)
			assert.Zero(t, earning.ReferralBasisPoints)
			assert.Zero(t, earning.ReferralIncomeQuota)
			assert.Equal(t, params.GrossQuota, earning.PlatformFeeQuota+earning.ProviderIncomeQuota)
		})
	}
}

func TestFallbackReferralFinalGrossIsRecalculatedBeforeAsyncSettlement(t *testing.T) {
	truncateTables(t)
	serviceProvider := HubProvider{OwnerUserId: 75, Slot: 1, Name: "Async Service", Slug: "async-service", Status: HubProviderStatusActive}
	referralProvider := HubProvider{OwnerUserId: 76, Slot: 1, Name: "Async Referral", Slug: "async-referral", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&serviceProvider).Error)
	require.NoError(t, DB.Create(&referralProvider).Error)
	deferred := true
	params := HubProviderEarningParams{
		RequestId: "req-async-fallback-referral", ProviderId: serviceProvider.Id, OwnerUserId: serviceProvider.OwnerUserId,
		ConsumerUserId: 80, TokenId: 90, SupplyGroupId: 11, ChannelId: 12,
		ModelName: "video-model", BillingSource: "wallet", GrossQuota: 1000,
		BaseGroupRatio: 1, SupplyMultiplier: 1, BillingRatio: 1,
		PlatformFeeBasisPoints: 1000, HasPlatformFeeBasisPoints: true,
		ReferralProviderId: referralProvider.Id, ReferralBasisPoints: 100,
		SettlementDeferred: &deferred,
	}
	earning, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	assert.Equal(t, 100, earning.PlatformFeeQuota)
	assert.Equal(t, 890, earning.ProviderIncomeQuota)
	assert.Equal(t, 10, earning.ReferralIncomeQuota)

	require.NoError(t, MarkHubProviderEarningReady(params.RequestId, 2500))
	require.NoError(t, DB.First(&earning, earning.Id).Error)
	require.NotNil(t, earning.SettlementDeferred)
	assert.False(t, *earning.SettlementDeferred)
	assert.Equal(t, 250, earning.PlatformFeeQuota)
	assert.Equal(t, 2225, earning.ProviderIncomeQuota)
	assert.Equal(t, 25, earning.ReferralIncomeQuota)
	assert.Equal(t, 2500, earning.PlatformFeeQuota+earning.ProviderIncomeQuota+earning.ReferralIncomeQuota)

	require.NoError(t, SettleHubProviderEarning(params.RequestId, 2500))
	require.NoError(t, DB.First(&earning, earning.Id).Error)
	assert.Equal(t, HubProviderEarningStatusSettled, earning.Status)
}

func TestFallbackReferralIsRemovedWhenOriginProviderIsDisabledBeforeSettlement(t *testing.T) {
	truncateTables(t)
	serviceProvider := HubProvider{OwnerUserId: 77, Slot: 1, Name: "Delayed Service", Slug: "delayed-service", Status: HubProviderStatusActive}
	referralProvider := HubProvider{OwnerUserId: 78, Slot: 1, Name: "Delayed Referral", Slug: "delayed-referral", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&serviceProvider).Error)
	require.NoError(t, DB.Create(&referralProvider).Error)
	deferred := true
	params := HubProviderEarningParams{
		RequestId: "req-disabled-before-settlement", ProviderId: serviceProvider.Id, OwnerUserId: serviceProvider.OwnerUserId,
		ConsumerUserId: 80, TokenId: 90, SupplyGroupId: 11, ChannelId: 12,
		ModelName: "video-model", BillingSource: "wallet", GrossQuota: 1000,
		BaseGroupRatio: 1, SupplyMultiplier: 1, BillingRatio: 1,
		PlatformFeeBasisPoints: 1000, HasPlatformFeeBasisPoints: true,
		ReferralProviderId: referralProvider.Id, ReferralBasisPoints: 100,
		SettlementDeferred: &deferred,
	}
	earning, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	assert.Equal(t, 10, earning.ReferralIncomeQuota)
	require.NoError(t, DB.Model(&HubProvider{}).Where("id = ?", referralProvider.Id).Update("status", HubProviderStatusDisabled).Error)

	require.NoError(t, MarkHubProviderEarningReady(params.RequestId, 2500))
	require.NoError(t, SettleHubProviderEarning(params.RequestId, 2500))
	require.NoError(t, DB.First(&earning, earning.Id).Error)
	assert.Equal(t, 250, earning.PlatformFeeQuota)
	assert.Equal(t, 2250, earning.ProviderIncomeQuota)
	assert.Zero(t, earning.ReferralIncomeQuota)
	assert.Equal(t, 2500, earning.PlatformFeeQuota+earning.ProviderIncomeQuota)

	referralSummary, err := GetHubProviderSettlementSummary(referralProvider.Id)
	require.NoError(t, err)
	assert.Zero(t, referralSummary.SettledIncomeQuota)
	items, total, err := ListHubProviderEarnings(referralProvider.Id, 0, 10)
	require.NoError(t, err)
	assert.Zero(t, total)
	assert.Empty(t, items)
}

func TestFallbackReferralPreparationKeepsOriginalSnapshotAcrossRetries(t *testing.T) {
	truncateTables(t)
	serviceProvider := HubProvider{OwnerUserId: 79, Slot: 1, Name: "Retry Service", Slug: "retry-service", Status: HubProviderStatusActive}
	referralProvider := HubProvider{OwnerUserId: 80, Slot: 1, Name: "Retry Referral", Slug: "retry-referral", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&serviceProvider).Error)
	require.NoError(t, DB.Create(&referralProvider).Error)
	params := HubProviderEarningParams{
		RequestId: "req-referral-retry-snapshot", ProviderId: serviceProvider.Id, OwnerUserId: serviceProvider.OwnerUserId,
		ConsumerUserId: 81, TokenId: 91, SupplyGroupId: 12, ChannelId: 13,
		ModelName: "gpt-5", BillingSource: "wallet", GrossQuota: 1000,
		PlatformFeeBasisPoints: 1000, HasPlatformFeeBasisPoints: true,
		ReferralProviderId: referralProvider.Id, ReferralBasisPoints: 100,
	}
	first, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	assert.Equal(t, 10, first.ReferralIncomeQuota)

	params.ReferralProviderId = 0
	params.ReferralBasisPoints = 0
	retried, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	assert.Equal(t, first.Id, retried.Id)
	assert.Equal(t, referralProvider.Id, retried.ReferralProviderId)
	assert.Equal(t, 100, retried.ReferralBasisPoints)
}

func TestHubProviderEarningSettlementIsIdempotentByRequest(t *testing.T) {
	truncateTables(t)
	params := HubProviderEarningParams{
		RequestId:        "req-provider-income-1",
		ProviderId:       7,
		OwnerUserId:      70,
		ConsumerUserId:   80,
		TokenId:          90,
		SupplyGroupId:    11,
		ChannelId:        12,
		ModelName:        "claude-opus-5",
		BillingSource:    "wallet",
		GrossQuota:       1005,
		BaseGroupRatio:   1.2,
		SupplyMultiplier: 0.8,
		BillingRatio:     0.96,
	}
	first, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	second, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	assert.Equal(t, first.Id, second.Id)

	require.NoError(t, SettleHubProviderEarning(params.RequestId, params.GrossQuota))
	require.NoError(t, SettleHubProviderEarning(params.RequestId, params.GrossQuota))

	var entries []HubProviderEarning
	require.NoError(t, DB.Find(&entries).Error)
	require.Len(t, entries, 1)
	assert.Equal(t, HubProviderEarningStatusSettled, entries[0].Status)
	assert.Equal(t, 302, entries[0].PlatformFeeQuota)
	assert.Equal(t, 703, entries[0].ProviderIncomeQuota)
	assert.Equal(t, params.GrossQuota, entries[0].PlatformFeeQuota+entries[0].ProviderIncomeQuota)
	assert.NotZero(t, entries[0].SettledAt)

	conflict := params
	conflict.ChannelId = 99
	_, err = PrepareHubProviderEarning(conflict)
	assert.ErrorIs(t, err, ErrHubProviderEarningReferenceConflict)
}

func TestMarkHubProviderEarningReadyPublishesFinalGrossBeforeRecovery(t *testing.T) {
	truncateTables(t)
	deferred := true
	params := HubProviderEarningParams{
		RequestId: "req-provider-final-gross", ProviderId: 7, OwnerUserId: 70,
		ConsumerUserId: 80, TokenId: 90, SupplyGroupId: 11, ChannelId: 12,
		ModelName: "video-model", BillingSource: "wallet", GrossQuota: 2000,
		BaseGroupRatio: 1, SupplyMultiplier: 1, BillingRatio: 1,
		SettlementDeferred: &deferred,
	}
	_, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	require.NoError(t, MarkHubProviderEarningReady(params.RequestId, 3000))

	var earning HubProviderEarning
	require.NoError(t, DB.Where("request_id = ?", params.RequestId).First(&earning).Error)
	require.NotNil(t, earning.SettlementDeferred)
	assert.False(t, *earning.SettlementDeferred)
	assert.Equal(t, 3000, earning.GrossQuota)
	assert.Equal(t, 3000, earning.PlatformFeeQuota+earning.ProviderIncomeQuota)

	require.NoError(t, SettleHubProviderEarning(params.RequestId, earning.GrossQuota))
	require.NoError(t, DB.Where("request_id = ?", params.RequestId).First(&earning).Error)
	assert.Equal(t, HubProviderEarningStatusSettled, earning.Status)
	assert.Equal(t, 3000, earning.GrossQuota)
}

func TestHubProviderEarningSnapshotsGlobalAndProviderFeeOverride(t *testing.T) {
	truncateTables(t)
	settings := hub_provider_settlement_setting.Get()
	original := *settings
	t.Cleanup(func() { *settings = original })
	settings.PlatformFeeBasisPoints = 1200

	provider := HubProvider{OwnerUserId: 70, Slot: 1, Name: "Provider", Slug: "fee-provider", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)
	params := HubProviderEarningParams{
		RequestId: "req-global-fee", ProviderId: provider.Id, OwnerUserId: provider.OwnerUserId,
		ConsumerUserId: 80, TokenId: 90, SupplyGroupId: 11, ChannelId: 12,
		ModelName: "gpt-5", BillingSource: "wallet", GrossQuota: 1000,
		BaseGroupRatio: 1, SupplyMultiplier: 1, BillingRatio: 1,
	}
	globalEarning, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	assert.Equal(t, 1200, globalEarning.PlatformFeeBasisPoints)
	assert.Equal(t, 120, globalEarning.PlatformFeeQuota)

	zeroFee := 0
	_, err = UpdateHubProviderPlatformFeeBasisPoints(provider.Id, &zeroFee)
	require.NoError(t, err)
	params.RequestId = "req-zero-fee"
	zeroFeeEarning, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	assert.Equal(t, 0, zeroFeeEarning.PlatformFeeBasisPoints)
	assert.Equal(t, 0, zeroFeeEarning.PlatformFeeQuota)
	assert.Equal(t, 1000, zeroFeeEarning.ProviderIncomeQuota)

	settings.PlatformFeeBasisPoints = 2500
	require.NoError(t, SettleHubProviderEarning(globalEarning.RequestId, 2000))
	var settled HubProviderEarning
	require.NoError(t, DB.First(&settled, globalEarning.Id).Error)
	assert.Equal(t, 1200, settled.PlatformFeeBasisPoints)
	assert.Equal(t, 240, settled.PlatformFeeQuota)
	assert.Equal(t, 1760, settled.ProviderIncomeQuota)
}

func TestUpdateHubProviderPlatformFeeRefreshesPricingSnapshot(t *testing.T) {
	truncateTables(t)
	tenantID := 71001
	provider := HubProvider{
		OwnerUserId: 71, Slot: 1, Name: "Cached Fee Provider",
		Slug: "cached-fee-provider", Status: HubProviderStatusActive, TenantId: &tenantID,
	}
	require.NoError(t, DB.Create(&provider).Error)
	channel := Channel{Name: "cached-fee-channel", Status: common.ChannelStatusEnabled}
	require.NoError(t, DB.Create(&channel).Error)
	require.NoError(t, DB.Create(&HubSupplyGroup{
		ProviderId: provider.Id, NewAPIChannelId: channel.Id, PriceMultiplier: 1,
	}).Error)
	require.NoError(t, RefreshHubSupplyPricingCache())
	t.Cleanup(func() { require.NoError(t, RefreshHubSupplyPricingCache()) })

	fee := 2500
	_, err := UpdateHubProviderPlatformFeeBasisPoints(provider.Id, &fee)
	require.NoError(t, err)
	snapshot := CaptureHubSupplyPricingSnapshot(channel.Id)
	require.True(t, snapshot.Found)
	require.NotNil(t, snapshot.Pricing.ProviderServiceFeeBasisPoints)
	assert.Equal(t, fee, *snapshot.Pricing.ProviderServiceFeeBasisPoints)

	_, err = UpdateHubProviderPlatformFeeBasisPoints(provider.Id, nil)
	require.NoError(t, err)
	snapshot = CaptureHubSupplyPricingSnapshot(channel.Id)
	require.True(t, snapshot.Found)
	assert.Nil(t, snapshot.Pricing.ProviderServiceFeeBasisPoints)
}

func TestHubProviderWithdrawalEnforcesConfiguredMinimum(t *testing.T) {
	truncateTables(t)
	settings := hub_provider_settlement_setting.Get()
	original := *settings
	t.Cleanup(func() { *settings = original })
	settings.MinimumWithdrawalQuota = 100

	provider := HubProvider{OwnerUserId: 105, Slot: 1, Name: "Provider", Slug: "minimum-provider", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)
	account := seedSettlementPayoutAccount(t, provider)
	_, err := CreateHubProviderManualAdjustment(provider.Id, 200, 999, "initial credit")
	require.NoError(t, err)

	_, err = CreateHubProviderWithdrawal(provider.Id, provider.OwnerUserId, 99, account.Id)
	assert.ErrorIs(t, err, ErrHubProviderWithdrawalBelowMinimum)
	withdrawal, err := CreateHubProviderWithdrawal(provider.Id, provider.OwnerUserId, 100, account.Id)
	require.NoError(t, err)
	assert.Equal(t, 100, withdrawal.AmountQuota)
}

func TestCancelledHubProviderEarningCanBePreparedAgainForSameRequest(t *testing.T) {
	truncateTables(t)
	params := HubProviderEarningParams{
		RequestId: "req-provider-income-retry", ProviderId: 7, OwnerUserId: 70,
		ConsumerUserId: 80, TokenId: 90, SupplyGroupId: 11, ChannelId: 12,
		ModelName: "claude-opus-5", BillingSource: "wallet", GrossQuota: 1000,
		BaseGroupRatio: 1, SupplyMultiplier: 1, BillingRatio: 1,
	}
	first, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	require.NoError(t, CancelHubProviderEarning(params.RequestId))

	retried, err := PrepareHubProviderEarning(params)
	require.NoError(t, err)
	assert.Equal(t, first.Id, retried.Id)
	assert.Equal(t, HubProviderEarningStatusPending, retried.Status)
	assert.Zero(t, retried.CancelledAt)
	require.NoError(t, SettleHubProviderEarning(params.RequestId, params.GrossQuota))
}

func TestPendingEarningsAreNotWithdrawableAndOpenWithdrawalReservesBalance(t *testing.T) {
	truncateTables(t)
	provider := HubProvider{Id: 1, OwnerUserId: 101, Slot: 1, Name: "Provider", Slug: "provider-one", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)
	payoutAccount := seedSettlementPayoutAccount(t, provider)

	settledParams := HubProviderEarningParams{
		RequestId: "req-settled", ProviderId: provider.Id, OwnerUserId: provider.OwnerUserId,
		ConsumerUserId: 201, TokenId: 1, SupplyGroupId: 1, ChannelId: 1,
		ModelName: "gpt-5", BillingSource: "wallet", GrossQuota: 1000,
		BaseGroupRatio: 1, SupplyMultiplier: 1, BillingRatio: 1,
	}
	_, err := PrepareHubProviderEarning(settledParams)
	require.NoError(t, err)
	require.NoError(t, SettleHubProviderEarning(settledParams.RequestId, settledParams.GrossQuota))

	pendingParams := settledParams
	pendingParams.RequestId = "req-pending-task"
	pendingParams.GrossQuota = 500
	_, err = PrepareHubProviderEarning(pendingParams)
	require.NoError(t, err)

	summary, err := GetHubProviderSettlementSummary(provider.Id)
	require.NoError(t, err)
	assert.Equal(t, 700, summary.SettledIncomeQuota)
	assert.Equal(t, 350, summary.PendingIncomeQuota)
	assert.Equal(t, 700, summary.WithdrawableQuota)

	withdrawal, err := CreateHubProviderWithdrawal(provider.Id, provider.OwnerUserId, 600, payoutAccount.Id)
	require.NoError(t, err)
	assert.Equal(t, HubProviderWithdrawalStatusPending, withdrawal.Status)
	_, err = CreateHubProviderWithdrawal(provider.Id, provider.OwnerUserId, 1, payoutAccount.Id)
	assert.ErrorIs(t, err, ErrHubProviderWithdrawalPending)

	summary, err = GetHubProviderSettlementSummary(provider.Id)
	require.NoError(t, err)
	assert.Equal(t, 600, summary.ReservedWithdrawalQuota)
	assert.Equal(t, 100, summary.WithdrawableQuota)

	approved, err := UpdateHubProviderWithdrawalStatus(
		withdrawal.Id,
		HubProviderWithdrawalStatusApproved,
		999,
		"verified",
		nil,
	)
	require.NoError(t, err)
	assert.Equal(t, HubProviderWithdrawalStatusApproved, approved.Status)
	_, err = UpdateHubProviderWithdrawalStatus(
		withdrawal.Id,
		HubProviderWithdrawalStatusPaid,
		999,
		" ",
		&HubProviderWithdrawalPayment{Currency: "CNY", AmountMinor: 600, ExchangeRate: "7.2"},
	)
	assert.ErrorIs(t, err, ErrHubProviderWithdrawalRemarkRequired)
	paid, err := UpdateHubProviderWithdrawalStatus(
		withdrawal.Id,
		HubProviderWithdrawalStatusPaid,
		999,
		"bank transfer complete",
		&HubProviderWithdrawalPayment{Currency: "CNY", AmountMinor: 864, ExchangeRate: "7.2"},
	)
	require.NoError(t, err)
	assert.Equal(t, HubProviderWithdrawalStatusPaid, paid.Status)
	assert.NotZero(t, paid.PaidAt)
	assert.Equal(t, approved.ReviewedAt, paid.ReviewedAt)
	assert.Equal(t, "CNY", paid.PayoutCurrency)
	assert.Equal(t, int64(864), paid.PayoutAmountMinor)
	assert.Equal(t, "7.2", paid.ExchangeRate)

	summary, err = GetHubProviderSettlementSummary(provider.Id)
	require.NoError(t, err)
	assert.Zero(t, summary.ReservedWithdrawalQuota)
	assert.Equal(t, 600, summary.PaidWithdrawalQuota)
	assert.Equal(t, 100, summary.WithdrawableQuota)
}

func TestHubProviderWithdrawalCanBePaidDirectly(t *testing.T) {
	truncateTables(t)
	provider := HubProvider{Id: 2, OwnerUserId: 102, Slot: 1, Name: "Provider 2", Slug: "provider-two", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)
	payoutAccount := seedSettlementPayoutAccount(t, provider)
	_, err := CreateHubProviderManualAdjustment(provider.Id, 200, 999, "initial credit")
	require.NoError(t, err)
	withdrawal, err := CreateHubProviderWithdrawal(provider.Id, provider.OwnerUserId, 100, payoutAccount.Id)
	require.NoError(t, err)

	paid, err := UpdateHubProviderWithdrawalStatus(
		withdrawal.Id,
		HubProviderWithdrawalStatusPaid,
		999,
		"transfer complete",
		&HubProviderWithdrawalPayment{Currency: "CNY", AmountMinor: 146, ExchangeRate: "7.3"},
	)
	require.NoError(t, err)
	assert.Equal(t, HubProviderWithdrawalStatusPaid, paid.Status)
	assert.NotZero(t, paid.ReviewedAt)
	assert.Equal(t, paid.ReviewedAt, paid.PaidAt)
	assert.Equal(t, "CNY", paid.PayoutCurrency)
	assert.Equal(t, int64(146), paid.PayoutAmountMinor)
	assert.Equal(t, "7.3", paid.ExchangeRate)

	summary, err := GetHubProviderSettlementSummary(provider.Id)
	require.NoError(t, err)
	assert.Zero(t, summary.ReservedWithdrawalQuota)
	assert.Equal(t, 100, summary.PaidWithdrawalQuota)
	assert.Equal(t, 100, summary.WithdrawableQuota)
}

func TestHubProviderWithdrawalRejectsInsufficientBalanceAndInvalidTransition(t *testing.T) {
	truncateTables(t)
	provider := HubProvider{Id: 3, OwnerUserId: 103, Slot: 1, Name: "Provider 3", Slug: "provider-three", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)
	payoutAccount := seedSettlementPayoutAccount(t, provider)
	_, err := CreateHubProviderWithdrawal(provider.Id, provider.OwnerUserId, 1, payoutAccount.Id)
	assert.ErrorIs(t, err, ErrHubProviderWithdrawalInsufficient)

	adjustment, err := CreateHubProviderManualAdjustment(provider.Id, 200, 999, "initial credit")
	require.NoError(t, err)
	assert.Equal(t, HubProviderEarningTypeAdjustment, adjustment.EntryType)
	withdrawal, err := CreateHubProviderWithdrawal(provider.Id, provider.OwnerUserId, 100, payoutAccount.Id)
	require.NoError(t, err)
	_, err = UpdateHubProviderWithdrawalStatus(
		withdrawal.Id,
		HubProviderWithdrawalStatusRejected,
		999,
		"",
		nil,
	)
	assert.ErrorIs(t, err, ErrHubProviderWithdrawalRemarkRequired)
	_, err = UpdateHubProviderWithdrawalStatus(
		withdrawal.Id,
		HubProviderWithdrawalStatusRejected,
		999,
		"account details do not match",
		nil,
	)
	require.NoError(t, err)
	_, err = UpdateHubProviderWithdrawalStatus(
		withdrawal.Id,
		HubProviderWithdrawalStatusPaid,
		999,
		"cannot pay a rejected withdrawal",
		&HubProviderWithdrawalPayment{Currency: "USD", AmountMinor: 1, ExchangeRate: "1"},
	)
	assert.True(t, errors.Is(err, ErrHubProviderWithdrawalTransition))
}

func TestHubProviderBalanceTransferCreditsWalletAndReservesEarnings(t *testing.T) {
	truncateTables(t)
	owner := User{Id: 104, Username: "provider-owner", Quota: 50, Status: 1}
	require.NoError(t, DB.Create(&owner).Error)
	provider := HubProvider{Id: 4, OwnerUserId: owner.Id, Slot: 1, Name: "Provider 4", Slug: "provider-four", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)
	payoutAccount := seedSettlementPayoutAccount(t, provider)
	_, err := CreateHubProviderManualAdjustment(provider.Id, 200, 999, "initial credit")
	require.NoError(t, err)
	_, err = CreateHubProviderWithdrawal(provider.Id, owner.Id, 70, payoutAccount.Id)
	require.NoError(t, err)

	transfer, err := CreateHubProviderBalanceTransfer(provider.Id, owner.Id, 120, "transfer-1")
	require.NoError(t, err)
	assert.Equal(t, HubProviderEarningTypeBalanceTransfer, transfer.EntryType)
	assert.Equal(t, HubProviderEarningStatusSettled, transfer.Status)
	assert.Equal(t, -120, transfer.ProviderIncomeQuota)

	var updated User
	require.NoError(t, DB.First(&updated, owner.Id).Error)
	assert.Equal(t, 170, updated.Quota)

	summary, err := GetHubProviderSettlementSummary(provider.Id)
	require.NoError(t, err)
	assert.Equal(t, 200, summary.SettledIncomeQuota)
	assert.Equal(t, 70, summary.ReservedWithdrawalQuota)
	assert.Equal(t, 120, summary.TransferredBalanceQuota)
	assert.Equal(t, 10, summary.WithdrawableQuota)

	repeated, err := CreateHubProviderBalanceTransfer(provider.Id, owner.Id, 120, "transfer-1")
	require.NoError(t, err)
	assert.Equal(t, transfer.Id, repeated.Id)
	require.NoError(t, DB.First(&updated, owner.Id).Error)
	assert.Equal(t, 170, updated.Quota)

	_, err = CreateHubProviderBalanceTransfer(provider.Id, owner.Id, 121, "transfer-1")
	assert.ErrorIs(t, err, ErrHubProviderEarningReferenceConflict)
	_, err = CreateHubProviderBalanceTransfer(provider.Id, owner.Id, 11, "transfer-2")
	assert.ErrorIs(t, err, ErrHubProviderBalanceTransferInsufficient)
}

func TestHubProviderWithdrawalRequiresExistingPayoutAccount(t *testing.T) {
	truncateTables(t)
	provider := HubProvider{Id: 4, OwnerUserId: 104, Slot: 1, Name: "Provider 4", Slug: "provider-four", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)
	_, err := CreateHubProviderManualAdjustment(provider.Id, 200, 999, "initial credit")
	require.NoError(t, err)

	_, err = CreateHubProviderWithdrawal(provider.Id, provider.OwnerUserId, 100, 999)
	assert.ErrorIs(t, err, ErrHubProviderPayoutAccountNotFound)
}

func TestHubProviderFinanceIsolatedForSameOwnerAcrossTenants(t *testing.T) {
	truncateTables(t)
	owner := User{Id: 105, Username: "multi-tenant-provider-owner", Quota: 10, Status: 1}
	require.NoError(t, DB.Create(&owner).Error)
	tenantA, tenantB := 101, 202
	providerA := HubProvider{OwnerUserId: owner.Id, TenantId: &tenantA, Name: "Provider A", Slug: "finance-provider-a", Status: HubProviderStatusActive}
	providerB := HubProvider{OwnerUserId: owner.Id, TenantId: &tenantB, Name: "Provider B", Slug: "finance-provider-b", Status: HubProviderStatusActive}
	require.NoError(t, CreateHubProvider(&providerA))
	require.NoError(t, CreateHubProvider(&providerB))

	accountA := seedSettlementPayoutAccount(t, providerA)
	accountB := seedSettlementPayoutAccount(t, providerB)
	accountsA, err := ListHubProviderPayoutAccounts(providerA.Id, owner.Id)
	require.NoError(t, err)
	accountsB, err := ListHubProviderPayoutAccounts(providerB.Id, owner.Id)
	require.NoError(t, err)
	require.Len(t, accountsA, 1)
	require.Len(t, accountsB, 1)
	assert.Equal(t, accountA.Id, accountsA[0].Id)
	assert.Equal(t, accountB.Id, accountsB[0].Id)

	_, err = CreateHubProviderManualAdjustment(providerA.Id, 200, 999, "tenant A credit")
	require.NoError(t, err)
	_, err = CreateHubProviderManualAdjustment(providerB.Id, 300, 999, "tenant B credit")
	require.NoError(t, err)
	_, err = CreateHubProviderWithdrawal(providerB.Id, owner.Id, 100, accountA.Id)
	assert.ErrorIs(t, err, ErrHubProviderPayoutAccountNotFound)

	transferA, err := CreateHubProviderBalanceTransfer(providerA.Id, owner.Id, 40, "same-key")
	require.NoError(t, err)
	transferB, err := CreateHubProviderBalanceTransfer(providerB.Id, owner.Id, 50, "same-key")
	require.NoError(t, err)
	assert.NotEqual(t, transferA.RequestId, transferB.RequestId)
	repeatedA, err := CreateHubProviderBalanceTransfer(providerA.Id, owner.Id, 40, "same-key")
	require.NoError(t, err)
	assert.Equal(t, transferA.Id, repeatedA.Id)

	summaryA, err := GetHubProviderSettlementSummary(providerA.Id)
	require.NoError(t, err)
	summaryB, err := GetHubProviderSettlementSummary(providerB.Id)
	require.NoError(t, err)
	assert.Equal(t, 40, summaryA.TransferredBalanceQuota)
	assert.Equal(t, 160, summaryA.WithdrawableQuota)
	assert.Equal(t, 50, summaryB.TransferredBalanceQuota)
	assert.Equal(t, 250, summaryB.WithdrawableQuota)

	require.NoError(t, DB.First(&owner, owner.Id).Error)
	assert.Equal(t, 100, owner.Quota)
}
