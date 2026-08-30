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
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_provider_settlement_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPrepareHubProviderEarningUsesTenantPlatformFee(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Tenant{}, &HubProvider{}, &HubProviderEarning{}))

	settings := hub_provider_settlement_setting.Get()
	original := *settings
	settings.PlatformFeeBasisPoints = 3000
	t.Cleanup(func() { *settings = original })

	tenant := &Tenant{Name: "Snapshot tenant", Slug: "snapshot-tenant", Status: TenantStatusActive}
	require.NoError(t, db.Create(tenant).Error)
	override := 2000
	_, err := UpdateHubTenantPlatformFeeBasisPoints(tenant.Id, &override)
	require.NoError(t, err)

	provider := &HubProvider{OwnerUserId: 90102, Slot: 1, Name: "Tenant fee provider", Slug: "tenant-fee-provider", Status: HubProviderStatusActive, TenantId: &tenant.Id}
	require.NoError(t, db.Create(provider).Error)
	earning, err := PrepareHubProviderEarning(HubProviderEarningParams{
		RequestId: "tenant-fee-snapshot-current", ProviderId: provider.Id, OwnerUserId: provider.OwnerUserId,
		SupplyGroupId: 3, ChannelId: 4, GrossQuota: 1000, TenantId: tenant.Id,
		HasProviderServiceFeeBasisPoints: true, ProviderServiceFeeBasisPoints: 1000,
	})
	require.NoError(t, err)
	assert.Equal(t, 2000, earning.PlatformFeeBasisPoints)
	assert.Equal(t, 20, earning.PlatformFeeQuota)
}

func seedHubTenantFinance(t *testing.T) (*Tenant, *User) {
	t.Helper()
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(
		&Tenant{}, &TenantMember{}, &User{}, &HubProviderEarning{},
		&HubTenantPayoutAsset{}, &HubTenantPayoutAccount{}, &HubTenantWithdrawal{},
	))
	tenant := &Tenant{Name: "Finance tenant", Slug: "finance-tenant", Status: TenantStatusActive}
	require.NoError(t, db.Create(tenant).Error)
	owner := &User{
		Id: 90101, Username: "finance-owner", Password: "unused", Status: common.UserStatusEnabled,
		AffCode: "finance-owner", Quota: 100,
	}
	require.NoError(t, db.Create(owner).Error)
	require.NoError(t, db.Create(&TenantMember{
		TenantId: tenant.Id, UserId: owner.Id, Role: TenantMemberRoleOwner, Status: TenantMemberStatusActive,
	}).Error)
	return tenant, owner
}

func createHubTenantUsageEarning(t *testing.T, tenantID, id, status, netIncome int) *HubProviderEarning {
	t.Helper()
	statusValue := HubProviderEarningStatusSettled
	if status == 0 {
		statusValue = HubProviderEarningStatusPending
	}
	earning := &HubProviderEarning{
		RequestId: fmt.Sprintf("tenant-finance-usage-%d", id), EntryType: HubProviderEarningTypeUsage,
		Status: statusValue, ProviderId: 700 + id, TenantId: tenantID, OwnerUserId: 800 + id,
		ConsumerUserId: 900 + id, SupplyGroupId: 100 + id, ChannelId: 200 + id,
		GrossQuota: netIncome + 10, PlatformFeeQuota: 1, ResellerGrossQuota: netIncome + 1,
		ResellerNetIncomeQuota: netIncome, SettlementVersion: 2,
	}
	require.NoError(t, DB.Create(earning).Error)
	return earning
}

func TestHubTenantSettlementSummaryAndBalanceTransferAreIndependentAndIdempotent(t *testing.T) {
	tenant, owner := seedHubTenantFinance(t)
	createHubTenantUsageEarning(t, tenant.Id, 1, 1, 90)
	createHubTenantUsageEarning(t, tenant.Id, 2, 0, 45)

	summary, err := GetHubTenantSettlementSummary(tenant.Id)
	require.NoError(t, err)
	assert.Equal(t, 90, summary.SettledIncomeQuota)
	assert.Equal(t, 45, summary.PendingIncomeQuota)
	assert.Equal(t, 90, summary.ResellerNetIncomeQuota)
	assert.Equal(t, 90, summary.WithdrawableQuota)

	transfer, err := CreateHubTenantBalanceTransfer(tenant.Id, owner.Id, 30, "transfer-1")
	require.NoError(t, err)
	assert.Equal(t, -30, transfer.ResellerNetIncomeQuota)
	assert.Equal(t, HubProviderEarningTypeBalanceTransfer, transfer.EntryType)
	var updated User
	require.NoError(t, DB.First(&updated, owner.Id).Error)
	assert.Equal(t, 130, updated.Quota)

	repeated, err := CreateHubTenantBalanceTransfer(tenant.Id, owner.Id, 30, "transfer-1")
	require.NoError(t, err)
	assert.Equal(t, transfer.Id, repeated.Id)
	require.NoError(t, DB.First(&updated, owner.Id).Error)
	assert.Equal(t, 130, updated.Quota)

	_, err = CreateHubTenantBalanceTransfer(tenant.Id, owner.Id, 31, "transfer-1")
	assert.ErrorIs(t, err, ErrHubProviderEarningReferenceConflict)

	summary, err = GetHubTenantSettlementSummary(tenant.Id)
	require.NoError(t, err)
	assert.Equal(t, 30, summary.TransferredBalanceQuota)
	assert.Equal(t, 60, summary.WithdrawableQuota)
	_, err = CreateHubTenantBalanceTransfer(tenant.Id, owner.Id, 61, "transfer-2")
	assert.ErrorIs(t, err, ErrHubTenantBalanceTransferInsufficient)
}

func TestAdminListHubTenantSettlementSummariesUsesTenantScopedBalances(t *testing.T) {
	tenant, _ := seedHubTenantFinance(t)
	createHubTenantUsageEarning(t, tenant.Id, 5, 1, 75)

	items, err := AdminListHubTenantSettlementSummaries()
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, tenant.Id, items[0].TenantId)
	assert.Equal(t, tenant.Name, items[0].TenantName)
	assert.Equal(t, tenant.Slug, items[0].TenantSlug)
	assert.Equal(t, 75, items[0].Summary.SettledIncomeQuota)
	assert.Equal(t, 75, items[0].Summary.WithdrawableQuota)
	assert.True(t, items[0].Reconciliation.Reconciled)
	assert.Empty(t, items[0].Reconciliation.Issues)
}

func TestHubTenantSettlementReconciliationDetectsWithdrawalLedgerProblems(t *testing.T) {
	tenant, owner := seedHubTenantFinance(t)
	createHubTenantUsageEarning(t, tenant.Id, 6, 1, 100)
	for _, amount := range []int{75, 35} {
		require.NoError(t, DB.Create(&HubTenantWithdrawal{
			TenantId: tenant.Id, OwnerUserId: owner.Id, AmountQuota: amount,
			Status: HubTenantWithdrawalStatusPending,
		}).Error)
	}

	summary, err := GetHubTenantSettlementSummary(tenant.Id)
	require.NoError(t, err)
	reconciliation, err := GetHubTenantSettlementReconciliation(tenant.Id, tenant.Status, summary)
	require.NoError(t, err)
	assert.False(t, reconciliation.Reconciled)
	assert.Equal(t, 2, reconciliation.OpenWithdrawalCount)
	assert.Contains(t, reconciliation.Issues, HubTenantReconciliationIssueMissingPayoutSnapshot)
	assert.Contains(t, reconciliation.Issues, HubTenantReconciliationIssueMultipleOpenWithdrawals)
	assert.Contains(t, reconciliation.Issues, HubTenantReconciliationIssueDebitsExceedIncome)
}

func TestHubTenantWithdrawalReservesOnlyTenantIncome(t *testing.T) {
	tenant, owner := seedHubTenantFinance(t)
	createHubTenantUsageEarning(t, tenant.Id, 3, 1, 100)
	account, err := CreateHubTenantPayoutAccount(tenant.Id, owner.Id, HubProviderPayoutAccountInput{
		Method:    HubProviderPayoutMethodAlipay,
		Details:   HubProviderPayoutAccountDetails{RecipientName: "Finance Owner", Account: "owner@example.com"},
		IsDefault: true,
	})
	require.NoError(t, err)
	require.NotZero(t, account.Id)

	withdrawal, err := CreateHubTenantWithdrawal(tenant.Id, owner.Id, 60, account.Id)
	require.NoError(t, err)
	assert.Equal(t, HubTenantWithdrawalStatusApproved, withdrawal.Status)
	assert.NotZero(t, withdrawal.ReviewedAt)
	_, err = CreateHubTenantWithdrawal(tenant.Id, owner.Id, 1, account.Id)
	assert.ErrorIs(t, err, ErrHubTenantWithdrawalPending)

	summary, err := GetHubTenantSettlementSummary(tenant.Id)
	require.NoError(t, err)
	assert.Equal(t, 60, summary.ReservedWithdrawalQuota)
	assert.Equal(t, 0, summary.PaidWithdrawalQuota)
	assert.Equal(t, 40, summary.WithdrawableQuota)

	_, _, err = UpdateHubTenantWithdrawalStatus(withdrawal.Id, HubTenantWithdrawalStatusApproved, 1, "approved", nil)
	require.NoError(t, err)
	_, _, err = UpdateHubTenantWithdrawalStatus(withdrawal.Id, HubTenantWithdrawalStatusRejected, 1, "rejected for test", nil)
	require.NoError(t, err)
	summary, err = GetHubTenantSettlementSummary(tenant.Id)
	require.NoError(t, err)
	assert.Equal(t, 0, summary.ReservedWithdrawalQuota)
	assert.Equal(t, 100, summary.WithdrawableQuota)

	withdrawal, err = CreateHubTenantWithdrawal(tenant.Id, owner.Id, 50, account.Id)
	require.NoError(t, err)
	_, changed, err := UpdateHubTenantWithdrawalStatus(withdrawal.Id, HubTenantWithdrawalStatusPaid, 1, "paid for test", &HubProviderWithdrawalPayment{
		Currency: "CNY", AmountMinor: 5000, ExchangeRate: "1",
	})
	require.NoError(t, err)
	assert.True(t, changed)
	_, changed, err = UpdateHubTenantWithdrawalStatus(withdrawal.Id, HubTenantWithdrawalStatusPaid, 1, "idempotent retry", &HubProviderWithdrawalPayment{
		Currency: "CNY", AmountMinor: 5000, ExchangeRate: "1",
	})
	require.NoError(t, err)
	assert.False(t, changed)
	_, _, err = UpdateHubTenantWithdrawalStatus(withdrawal.Id, HubTenantWithdrawalStatusPaid, 1, "conflicting retry", &HubProviderWithdrawalPayment{
		Currency: "CNY", AmountMinor: 4900, ExchangeRate: "1",
	})
	assert.ErrorIs(t, err, ErrHubTenantWithdrawalPaymentInvalid)
	summary, err = GetHubTenantSettlementSummary(tenant.Id)
	require.NoError(t, err)
	assert.Equal(t, 50, summary.PaidWithdrawalQuota)
	assert.Equal(t, 50, summary.WithdrawableQuota)
}

func TestHubTenantFinanceRequiresActiveOwner(t *testing.T) {
	tenant, owner := seedHubTenantFinance(t)
	createHubTenantUsageEarning(t, tenant.Id, 4, 1, 100)
	require.NoError(t, DB.Model(&TenantMember{}).
		Where("tenant_id = ? AND user_id = ?", tenant.Id, owner.Id).
		Update("status", TenantMemberStatusDisabled).Error)
	_, err := CreateHubTenantBalanceTransfer(tenant.Id, owner.Id, 10, "disabled-owner")
	assert.ErrorIs(t, err, ErrHubTenantFinanceOwnerRequired)
	_, err = CreateHubTenantPayoutAccount(tenant.Id, owner.Id, HubProviderPayoutAccountInput{
		Method:  HubProviderPayoutMethodAlipay,
		Details: HubProviderPayoutAccountDetails{RecipientName: "Disabled", Account: "disabled@example.com"},
	})
	assert.ErrorIs(t, err, ErrHubTenantFinanceOwnerRequired)
	assert.False(t, errors.Is(err, ErrHubProviderPayoutAccountInvalid))
}

func TestHubTenantReconciliationRequiresEnabledOwnerUser(t *testing.T) {
	tenant, owner := seedHubTenantFinance(t)
	createHubTenantUsageEarning(t, tenant.Id, 7, 1, 100)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", owner.Id).Update("status", common.UserStatusDisabled).Error)

	summary, err := GetHubTenantSettlementSummary(tenant.Id)
	require.NoError(t, err)
	reconciliation, err := GetHubTenantSettlementReconciliation(tenant.Id, tenant.Status, summary)
	require.NoError(t, err)
	assert.False(t, reconciliation.Reconciled)
	assert.Contains(t, reconciliation.Issues, HubTenantReconciliationIssueActiveOwnerMissing)
}
