/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHubProviderPayoutAccountsValidateMethodsAndMaintainDefault(t *testing.T) {
	truncateTables(t)
	provider := HubProvider{Id: 20, OwnerUserId: 120, Slot: 1, Name: "Payout Provider", Slug: "payout-provider", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)

	alipay, err := CreateHubProviderPayoutAccount(provider.OwnerUserId, HubProviderPayoutAccountInput{
		Method:  HubProviderPayoutMethodAlipay,
		Details: HubProviderPayoutAccountDetails{RecipientName: "Alice", Account: "alice@example.com"},
	})
	require.NoError(t, err)
	assert.True(t, alipay.IsDefault)
	assert.Equal(t, "ali****.com", alipay.MaskedSummary)

	asset, err := CreateHubProviderPayoutAsset(provider.OwnerUserId, "image/png", []byte("png"))
	require.NoError(t, err)
	wechat, err := CreateHubProviderPayoutAccount(provider.OwnerUserId, HubProviderPayoutAccountInput{
		Method:        HubProviderPayoutMethodWeChat,
		Details:       HubProviderPayoutAccountDetails{RecipientName: "Alice WeChat"},
		QRCodeAssetId: asset.Id,
		IsDefault:     true,
	})
	require.NoError(t, err)
	assert.True(t, wechat.IsDefault)
	assert.True(t, wechat.QRCodeAvailable)

	items, err := ListHubProviderPayoutAccounts(provider.OwnerUserId)
	require.NoError(t, err)
	require.Len(t, items, 2)
	assert.Equal(t, wechat.Id, items[0].Id)
	assert.False(t, items[1].IsDefault)

	require.NoError(t, DeleteHubProviderPayoutAccount(provider.OwnerUserId, wechat.Id))
	items, err = ListHubProviderPayoutAccounts(provider.OwnerUserId)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.True(t, items[0].IsDefault)
}

func TestHubProviderPayoutAccountRejectsIncompleteDetails(t *testing.T) {
	truncateTables(t)
	provider := HubProvider{Id: 21, OwnerUserId: 121, Slot: 1, Name: "Validation Provider", Slug: "validation-provider", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)

	_, err := CreateHubProviderPayoutAccount(provider.OwnerUserId, HubProviderPayoutAccountInput{
		Method:  HubProviderPayoutMethodAlipay,
		Details: HubProviderPayoutAccountDetails{RecipientName: "Alice"},
	})
	assert.ErrorIs(t, err, ErrHubProviderPayoutAccountInvalid)

	_, err = CreateHubProviderPayoutAccount(provider.OwnerUserId, HubProviderPayoutAccountInput{
		Method:  HubProviderPayoutMethodWeChat,
		Details: HubProviderPayoutAccountDetails{RecipientName: "Alice"},
	})
	assert.ErrorIs(t, err, ErrHubProviderPayoutAccountInvalid)

	_, err = CreateHubProviderPayoutAccount(provider.OwnerUserId, HubProviderPayoutAccountInput{
		Method: HubProviderPayoutMethodBank,
		Details: HubProviderPayoutAccountDetails{
			RecipientName: "Alice",
			Account:       "6222000000000000",
			AccountType:   HubProviderPayoutAccountTypePersonal,
		},
	})
	assert.ErrorIs(t, err, ErrHubProviderPayoutAccountInvalid)
}

func TestHubProviderWithdrawalKeepsPayoutAccountSnapshotAfterAccountUpdate(t *testing.T) {
	truncateTables(t)
	provider := HubProvider{Id: 22, OwnerUserId: 122, Slot: 1, Name: "Snapshot Provider", Slug: "snapshot-provider", Status: HubProviderStatusActive}
	require.NoError(t, DB.Create(&provider).Error)
	account := seedSettlementPayoutAccount(t, provider)
	_, err := CreateHubProviderManualAdjustment(provider.Id, 200, 999, "initial credit")
	require.NoError(t, err)

	withdrawal, err := CreateHubProviderWithdrawal(provider.OwnerUserId, 100, account.Id)
	require.NoError(t, err)
	require.NotNil(t, withdrawal.PayoutAccount)
	assert.Equal(t, "alice@example.com", withdrawal.PayoutAccount.Details.Account)

	_, err = UpdateHubProviderPayoutAccount(provider.OwnerUserId, account.Id, HubProviderPayoutAccountInput{
		Method:    HubProviderPayoutMethodAlipay,
		Details:   HubProviderPayoutAccountDetails{RecipientName: "Alice", Account: "new@example.com"},
		IsDefault: true,
	})
	require.NoError(t, err)

	items, _, err := ListHubProviderWithdrawals(provider.Id, 0, 10)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.NotNil(t, items[0].PayoutAccount)
	assert.Equal(t, "alice@example.com", items[0].PayoutAccount.Details.Account)
}
