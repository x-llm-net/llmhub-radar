package service

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProcessBillingRefundWalletIsIdempotent(t *testing.T) {
	truncate(t)

	const userID = 201
	const tokenID = 201
	seedUser(t, userID, 700)
	seedToken(t, tokenID, userID, "sk-billing-refund-wallet", 200)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", tokenID).Update("used_quota", 300).Error)

	refund, err := model.CreateBillingRefund(model.BillingRefundParams{
		RequestId:     "refund-wallet-idempotent",
		UserId:        userID,
		TokenId:       tokenID,
		FundingSource: BillingSourceWallet,
		FundingQuota:  300,
		TokenQuota:    300,
	})
	require.NoError(t, err)
	assert.Equal(t, model.BillingRefundStatusPending, refund.Status)

	_, err = model.ProcessBillingRefund(refund.RequestId)
	require.NoError(t, err)
	_, err = model.ProcessBillingRefund(refund.RequestId)
	require.NoError(t, err)

	assert.Equal(t, 1000, getUserQuota(t, userID))
	assert.Equal(t, 500, getTokenRemainQuota(t, tokenID))
	assert.Zero(t, getTokenUsedQuota(t, tokenID))

	var stored model.BillingRefund
	require.NoError(t, model.DB.Where("request_id = ?", refund.RequestId).First(&stored).Error)
	assert.Equal(t, model.BillingRefundStatusComplete, stored.Status)
	assert.Equal(t, 1, stored.AttemptCount)
	assert.NotZero(t, stored.CompletedAt)
}

func TestProcessBillingRefundRestoresSubscriptionBaseAndReserve(t *testing.T) {
	truncate(t)

	const userID = 202
	const tokenID = 202
	const subscriptionID = 202
	const requestID = "refund-subscription-idempotent"
	seedUser(t, userID, 0)
	seedToken(t, tokenID, userID, "sk-billing-refund-subscription", 100)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", tokenID).Update("used_quota", 400).Error)
	seedSubscription(t, subscriptionID, userID, 5000, 1000)
	require.NoError(t, model.DB.Create(&model.SubscriptionPreConsumeRecord{
		RequestId:          requestID,
		UserId:             userID,
		UserSubscriptionId: subscriptionID,
		PreConsumed:        300,
		Status:             "consumed",
	}).Error)

	_, err := model.CreateBillingRefund(model.BillingRefundParams{
		RequestId:              requestID,
		UserId:                 userID,
		TokenId:                tokenID,
		FundingSource:          BillingSourceSubscription,
		FundingQuota:           300,
		SubscriptionId:         subscriptionID,
		SubscriptionExtraQuota: 100,
		TokenQuota:             400,
	})
	require.NoError(t, err)

	_, err = model.ProcessBillingRefund(requestID)
	require.NoError(t, err)
	_, err = model.ProcessBillingRefund(requestID)
	require.NoError(t, err)

	assert.Equal(t, int64(600), getSubscriptionUsed(t, subscriptionID))
	assert.Equal(t, 500, getTokenRemainQuota(t, tokenID))
	assert.Zero(t, getTokenUsedQuota(t, tokenID))

	var preConsume model.SubscriptionPreConsumeRecord
	require.NoError(t, model.DB.Where("request_id = ?", requestID).First(&preConsume).Error)
	assert.Equal(t, "refunded", preConsume.Status)
}

func TestRecoverPendingBillingRefundsCompletesDurableRecord(t *testing.T) {
	truncate(t)

	const userID = 203
	const tokenID = 203
	seedUser(t, userID, 450)
	seedToken(t, tokenID, userID, "sk-billing-refund-recovery", 250)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", tokenID).Update("used_quota", 150).Error)
	_, err := model.CreateBillingRefund(model.BillingRefundParams{
		RequestId:     "refund-recovery-pending",
		UserId:        userID,
		TokenId:       tokenID,
		FundingSource: BillingSourceWallet,
		FundingQuota:  150,
		TokenQuota:    150,
	})
	require.NoError(t, err)

	result, err := RecoverPendingBillingRefunds(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Scanned)
	assert.Equal(t, 1, result.Completed)
	assert.Zero(t, result.Failed)
	assert.Equal(t, 600, getUserQuota(t, userID))
	assert.Equal(t, 400, getTokenRemainQuota(t, tokenID))
}

func TestRecoverTaskRefundClearsQuotaAndCancelsProviderEarning(t *testing.T) {
	truncate(t)

	const userID, tokenID = 204, 204
	const requestID = "task-refund-recovery"
	seedUser(t, userID, 500)
	seedToken(t, tokenID, userID, "sk-task-refund-recovery", 300)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", tokenID).Update("used_quota", 200).Error)
	task := makeTask(userID, 0, 200, tokenID, BillingSourceWallet, 0)
	task.PrivateData.RequestId = requestID
	require.NoError(t, model.DB.Create(task).Error)
	_, err := model.PrepareHubProviderEarning(model.HubProviderEarningParams{
		RequestId: requestID, ProviderId: 301, OwnerUserId: 302, ConsumerUserId: userID,
		TokenId: tokenID, SupplyGroupId: 303, ChannelId: 304, ModelName: "task-model",
		BillingSource: BillingSourceWallet, GrossQuota: 200,
	})
	require.NoError(t, err)
	_, err = model.CreateBillingRefund(model.BillingRefundParams{
		RequestId: requestID, UserId: userID, TokenId: tokenID, TaskId: task.ID,
		FundingSource: BillingSourceWallet, FundingQuota: 200, TokenQuota: 200,
	})
	require.NoError(t, err)

	result, err := RecoverPendingBillingRefunds(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Completed)
	assert.Equal(t, 700, getUserQuota(t, userID))
	assert.Equal(t, 500, getTokenRemainQuota(t, tokenID))
	assert.Zero(t, getTaskQuota(t, task.ID))

	var earning model.HubProviderEarning
	require.NoError(t, model.DB.Where("request_id = ?", requestID).First(&earning).Error)
	assert.Equal(t, model.HubProviderEarningStatusCancelled, earning.Status)
}
