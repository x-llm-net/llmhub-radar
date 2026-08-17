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

func TestDecreaseTokenQuotaDirectRejectsFiniteTokenUnderflow(t *testing.T) {
	truncateTables(t)
	const tokenID = 505
	require.NoError(t, DB.Create(&Token{
		Id:          tokenID,
		UserId:      506,
		Key:         "sk-token-underflow",
		Status:      common.TokenStatusEnabled,
		RemainQuota: 100,
		UsedQuota:   40,
	}).Error)

	err := DecreaseTokenQuotaDirect(tokenID, "sk-token-underflow", 101)
	require.ErrorIs(t, err, ErrTokenQuotaInsufficient)

	var token Token
	require.NoError(t, DB.First(&token, tokenID).Error)
	assert.Equal(t, 100, token.RemainQuota)
	assert.Equal(t, 40, token.UsedQuota)
}

func TestDecreaseTokenQuotaDirectKeepsUnlimitedTokenRemainingQuota(t *testing.T) {
	truncateTables(t)
	const tokenID = 507
	require.NoError(t, DB.Create(&Token{
		Id:             tokenID,
		UserId:         508,
		Key:            "sk-token-unlimited",
		Status:         common.TokenStatusEnabled,
		RemainQuota:    100,
		UsedQuota:      40,
		UnlimitedQuota: true,
	}).Error)

	require.NoError(t, DecreaseTokenQuotaDirect(tokenID, "sk-token-unlimited", 101))

	var token Token
	require.NoError(t, DB.First(&token, tokenID).Error)
	assert.Equal(t, 100, token.RemainQuota)
	assert.Equal(t, 141, token.UsedQuota)
}

func TestBillingTokenAdjustmentInsufficientQuotaStaysPending(t *testing.T) {
	truncateTables(t)
	const tokenID = 509
	require.NoError(t, DB.Create(&Token{
		Id:          tokenID,
		UserId:      510,
		Key:         "sk-token-adjustment-insufficient",
		Status:      common.TokenStatusEnabled,
		RemainQuota: 100,
	}).Error)
	adjustment, err := CreateBillingTokenAdjustment("req-token-adjustment-insufficient", tokenID, 101, assert.AnError)
	require.NoError(t, err)

	_, err = ProcessBillingTokenAdjustment(adjustment.RequestId)
	require.ErrorIs(t, err, ErrTokenQuotaInsufficient)

	var stored BillingTokenAdjustment
	require.NoError(t, DB.First(&stored, adjustment.Id).Error)
	assert.Equal(t, BillingTokenAdjustmentStatusPending, stored.Status)
	var token Token
	require.NoError(t, DB.First(&token, tokenID).Error)
	assert.Equal(t, 100, token.RemainQuota)
	assert.Zero(t, token.UsedQuota)
}

func TestBillingTokenAdjustmentUpdatesSoftDeletedToken(t *testing.T) {
	truncateTables(t)
	const tokenID = 511
	require.NoError(t, DB.Create(&Token{
		Id:          tokenID,
		UserId:      512,
		Key:         "sk-token-adjustment-deleted",
		Status:      common.TokenStatusEnabled,
		RemainQuota: 300,
	}).Error)
	adjustment, err := CreateBillingTokenAdjustment("req-token-adjustment-deleted", tokenID, 100, assert.AnError)
	require.NoError(t, err)
	require.NoError(t, DB.Delete(&Token{}, tokenID).Error)

	_, err = ProcessBillingTokenAdjustment(adjustment.RequestId)
	require.NoError(t, err)

	var token Token
	require.NoError(t, DB.Unscoped().First(&token, tokenID).Error)
	assert.Equal(t, 200, token.RemainQuota)
	assert.Equal(t, 100, token.UsedQuota)
}

func TestBillingTokenAdjustmentRefundKeepsUnlimitedTokenRemainingQuota(t *testing.T) {
	truncateTables(t)
	const tokenID = 513
	require.NoError(t, DB.Create(&Token{
		Id:             tokenID,
		UserId:         514,
		Key:            "sk-token-adjustment-unlimited-refund",
		Status:         common.TokenStatusEnabled,
		RemainQuota:    100,
		UsedQuota:      200,
		UnlimitedQuota: true,
	}).Error)
	adjustment, err := CreateBillingTokenAdjustment("req-token-adjustment-unlimited-refund", tokenID, -50, nil)
	require.NoError(t, err)

	_, err = ProcessBillingTokenAdjustment(adjustment.RequestId)
	require.NoError(t, err)

	var token Token
	require.NoError(t, DB.First(&token, tokenID).Error)
	assert.Equal(t, 100, token.RemainQuota)
	assert.Equal(t, 150, token.UsedQuota)
}
