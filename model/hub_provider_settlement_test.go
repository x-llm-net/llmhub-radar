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

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedSettlementPayoutAccount(t *testing.T, provider HubProvider) *HubProviderPayoutAccount {
	t.Helper()
	account, err := CreateHubProviderPayoutAccount(provider.OwnerUserId, HubProviderPayoutAccountInput{
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
	assert.Equal(t, 101, entries[0].PlatformFeeQuota)
	assert.Equal(t, 904, entries[0].ProviderIncomeQuota)
	assert.Equal(t, params.GrossQuota, entries[0].PlatformFeeQuota+entries[0].ProviderIncomeQuota)
	assert.NotZero(t, entries[0].SettledAt)

	conflict := params
	conflict.ChannelId = 99
	_, err = PrepareHubProviderEarning(conflict)
	assert.ErrorIs(t, err, ErrHubProviderEarningReferenceConflict)
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
	assert.Equal(t, 900, summary.SettledIncomeQuota)
	assert.Equal(t, 450, summary.PendingIncomeQuota)
	assert.Equal(t, 900, summary.WithdrawableQuota)

	withdrawal, err := CreateHubProviderWithdrawal(provider.OwnerUserId, 600, payoutAccount.Id)
	require.NoError(t, err)
	assert.Equal(t, HubProviderWithdrawalStatusPending, withdrawal.Status)
	_, err = CreateHubProviderWithdrawal(provider.OwnerUserId, 1, payoutAccount.Id)
	assert.ErrorIs(t, err, ErrHubProviderWithdrawalPending)

	summary, err = GetHubProviderSettlementSummary(provider.Id)
	require.NoError(t, err)
	assert.Equal(t, 600, summary.ReservedWithdrawalQuota)
	assert.Equal(t, 300, summary.WithdrawableQuota)

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
	assert.Equal(t, 300, summary.WithdrawableQuota)
}

func TestHubProviderWithdrawalCanBePaidDirectly(t *testing.T) {
	truncateTables(t)
	provider := HubProvider{Id: 2, OwnerUserId: 102, Slot: 1, Name: "Provider 2", Slug: "provider-two", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)
	payoutAccount := seedSettlementPayoutAccount(t, provider)
	_, err := CreateHubProviderManualAdjustment(provider.Id, 200, 999, "initial credit")
	require.NoError(t, err)
	withdrawal, err := CreateHubProviderWithdrawal(provider.OwnerUserId, 100, payoutAccount.Id)
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
	_, err := CreateHubProviderWithdrawal(provider.OwnerUserId, 1, payoutAccount.Id)
	assert.ErrorIs(t, err, ErrHubProviderWithdrawalInsufficient)

	adjustment, err := CreateHubProviderManualAdjustment(provider.Id, 200, 999, "initial credit")
	require.NoError(t, err)
	assert.Equal(t, HubProviderEarningTypeAdjustment, adjustment.EntryType)
	withdrawal, err := CreateHubProviderWithdrawal(provider.OwnerUserId, 100, payoutAccount.Id)
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

func TestHubProviderWithdrawalRequiresExistingPayoutAccount(t *testing.T) {
	truncateTables(t)
	provider := HubProvider{Id: 4, OwnerUserId: 104, Slot: 1, Name: "Provider 4", Slug: "provider-four", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)
	_, err := CreateHubProviderManualAdjustment(provider.Id, 200, 999, "initial credit")
	require.NoError(t, err)

	_, err = CreateHubProviderWithdrawal(provider.OwnerUserId, 100, 999)
	assert.ErrorIs(t, err, ErrHubProviderPayoutAccountNotFound)
}
