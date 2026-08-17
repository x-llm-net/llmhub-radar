package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBillingSessionSubscriptionSettlementUsesWalletOverflow(t *testing.T) {
	truncate(t)

	const userID = 801
	const tokenID = 801
	const subscriptionID = 801
	seedUser(t, userID, 1000)
	seedToken(t, tokenID, userID, "subscription-overflow-token", 1000)
	seedSubscription(t, subscriptionID, userID, 1000, 900)
	require.NoError(t, model.DB.Model(&model.UserSubscription{}).
		Where("id = ?", subscriptionID).
		Update("allow_wallet_overflow", true).Error)

	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID, TokenKey: "subscription-overflow-token",
		RequestId: "subscription-overflow-request",
	}
	session := &BillingSession{
		relayInfo: relayInfo,
		funding: &SubscriptionFunding{
			requestId: "subscription-overflow-request", userId: userID,
			subscriptionId: subscriptionID, preConsumed: 800,
		},
		preConsumedQuota: 800,
		tokenConsumed:    800,
	}
	relayInfo.Billing = session

	require.NoError(t, session.Settle(1000))

	assert.Equal(t, 800, getUserQuota(t, userID))
	assert.Equal(t, int64(900), getSubscriptionUsed(t, subscriptionID))
	assert.Equal(t, 800, getTokenRemainQuota(t, tokenID))
	assert.Zero(t, relayInfo.SubscriptionPostDelta)
	assert.Equal(t, int64(200), relayInfo.WalletOverflowPostDelta)
}

func TestBillingSessionSubscriptionSettlementHonorsDisabledWalletOverflow(t *testing.T) {
	truncate(t)

	const userID = 802
	const tokenID = 802
	const subscriptionID = 802
	seedUser(t, userID, 1000)
	seedToken(t, tokenID, userID, "strict-subscription-token", 1000)
	seedSubscription(t, subscriptionID, userID, 1000, 900)

	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID, TokenKey: "strict-subscription-token",
		RequestId: "strict-subscription-request",
	}
	session := &BillingSession{
		relayInfo: relayInfo,
		funding: &SubscriptionFunding{
			requestId: "strict-subscription-request", userId: userID,
			subscriptionId: subscriptionID, preConsumed: 800,
		},
		preConsumedQuota: 800,
		tokenConsumed:    800,
	}

	require.Error(t, session.Settle(1000))
	assert.Equal(t, 1000, getUserQuota(t, userID))
	assert.Equal(t, int64(900), getSubscriptionUsed(t, subscriptionID))
	assert.Equal(t, 1000, getTokenRemainQuota(t, tokenID))
}

func TestBillingSessionSettlementFailureRetainsSuccessfulRequestPreConsume(t *testing.T) {
	truncate(t)

	const userID, tokenID = 805, 805
	seedUser(t, userID, 200)
	seedToken(t, tokenID, userID, "settlement-insufficient-token", 200)
	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID, TokenKey: "settlement-insufficient-token",
		RequestId: "settlement-insufficient-request",
	}
	session := &BillingSession{
		relayInfo: relayInfo,
		funding: &WalletFunding{
			userId: userID, consumed: 800,
		},
		preConsumedQuota: 800,
		tokenConsumed:    800,
	}

	require.ErrorIs(t, session.Settle(1100), errWalletQuotaInsufficient)
	assert.False(t, session.NeedsRefund())
	assert.True(t, session.SettlementCommitted())
	assert.Equal(t, 800, session.CommittedQuota())
	session.Refund(nil)
	assert.Equal(t, 200, getUserQuota(t, userID))
	assert.Equal(t, 200, getTokenRemainQuota(t, tokenID))
}

func TestBillingSessionUsesSelectedSubscriptionWalletOverflowPolicy(t *testing.T) {
	truncate(t)

	const userID, tokenID, selectedSubscriptionID, otherSubscriptionID = 806, 806, 806, 807
	seedUser(t, userID, 1000)
	seedToken(t, tokenID, userID, "selected-subscription-token", 1000)
	seedSubscription(t, selectedSubscriptionID, userID, 1000, 900)
	seedSubscription(t, otherSubscriptionID, userID, 1000, 0)
	require.NoError(t, model.DB.Model(&model.UserSubscription{}).
		Where("id = ?", selectedSubscriptionID).
		Update("allow_wallet_overflow", true).Error)

	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID, TokenKey: "selected-subscription-token",
		RequestId: "selected-subscription-request",
	}
	session := &BillingSession{
		relayInfo: relayInfo,
		funding: &SubscriptionFunding{
			requestId: "selected-subscription-request", userId: userID,
			subscriptionId: selectedSubscriptionID, preConsumed: 800,
		},
		preConsumedQuota: 800,
		tokenConsumed:    800,
	}

	require.NoError(t, session.Settle(1000))
	assert.Equal(t, 800, getUserQuota(t, userID))
	assert.Equal(t, int64(900), getSubscriptionUsed(t, selectedSubscriptionID))
}

func TestBillingSessionKeepsSelectedSubscriptionStrictAfterExpiry(t *testing.T) {
	truncate(t)

	const userID, tokenID, subscriptionID = 808, 808, 808
	seedUser(t, userID, 1000)
	seedToken(t, tokenID, userID, "expired-strict-subscription-token", 1000)
	seedSubscription(t, subscriptionID, userID, 1000, 900)
	require.NoError(t, model.DB.Model(&model.UserSubscription{}).Where("id = ?", subscriptionID).Updates(map[string]any{
		"status":   "expired",
		"end_time": 1,
	}).Error)

	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID, TokenKey: "expired-strict-subscription-token",
		RequestId: "expired-strict-subscription-request",
	}
	session := &BillingSession{
		relayInfo: relayInfo,
		funding: &SubscriptionFunding{
			requestId: "expired-strict-subscription-request", userId: userID,
			subscriptionId: subscriptionID, preConsumed: 800,
		},
		preConsumedQuota: 800,
		tokenConsumed:    800,
	}

	require.ErrorIs(t, session.Settle(1000), model.ErrSubscriptionQuotaInsufficient)
	assert.Equal(t, 1000, getUserQuota(t, userID))
}

func TestPostConsumeQuotaTokenFailureDoesNotChargeWallet(t *testing.T) {
	truncate(t)

	const userID, tokenID = 809, 809
	seedUser(t, userID, 1000)
	seedToken(t, tokenID, userID, "legacy-token-insufficient", 100)
	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID, TokenKey: "legacy-token-insufficient",
	}

	require.ErrorIs(t, PostConsumeQuota(relayInfo, 200, 0, false), model.ErrTokenQuotaInsufficient)
	assert.Equal(t, 1000, getUserQuota(t, userID))
	assert.Equal(t, 100, getTokenRemainQuota(t, tokenID))
}

func TestPostConsumeQuotaFundingFailureRollsBackToken(t *testing.T) {
	truncate(t)

	const userID, tokenID = 810, 810
	seedUser(t, userID, 100)
	seedToken(t, tokenID, userID, "legacy-wallet-insufficient", 1000)
	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID, TokenKey: "legacy-wallet-insufficient",
	}

	require.ErrorIs(t, PostConsumeQuota(relayInfo, 200, 0, false), errWalletQuotaInsufficient)
	assert.Equal(t, 100, getUserQuota(t, userID))
	assert.Equal(t, 1000, getTokenRemainQuota(t, tokenID))
	assert.Zero(t, getTokenUsedQuota(t, tokenID))
}

func TestPostConsumeQuotaSubscriptionFailureRollsBackToken(t *testing.T) {
	truncate(t)

	const userID, tokenID, subscriptionID = 811, 811, 811
	seedUser(t, userID, 1000)
	seedToken(t, tokenID, userID, "legacy-subscription-insufficient", 1000)
	seedSubscription(t, subscriptionID, userID, 100, 100)
	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID, TokenKey: "legacy-subscription-insufficient",
		BillingSource: BillingSourceSubscription, SubscriptionId: subscriptionID,
	}

	require.ErrorIs(t, PostConsumeQuota(relayInfo, 200, 0, false), model.ErrSubscriptionQuotaInsufficient)
	assert.Equal(t, int64(100), getSubscriptionUsed(t, subscriptionID))
	assert.Equal(t, 1000, getTokenRemainQuota(t, tokenID))
	assert.Zero(t, getTokenUsedQuota(t, tokenID))
}

func TestBillingSessionTrustedRealtimeReserveStartsDurableReservation(t *testing.T) {
	truncate(t)

	const userID = 803
	const tokenID = 803
	seedUser(t, userID, 1000)
	seedToken(t, tokenID, userID, "trusted-realtime-token", 1000)

	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID, TokenKey: "trusted-realtime-token",
		IsPlayground: true,
	}
	session := &BillingSession{
		relayInfo: relayInfo,
		funding:   &WalletFunding{userId: userID},
		trusted:   true,
	}

	require.NoError(t, session.Reserve(200))

	assert.Equal(t, 200, session.GetPreConsumedQuota())
	assert.False(t, session.trusted)
	assert.Equal(t, 800, getUserQuota(t, userID))
	assert.Equal(t, 1000, getTokenRemainQuota(t, tokenID))
}

func TestSettleBillingCreatesDurableSessionForZeroBaseSurcharge(t *testing.T) {
	truncate(t)

	const userID = 804
	const tokenID = 804
	seedUser(t, userID, 1000)
	seedToken(t, tokenID, userID, "zero-base-surcharge-token", 1000)
	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID, TokenKey: "zero-base-surcharge-token",
		RequestId: "zero-base-surcharge-request",
	}

	require.NoError(t, SettleBilling(nil, relayInfo, 200))

	require.NotNil(t, relayInfo.Billing)
	assert.Equal(t, BillingSourceWallet, relayInfo.BillingSource)
	assert.Equal(t, 800, getUserQuota(t, userID))
	assert.Equal(t, 800, getTokenRemainQuota(t, tokenID))
	assert.True(t, BillingSettlementCommitted(relayInfo))
}
