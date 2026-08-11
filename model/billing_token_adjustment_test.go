package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBillingTokenAdjustmentIsIdempotentByRequest(t *testing.T) {
	truncateTables(t)
	const userID, tokenID = 501, 502
	token := &Token{
		Id:          tokenID,
		UserId:      userID,
		Key:         "sk-adjustment-test",
		Status:      common.TokenStatusEnabled,
		RemainQuota: 1000,
		UsedQuota:   200,
	}
	require.NoError(t, DB.Create(token).Error)

	adjustment, err := CreateBillingTokenAdjustment("req-token-adjustment", tokenID, 300, assert.AnError)
	require.NoError(t, err)
	require.NoError(t, DB.First(adjustment, adjustment.Id).Error)

	_, err = ProcessBillingTokenAdjustment(adjustment.RequestId)
	require.NoError(t, err)
	_, err = ProcessBillingTokenAdjustment(adjustment.RequestId)
	require.NoError(t, err)

	var updated Token
	require.NoError(t, DB.First(&updated, tokenID).Error)
	assert.Equal(t, 700, updated.RemainQuota)
	assert.Equal(t, 500, updated.UsedQuota)

	var stored BillingTokenAdjustment
	require.NoError(t, DB.Where("request_id = ?", adjustment.RequestId).First(&stored).Error)
	assert.Equal(t, BillingTokenAdjustmentStatusComplete, stored.Status)
	assert.Equal(t, 1, stored.AttemptCount)
}

func TestBillingTokenAdjustmentRecoveryDoesNotProcessCompletedRecord(t *testing.T) {
	truncateTables(t)
	const tokenID = 503
	require.NoError(t, DB.Create(&Token{
		Id:          tokenID,
		UserId:      504,
		Key:         "sk-adjustment-recovery",
		Status:      common.TokenStatusEnabled,
		RemainQuota: 1000,
		UsedQuota:   200,
	}).Error)
	_, err := CreateBillingTokenAdjustment("req-token-recovery", tokenID, -125, nil)
	require.NoError(t, err)

	_, err = ProcessBillingTokenAdjustment("req-token-recovery")
	require.NoError(t, err)
	completed, err := ListPendingBillingTokenAdjustmentRequestIDs(10)
	require.NoError(t, err)
	assert.Empty(t, completed)

	var updated Token
	require.NoError(t, DB.First(&updated, tokenID).Error)
	assert.Equal(t, 1125, updated.RemainQuota)
	assert.Equal(t, 75, updated.UsedQuota)
}
