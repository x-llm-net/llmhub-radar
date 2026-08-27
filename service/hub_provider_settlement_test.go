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
package service

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/hub_provider_settlement_setting"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type providerSettlementProbe struct {
	settleCalls int
}

func (p *providerSettlementProbe) Settle(int) error {
	p.settleCalls++
	return nil
}
func (*providerSettlementProbe) Refund(*gin.Context)       {}
func (*providerSettlementProbe) NeedsRefund() bool         { return false }
func (*providerSettlementProbe) GetPreConsumedQuota() int  { return 0 }
func (*providerSettlementProbe) Reserve(int) error         { return nil }
func (*providerSettlementProbe) SettlementCommitted() bool { return false }

func TestProviderEarningPreparationFailureStopsConsumerSettlement(t *testing.T) {
	truncate(t)
	ctx, _ := gin.CreateTestContext(nil)
	billing := &providerSettlementProbe{}
	info := &relaycommon.RelayInfo{
		RequestId:       "req-invalid-provider-fee-snapshot",
		UserId:          10,
		TokenId:         20,
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: 30},
		OriginModelName: "gpt-5",
		BillingSource:   BillingSourceWallet,
		Billing:         billing,
		PriceData: hosttypes.PriceData{GroupRatioInfo: hosttypes.GroupRatioInfo{
			GroupRatio:                5.5,
			BaseGroupRatio:            1,
			SupplyMultiplier:          5.5,
			HasSupplyPricing:          true,
			SupplyGroupId:             40,
			SupplyProviderId:          50,
			SupplyOwnerUserId:         60,
			PlatformFeeBasisPoints:    10001,
			HasPlatformFeeBasisPoints: true,
		}},
	}

	err := SettleBillingAndProviderEarning(ctx, info, 1000)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid hub provider platform fee snapshot")
	assert.Zero(t, billing.settleCalls)
}

func TestSettleBillingAndProviderEarningCreatesOneSettledEntry(t *testing.T) {
	truncate(t)
	seedUser(t, 10, 10_000)
	seedToken(t, 20, 10, "settlement-token", 10_000)
	ctx, _ := gin.CreateTestContext(nil)
	info := &relaycommon.RelayInfo{
		RequestId:             "req-service-settlement",
		UserId:                10,
		TokenId:               20,
		ChannelMeta:           &relaycommon.ChannelMeta{ChannelId: 30},
		OriginModelName:       "claude-opus-5",
		BillingSource:         BillingSourceWallet,
		FinalPreConsumedQuota: 1000,
		PriceData: hosttypes.PriceData{GroupRatioInfo: hosttypes.GroupRatioInfo{
			GroupRatio:        0.9,
			BaseGroupRatio:    1,
			SupplyMultiplier:  0.9,
			HasSupplyPricing:  true,
			SupplyGroupId:     40,
			SupplyProviderId:  50,
			SupplyOwnerUserId: 60,
		}},
	}
	require.NoError(t, SettleBillingAndProviderEarning(ctx, info, 1000))
	require.NoError(t, SettleBillingAndProviderEarning(ctx, info, 1000))
	assert.True(t, info.PriceData.GroupRatioInfo.HasPlatformFeeBasisPoints)
	assert.Equal(t, model.HubProviderPlatformFeeBasisPoints, info.PriceData.GroupRatioInfo.PlatformFeeBasisPoints)

	var entries []model.HubProviderEarning
	require.NoError(t, model.DB.Find(&entries).Error)
	require.Len(t, entries, 1)
	assert.Equal(t, model.HubProviderEarningStatusSettled, entries[0].Status)
	assert.Equal(t, 300, entries[0].PlatformFeeQuota)
	assert.Equal(t, 700, entries[0].ProviderIncomeQuota)
}

func TestFallbackReferralSettingControlsEarningPreparation(t *testing.T) {
	truncate(t)
	settings := hub_provider_settlement_setting.Get()
	original := *settings
	t.Cleanup(func() { *settings = original })
	settings.FallbackReferralBasisPoints = 100

	serviceProvider := model.HubProvider{OwnerUserId: 61, Slot: 1, Name: "Service Provider", Slug: "service-provider", Status: model.HubProviderStatusActive}
	originProvider := model.HubProvider{OwnerUserId: 62, Slot: 1, Name: "Origin Provider", Slug: "origin-provider", Status: model.HubProviderStatusActive}
	require.NoError(t, model.DB.Create(&serviceProvider).Error)
	require.NoError(t, model.DB.Create(&originProvider).Error)

	newRelayInfo := func(requestID string) *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{
			RequestId: requestID, UserId: 10, TokenId: 20,
			ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: 30},
			OriginModelName: "gpt-5", BillingSource: BillingSourceWallet,
			PriceData: hosttypes.PriceData{GroupRatioInfo: hosttypes.GroupRatioInfo{
				GroupRatio: 1, BaseGroupRatio: 1, SupplyMultiplier: 1,
				HasSupplyPricing: true, SupplyGroupId: 40,
				SupplyProviderId: serviceProvider.Id, SupplyOwnerUserId: serviceProvider.OwnerUserId,
			}},
		}
	}

	for _, test := range []struct {
		name         string
		enabled      bool
		fallback     bool
		wantReferral int
	}{
		{name: "fallback enabled", enabled: true, fallback: true, wantReferral: 10},
		{name: "setting disabled", enabled: false, fallback: true},
		{name: "preferred request", enabled: true, fallback: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			settings.FallbackReferralEnabled = test.enabled
			ctx, _ := gin.CreateTestContext(nil)
			common.SetContextKey(ctx, constant.ContextKeyHubRequestedProviderId, originProvider.Id)
			common.SetContextKey(ctx, constant.ContextKeyHubRoutingFallback, test.fallback)
			requestID, err := prepareHubProviderEarning(ctx, newRelayInfo("req-referral-setting-"+test.name), 1000, nil)
			require.NoError(t, err)
			var earning model.HubProviderEarning
			require.NoError(t, model.DB.Where("request_id = ?", requestID).First(&earning).Error)
			assert.Equal(t, test.wantReferral, earning.ReferralIncomeQuota)
			if test.wantReferral == 0 {
				assert.Zero(t, earning.ReferralProviderId)
			} else {
				assert.Equal(t, originProvider.Id, earning.ReferralProviderId)
			}
		})
	}
}

func TestSettleBillingAndProviderEarningUsesRetainedPreConsumeOnFinalShortfall(t *testing.T) {
	truncate(t)
	const userID, tokenID = 12, 22
	seedUser(t, userID, 200)
	seedToken(t, tokenID, userID, "retained-settlement-token", 200)
	ctx, _ := gin.CreateTestContext(nil)
	info := &relaycommon.RelayInfo{
		RequestId:       "req-retained-provider-settlement",
		UserId:          userID,
		TokenId:         tokenID,
		TokenKey:        "retained-settlement-token",
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: 32},
		OriginModelName: "gpt-5",
		BillingSource:   BillingSourceWallet,
		PriceData: hosttypes.PriceData{GroupRatioInfo: hosttypes.GroupRatioInfo{
			GroupRatio:        1,
			BaseGroupRatio:    1,
			SupplyMultiplier:  1,
			HasSupplyPricing:  true,
			SupplyGroupId:     42,
			SupplyProviderId:  52,
			SupplyOwnerUserId: 62,
		}},
	}
	info.Billing = &BillingSession{
		relayInfo: info,
		funding: &WalletFunding{
			userId: userID, consumed: 800,
		},
		preConsumedQuota: 800,
		tokenConsumed:    800,
	}

	require.ErrorIs(t, SettleBillingAndProviderEarning(ctx, info, 1100), errWalletQuotaInsufficient)
	assert.Equal(t, 800, BillingCommittedQuota(info))
	assert.Equal(t, 200, getUserQuota(t, userID))
	assert.Equal(t, 200, getTokenRemainQuota(t, tokenID))

	var earning model.HubProviderEarning
	require.NoError(t, model.DB.Where("request_id = ?", info.RequestId).First(&earning).Error)
	assert.Equal(t, model.HubProviderEarningStatusSettled, earning.Status)
	assert.Equal(t, 800, earning.GrossQuota)
	assert.Equal(t, earning.GrossQuota, earning.PlatformFeeQuota+earning.ProviderIncomeQuota)
}

func TestSettleBillingAndProviderEarningUsesProviderFeeOverrideSnapshot(t *testing.T) {
	truncate(t)
	seedUser(t, 10, 10_000)
	seedToken(t, 20, 10, "fee-override-token", 10_000)
	provider := &model.HubProvider{
		OwnerUserId: 99010,
		Name:        "Fee Override Provider",
		Slug:        "fee-override-provider",
		PlatformFeeBasisPoints: func() *int {
			fee := 2500
			return &fee
		}(),
	}
	require.NoError(t, model.DB.Create(provider).Error)

	ctx, _ := gin.CreateTestContext(nil)
	info := &relaycommon.RelayInfo{
		RequestId:       "req-provider-fee-override",
		UserId:          10,
		TokenId:         20,
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: 30},
		OriginModelName: "gpt-5",
		BillingSource:   BillingSourceWallet,
		PriceData: hosttypes.PriceData{GroupRatioInfo: hosttypes.GroupRatioInfo{
			GroupRatio:        5.5,
			BaseGroupRatio:    1,
			SupplyMultiplier:  5.5,
			HasSupplyPricing:  true,
			SupplyGroupId:     40,
			SupplyProviderId:  provider.Id,
			SupplyOwnerUserId: provider.OwnerUserId,
		}},
	}

	require.NoError(t, SettleBillingAndProviderEarning(ctx, info, 1000))
	assert.True(t, info.PriceData.GroupRatioInfo.HasPlatformFeeBasisPoints)
	assert.Equal(t, 2500, info.PriceData.GroupRatioInfo.PlatformFeeBasisPoints)

	var earning model.HubProviderEarning
	require.NoError(t, model.DB.Where("request_id = ?", info.RequestId).First(&earning).Error)
	assert.Equal(t, 2500, earning.PlatformFeeBasisPoints)
	assert.Equal(t, 250, earning.PlatformFeeQuota)
	assert.Equal(t, 750, earning.ProviderIncomeQuota)
}

func TestSettleTaskBillingLeavesProviderEarningPending(t *testing.T) {
	truncate(t)
	seedUser(t, 11, 10_000)
	seedToken(t, 21, 11, "task-settlement-token", 10_000)
	ctx, _ := gin.CreateTestContext(nil)
	info := &relaycommon.RelayInfo{
		RequestId:             "req-service-task",
		UserId:                11,
		TokenId:               21,
		ChannelMeta:           &relaycommon.ChannelMeta{ChannelId: 31},
		OriginModelName:       "video-model",
		BillingSource:         BillingSourceWallet,
		FinalPreConsumedQuota: 2000,
		PriceData: hosttypes.PriceData{GroupRatioInfo: hosttypes.GroupRatioInfo{
			GroupRatio:        1,
			BaseGroupRatio:    1,
			SupplyMultiplier:  1,
			HasSupplyPricing:  true,
			SupplyGroupId:     41,
			SupplyProviderId:  51,
			SupplyOwnerUserId: 61,
		}},
	}
	require.NoError(t, SettleTaskBillingAndPrepareProviderEarning(ctx, info, 2000))
	assert.True(t, info.PriceData.GroupRatioInfo.HasPlatformFeeBasisPoints)
	assert.Equal(t, model.HubProviderPlatformFeeBasisPoints, info.PriceData.GroupRatioInfo.PlatformFeeBasisPoints)

	var earning model.HubProviderEarning
	require.NoError(t, model.DB.Where("request_id = ?", info.RequestId).First(&earning).Error)
	assert.Equal(t, model.HubProviderEarningStatusPending, earning.Status)
	require.NotNil(t, earning.SettlementDeferred)
	assert.True(t, *earning.SettlementDeferred)

	recovery, err := RecoverReadyHubProviderEarnings(ctx, 10)
	require.NoError(t, err)
	assert.Zero(t, recovery.Scanned)
	require.NoError(t, model.DB.Where("request_id = ?", info.RequestId).First(&earning).Error)
	assert.Equal(t, model.HubProviderEarningStatusPending, earning.Status)

	task := &model.Task{
		TaskID: "task-settlement-success",
		Quota:  2100,
		PrivateData: model.TaskPrivateData{
			RequestId: info.RequestId,
		},
	}
	FinalizeTaskProviderEarning(ctx, task)
	require.NoError(t, model.DB.Where("request_id = ?", info.RequestId).First(&earning).Error)
	assert.Equal(t, model.HubProviderEarningStatusSettled, earning.Status)
	require.NotNil(t, earning.SettlementDeferred)
	assert.False(t, *earning.SettlementDeferred)
	assert.Equal(t, 2100, earning.GrossQuota)
	assert.Equal(t, 1470, earning.ProviderIncomeQuota)
}

func TestRecoverReadyHubProviderEarningAfterConsumerBilling(t *testing.T) {
	truncate(t)
	ready := false
	params := model.HubProviderEarningParams{
		RequestId: "req-service-recover-ready", ProviderId: 71, OwnerUserId: 81,
		ConsumerUserId: 91, TokenId: 101, SupplyGroupId: 111, ChannelId: 121,
		ModelName: "claude-sonnet-5", BillingSource: BillingSourceWallet, GrossQuota: 1200,
		BaseGroupRatio: 1, SupplyMultiplier: 0.8, BillingRatio: 0.8,
		SettlementDeferred: &ready,
	}
	_, err := model.PrepareHubProviderEarning(params)
	require.NoError(t, err)

	result, err := RecoverReadyHubProviderEarnings(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Scanned)
	assert.Equal(t, 1, result.Completed)
	assert.Zero(t, result.Failed)

	var earning model.HubProviderEarning
	require.NoError(t, model.DB.Where("request_id = ?", params.RequestId).First(&earning).Error)
	assert.Equal(t, model.HubProviderEarningStatusSettled, earning.Status)
	assert.Equal(t, 840, earning.ProviderIncomeQuota)
}

func TestCancelTaskProviderEarningCancelsPendingEntry(t *testing.T) {
	truncate(t)
	ctx, _ := gin.CreateTestContext(nil)
	params := model.HubProviderEarningParams{
		RequestId: "req-service-task-failed", ProviderId: 51, OwnerUserId: 61,
		ConsumerUserId: 11, TokenId: 21, SupplyGroupId: 41, ChannelId: 31,
		ModelName: "video-model", BillingSource: BillingSourceWallet, GrossQuota: 2000,
		BaseGroupRatio: 1, SupplyMultiplier: 1, BillingRatio: 1,
	}
	_, err := model.PrepareHubProviderEarning(params)
	require.NoError(t, err)
	task := &model.Task{
		TaskID: "task-settlement-failed",
		PrivateData: model.TaskPrivateData{
			RequestId: params.RequestId,
		},
	}
	CancelTaskProviderEarning(ctx, task)

	var earning model.HubProviderEarning
	require.NoError(t, model.DB.Where("request_id = ?", params.RequestId).First(&earning).Error)
	assert.Equal(t, model.HubProviderEarningStatusCancelled, earning.Status)
}
