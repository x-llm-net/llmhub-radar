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
