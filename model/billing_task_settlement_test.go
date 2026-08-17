package model

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBillingTaskSettlementWalletIsAtomicAndIdempotent(t *testing.T) {
	truncateTables(t)
	const userID, tokenID, channelID = 601, 602, 603
	seedTaskSettlementUser(t, userID, 10000)
	seedTaskSettlementToken(t, tokenID, userID, 5000)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userID).Updates(map[string]any{
		"used_quota": 2000, "request_count": 1,
	}).Error)
	require.NoError(t, DB.Create(&Channel{Id: channelID, Name: "settlement-channel", UsedQuota: 2000}).Error)
	task := seedTaskSettlementTask(t, userID, 2000)
	task.ChannelId = channelID
	require.NoError(t, DB.Model(&Task{}).Where("id = ?", task.ID).Update("channel_id", channelID).Error)

	settlement, err := CreateBillingTaskSettlement(BillingTaskSettlementParams{
		TaskId: task.ID, RequestId: "task-settle-wallet", UserId: userID, TokenId: tokenID,
		FundingSource: "wallet", PreQuota: 2000, ActualQuota: 3000, Reason: "token adjustment",
	})
	require.NoError(t, err)
	_, err = ProcessBillingTaskSettlement(task.ID)
	require.NoError(t, err)
	_, err = ProcessBillingTaskSettlement(task.ID)
	require.NoError(t, err)

	assert.Equal(t, 9000, getSettlementUserQuota(t, userID))
	assert.Equal(t, 4000, getSettlementTokenRemainQuota(t, tokenID))
	assert.Equal(t, 3000, getSettlementTaskQuota(t, task.ID))
	var user User
	require.NoError(t, DB.First(&user, userID).Error)
	assert.Equal(t, 3000, user.UsedQuota)
	assert.Equal(t, 1, user.RequestCount)
	var channel Channel
	require.NoError(t, DB.First(&channel, channelID).Error)
	assert.EqualValues(t, 3000, channel.UsedQuota)

	var stored BillingTaskSettlement
	require.NoError(t, DB.Where("task_id = ?", task.ID).First(&stored).Error)
	assert.Equal(t, settlement.Id, stored.Id)
	assert.Equal(t, BillingTaskSettlementStatusComplete, stored.Status)
	assert.Equal(t, 1, stored.AttemptCount)
}

func TestTaskTerminalStatusAndSettlementIntentAreAtomic(t *testing.T) {
	truncateTables(t)
	const userID = 608
	seedTaskSettlementUser(t, userID, 10000)
	task := seedTaskSettlementTask(t, userID, 2000)
	require.NoError(t, DB.Model(&Task{}).Where("id = ?", task.ID).Update("status", TaskStatusInProgress).Error)
	task.Status = TaskStatusSuccess

	won, settlement, err := task.UpdateWithStatusAndBillingSettlement(TaskStatusInProgress, BillingTaskSettlementParams{
		TaskId: task.ID, UserId: userID, FundingSource: "wallet", PreQuota: 2000, ActualQuota: 2000,
		Reason: "terminal settlement intent",
	})
	require.NoError(t, err)
	require.True(t, won)
	require.NotNil(t, settlement)

	var storedTask Task
	require.NoError(t, DB.First(&storedTask, task.ID).Error)
	assert.EqualValues(t, TaskStatusSuccess, storedTask.Status)
	var storedSettlement BillingTaskSettlement
	require.NoError(t, DB.Where("task_id = ?", task.ID).First(&storedSettlement).Error)
	assert.Equal(t, BillingTaskSettlementStatusPending, storedSettlement.Status)
}

func TestTaskTerminalStatusRollsBackWhenSettlementIntentIsInvalid(t *testing.T) {
	truncateTables(t)
	const userID = 609
	seedTaskSettlementUser(t, userID, 10000)
	task := seedTaskSettlementTask(t, userID, 2000)
	require.NoError(t, DB.Model(&Task{}).Where("id = ?", task.ID).Update("status", TaskStatusInProgress).Error)
	task.Status = TaskStatusSuccess

	won, settlement, err := task.UpdateWithStatusAndBillingSettlement(TaskStatusInProgress, BillingTaskSettlementParams{
		TaskId: task.ID, UserId: userID, FundingSource: "wallet", PreQuota: 2000, ActualQuota: -1,
	})
	require.Error(t, err)
	assert.False(t, won)
	assert.Nil(t, settlement)

	var storedTask Task
	require.NoError(t, DB.First(&storedTask, task.ID).Error)
	assert.EqualValues(t, TaskStatusInProgress, storedTask.Status)
	var count int64
	require.NoError(t, DB.Model(&BillingTaskSettlement{}).Where("task_id = ?", task.ID).Count(&count).Error)
	assert.Zero(t, count)
}

func TestDirectTokenQuotaUpdateBypassesBatchQueue(t *testing.T) {
	truncateTables(t)
	const userID, tokenID = 610, 611
	seedTaskSettlementUser(t, userID, 10000)
	seedTaskSettlementToken(t, tokenID, userID, 5000)
	previous := common.BatchUpdateEnabled
	common.BatchUpdateEnabled = true
	t.Cleanup(func() { common.BatchUpdateEnabled = previous })

	require.NoError(t, DecreaseTokenQuotaDirect(tokenID, "sk-settlement-test", 1200))
	assert.Equal(t, 3800, getSettlementTokenRemainQuota(t, tokenID))
	require.NoError(t, IncreaseTokenQuotaDirect(tokenID, "sk-settlement-test", 1200))
	assert.Equal(t, 5000, getSettlementTokenRemainQuota(t, tokenID))
}

func TestBillingTaskSettlementFailureBacksOffRecoveryScan(t *testing.T) {
	truncateTables(t)
	const userID = 612
	seedTaskSettlementUser(t, userID, 10000)
	task := seedTaskSettlementTask(t, userID, 2000)
	_, err := CreateBillingTaskSettlement(BillingTaskSettlementParams{
		TaskId: task.ID, UserId: userID, FundingSource: "wallet", PreQuota: 2000, ActualQuota: 3000,
		Reason: "retry backoff",
	})
	require.NoError(t, err)
	RecordBillingTaskSettlementFailure(task.ID, errors.New("temporary failure"))

	var stored BillingTaskSettlement
	require.NoError(t, DB.Where("task_id = ?", task.ID).First(&stored).Error)
	assert.NotZero(t, stored.NextAttemptAt)
	ids, err := ListRecoverableBillingTaskSettlementIDs(10)
	require.NoError(t, err)
	assert.Empty(t, ids)

	require.NoError(t, DB.Model(&BillingTaskSettlement{}).Where("task_id = ?", task.ID).Update("next_attempt_at", 0).Error)
	ids, err = ListRecoverableBillingTaskSettlementIDs(10)
	require.NoError(t, err)
	assert.Equal(t, []int64{task.ID}, ids)
}

func TestBillingTaskSettlementSubscriptionRefund(t *testing.T) {
	truncateTables(t)
	const userID, tokenID, subscriptionID = 603, 604, 605
	seedTaskSettlementUser(t, userID, 0)
	seedTaskSettlementToken(t, tokenID, userID, 8000)
	seedTaskSettlementSubscription(t, subscriptionID, userID, 100000, 50000)
	task := seedTaskSettlementTask(t, userID, 5000)

	_, err := CreateBillingTaskSettlement(BillingTaskSettlementParams{
		TaskId: task.ID, UserId: userID, TokenId: tokenID, FundingSource: "subscription", SubscriptionId: subscriptionID,
		PreQuota: 5000, ActualQuota: 2000, Reason: "upstream token count",
	})
	require.NoError(t, err)
	_, err = ProcessBillingTaskSettlement(task.ID)
	require.NoError(t, err)

	assert.Equal(t, int64(47000), getSettlementSubscriptionUsed(t, subscriptionID))
	assert.Equal(t, 11000, getSettlementTokenRemainQuota(t, tokenID))
	assert.Equal(t, 2000, getSettlementTaskQuota(t, task.ID))
}

func TestBillingTaskSettlementSubscriptionUsesWalletOverflow(t *testing.T) {
	truncateTables(t)
	const userID, tokenID, subscriptionID = 613, 614, 615
	seedTaskSettlementUser(t, userID, 1000)
	seedTaskSettlementToken(t, tokenID, userID, 5000)
	require.NoError(t, DB.Create(&UserSubscription{
		Id: subscriptionID, UserId: userID, AmountTotal: 1000, AmountUsed: 900,
		Status: "active", EndTime: common.GetTimestamp() + 3600, AllowWalletOverflow: true,
	}).Error)
	task := seedTaskSettlementTask(t, userID, 800)

	_, err := CreateBillingTaskSettlement(BillingTaskSettlementParams{
		TaskId: task.ID, UserId: userID, TokenId: tokenID, FundingSource: "subscription",
		SubscriptionId: subscriptionID, PreQuota: 800, ActualQuota: 1000, Reason: "subscription overflow",
	})
	require.NoError(t, err)
	_, err = ProcessBillingTaskSettlement(task.ID)
	require.NoError(t, err)
	_, err = ProcessBillingTaskSettlement(task.ID)
	require.NoError(t, err)

	assert.Equal(t, 800, getSettlementUserQuota(t, userID))
	assert.Equal(t, 4800, getSettlementTokenRemainQuota(t, tokenID))
	assert.Equal(t, int64(900), getSettlementSubscriptionUsed(t, subscriptionID))
	assert.Equal(t, 1000, getSettlementTaskQuota(t, task.ID))
}

func TestBillingTaskSettlementSubscriptionRejectsDisabledWalletOverflow(t *testing.T) {
	truncateTables(t)
	const userID, tokenID, subscriptionID = 616, 617, 618
	seedTaskSettlementUser(t, userID, 1000)
	seedTaskSettlementToken(t, tokenID, userID, 5000)
	require.NoError(t, DB.Create(&UserSubscription{
		Id: subscriptionID, UserId: userID, AmountTotal: 1000, AmountUsed: 900,
		Status: "active", EndTime: common.GetTimestamp() + 3600,
	}).Error)
	task := seedTaskSettlementTask(t, userID, 800)

	_, err := CreateBillingTaskSettlement(BillingTaskSettlementParams{
		TaskId: task.ID, UserId: userID, TokenId: tokenID, FundingSource: "subscription",
		SubscriptionId: subscriptionID, PreQuota: 800, ActualQuota: 1000, Reason: "subscription overflow blocked",
	})
	require.NoError(t, err)
	_, err = ProcessBillingTaskSettlement(task.ID)
	require.ErrorIs(t, err, ErrSubscriptionQuotaInsufficient)

	assert.Equal(t, 1000, getSettlementUserQuota(t, userID))
	assert.Equal(t, 5000, getSettlementTokenRemainQuota(t, tokenID))
	assert.Equal(t, int64(900), getSettlementSubscriptionUsed(t, subscriptionID))
	assert.Equal(t, 800, getSettlementTaskQuota(t, task.ID))
}

func TestBillingTaskSettlementFailureIsRecoverable(t *testing.T) {
	truncateTables(t)
	const userID, tokenID = 606, 607
	seedTaskSettlementUser(t, userID, 10000)
	task := seedTaskSettlementTask(t, userID, 2000)
	_, err := CreateBillingTaskSettlement(BillingTaskSettlementParams{
		TaskId: task.ID, UserId: userID, TokenId: tokenID, FundingSource: "wallet",
		PreQuota: 2000, ActualQuota: 3000, Reason: "token adjustment",
	})
	require.NoError(t, err)

	_, err = ProcessBillingTaskSettlement(task.ID)
	require.ErrorIs(t, err, ErrBillingTaskSettlementTokenNotFound)
	assert.Equal(t, 10000, getSettlementUserQuota(t, userID))
	assert.Equal(t, 2000, getSettlementTaskQuota(t, task.ID))

	seedTaskSettlementToken(t, tokenID, userID, 5000)
	_, err = ProcessBillingTaskSettlement(task.ID)
	require.NoError(t, err)
	assert.Equal(t, 9000, getSettlementUserQuota(t, userID))
	assert.Equal(t, 4000, getSettlementTokenRemainQuota(t, tokenID))
	assert.Equal(t, 3000, getSettlementTaskQuota(t, task.ID))
}

func TestBillingTaskSettlementWalletInsufficientIsAtomic(t *testing.T) {
	truncateTables(t)
	const userID, tokenID = 619, 620
	seedTaskSettlementUser(t, userID, 100)
	seedTaskSettlementToken(t, tokenID, userID, 1000)
	task := seedTaskSettlementTask(t, userID, 500)
	_, err := CreateBillingTaskSettlement(BillingTaskSettlementParams{
		TaskId: task.ID, UserId: userID, TokenId: tokenID, FundingSource: "wallet",
		PreQuota: 500, ActualQuota: 700, Reason: "wallet underflow",
	})
	require.NoError(t, err)

	_, err = ProcessBillingTaskSettlement(task.ID)
	require.ErrorIs(t, err, ErrBillingTaskSettlementUserQuotaInsufficient)
	assert.Equal(t, 100, getSettlementUserQuota(t, userID))
	assert.Equal(t, 1000, getSettlementTokenRemainQuota(t, tokenID))
	assert.Equal(t, 500, getSettlementTaskQuota(t, task.ID))

	var settlement BillingTaskSettlement
	require.NoError(t, DB.Where("task_id = ?", task.ID).First(&settlement).Error)
	assert.Equal(t, BillingTaskSettlementStatusPending, settlement.Status)
}

func TestBillingTaskSettlementSubscriptionWalletOverflowInsufficientIsAtomic(t *testing.T) {
	truncateTables(t)
	const userID, tokenID, subscriptionID = 621, 622, 623
	seedTaskSettlementUser(t, userID, 100)
	seedTaskSettlementToken(t, tokenID, userID, 1000)
	require.NoError(t, DB.Create(&UserSubscription{
		Id: subscriptionID, UserId: userID, AmountTotal: 1000, AmountUsed: 900,
		Status: "active", EndTime: common.GetTimestamp() + 3600, AllowWalletOverflow: true,
	}).Error)
	task := seedTaskSettlementTask(t, userID, 500)
	_, err := CreateBillingTaskSettlement(BillingTaskSettlementParams{
		TaskId: task.ID, UserId: userID, TokenId: tokenID, FundingSource: "subscription",
		SubscriptionId: subscriptionID, PreQuota: 500, ActualQuota: 700, Reason: "subscription wallet underflow",
	})
	require.NoError(t, err)

	_, err = ProcessBillingTaskSettlement(task.ID)
	require.ErrorIs(t, err, ErrBillingTaskSettlementUserQuotaInsufficient)
	assert.Equal(t, 100, getSettlementUserQuota(t, userID))
	assert.Equal(t, 1000, getSettlementTokenRemainQuota(t, tokenID))
	assert.Equal(t, int64(900), getSettlementSubscriptionUsed(t, subscriptionID))
	assert.Equal(t, 500, getSettlementTaskQuota(t, task.ID))
}

func seedTaskSettlementUser(t *testing.T, id, quota int) {
	t.Helper()
	require.NoError(t, DB.Create(&User{Id: id, Username: "settlement-user", Quota: quota, Status: common.UserStatusEnabled}).Error)
}

func seedTaskSettlementToken(t *testing.T, id, userID, remain int) {
	t.Helper()
	require.NoError(t, DB.Create(&Token{Id: id, UserId: userID, Key: "sk-settlement-test", Status: common.TokenStatusEnabled, RemainQuota: remain}).Error)
}

func seedTaskSettlementTask(t *testing.T, userID, quota int) *Task {
	t.Helper()
	task := &Task{
		TaskID: "task_settlement_test",
		UserId: userID,
		Quota:  quota,
		Status: TaskStatusSuccess,
		Group:  "default",
	}
	require.NoError(t, DB.Create(task).Error)
	return task
}

func seedTaskSettlementSubscription(t *testing.T, id, userID int, total, used int64) {
	t.Helper()
	require.NoError(t, DB.Create(&UserSubscription{Id: id, UserId: userID, AmountTotal: total, AmountUsed: used, Status: "active"}).Error)
}

func getSettlementUserQuota(t *testing.T, id int) int {
	t.Helper()
	var user User
	require.NoError(t, DB.First(&user, id).Error)
	return user.Quota
}

func getSettlementTokenRemainQuota(t *testing.T, id int) int {
	t.Helper()
	var token Token
	require.NoError(t, DB.First(&token, id).Error)
	return token.RemainQuota
}

func getSettlementTaskQuota(t *testing.T, id int64) int {
	t.Helper()
	var task Task
	require.NoError(t, DB.First(&task, id).Error)
	return task.Quota
}

func getSettlementSubscriptionUsed(t *testing.T, id int) int64 {
	t.Helper()
	var subscription UserSubscription
	require.NoError(t, DB.First(&subscription, id).Error)
	return subscription.AmountUsed
}
