package service

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRecoverPendingBillingTaskSettlementCompletesFinancialsAndMarker(t *testing.T) {
	truncate(t)
	const userID, tokenID = 701, 702
	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-task-settlement-recovery", 5000)
	task := makeTask(userID, 0, 2000, tokenID, BillingSourceWallet, 0)
	task.PrivateData.RequestId = "task-settlement-recovery"
	require.NoError(t, model.DB.Create(task).Error)
	deferred := true
	_, err := model.PrepareHubProviderEarning(model.HubProviderEarningParams{
		RequestId: task.PrivateData.RequestId, ProviderId: 710, OwnerUserId: 711, ConsumerUserId: userID,
		TokenId: tokenID, SupplyGroupId: 712, ChannelId: 713, ModelName: "task-model",
		BillingSource: BillingSourceWallet, GrossQuota: 2000,
		BaseGroupRatio: 1, SupplyMultiplier: 1, BillingRatio: 1, SettlementDeferred: &deferred,
	})
	require.NoError(t, err)
	_, err = model.CreateBillingTaskSettlement(model.BillingTaskSettlementParams{
		TaskId: task.ID, RequestId: task.PrivateData.RequestId, UserId: userID, TokenId: tokenID,
		FundingSource: BillingSourceWallet, PreQuota: 2000, ActualQuota: 3000, Reason: "recovery test",
	})
	require.NoError(t, err)

	result, err := RecoverPendingBillingTaskSettlements(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Scanned)
	assert.Equal(t, 1, result.Completed)
	assert.Zero(t, result.Failed)
	assert.Equal(t, 9000, getUserQuota(t, userID))
	assert.Equal(t, 4000, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, 3000, getTaskQuota(t, task.ID))

	var settlement model.BillingTaskSettlement
	require.NoError(t, model.DB.Where("task_id = ?", task.ID).First(&settlement).Error)
	assert.Equal(t, model.BillingTaskSettlementStatusComplete, settlement.Status)
	assert.NotZero(t, settlement.AccountingRecordedAt)
	assert.NotZero(t, settlement.EarningReleasedAt)
	var earning model.HubProviderEarning
	require.NoError(t, model.DB.Where("request_id = ?", task.PrivateData.RequestId).First(&earning).Error)
	assert.Equal(t, model.HubProviderEarningStatusSettled, earning.Status)
	assert.Equal(t, 3000, earning.GrossQuota)

	result, err = RecoverPendingBillingTaskSettlements(context.Background(), 10)
	require.NoError(t, err)
	assert.Zero(t, result.Scanned)
}

func TestRecalculatePersistedTaskQuotaUsesDurableSettlement(t *testing.T) {
	truncate(t)
	const userID, tokenID = 703, 704
	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-task-settlement-direct", 5000)
	task := makeTask(userID, 0, 2000, tokenID, BillingSourceWallet, 0)
	require.NoError(t, model.DB.Create(task).Error)

	require.NoError(t, RecalculateTaskQuota(context.Background(), task, 3000, "durable test"))
	assert.Equal(t, 3000, task.Quota)
	assert.Equal(t, 3000, getTaskQuota(t, task.ID))

	var settlement model.BillingTaskSettlement
	require.NoError(t, model.DB.Where("task_id = ?", task.ID).First(&settlement).Error)
	assert.Equal(t, model.BillingTaskSettlementStatusComplete, settlement.Status)
	assert.Equal(t, 9000, getUserQuota(t, userID))
	assert.Equal(t, 4000, getTokenRemainQuota(t, tokenID))
}

func TestRecalculatePersistedTaskQuotaExactStillCreatesSettlement(t *testing.T) {
	truncate(t)
	const userID = 705
	seedUser(t, userID, 10000)
	task := makeTask(userID, 0, 2000, 0, BillingSourceWallet, 0)
	require.NoError(t, model.DB.Create(task).Error)

	require.NoError(t, RecalculateTaskQuota(context.Background(), task, 2000, "exact finalization"))
	var settlement model.BillingTaskSettlement
	require.NoError(t, model.DB.Where("task_id = ?", task.ID).First(&settlement).Error)
	assert.Equal(t, model.BillingTaskSettlementStatusComplete, settlement.Status)
	assert.Zero(t, settlement.DeltaQuota)
	assert.NotZero(t, settlement.AccountingRecordedAt)
	assert.Equal(t, 10000, getUserQuota(t, userID))
}
