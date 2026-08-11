package service

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRecoverPendingBillingTokenAdjustmentsCompletesDurableRecord(t *testing.T) {
	truncate(t)
	const userID, tokenID = 601, 602
	seedUser(t, userID, 1000)
	seedToken(t, tokenID, userID, "sk-token-adjustment-recovery", 700)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", tokenID).Update("used_quota", 300).Error)
	_, err := model.CreateBillingTokenAdjustment("req-token-adjustment-recovery", tokenID, 125, nil)
	require.NoError(t, err)

	result, err := RecoverPendingBillingTokenAdjustments(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Scanned)
	assert.Equal(t, 1, result.Completed)
	assert.Zero(t, result.Failed)
	assert.Equal(t, 575, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, 425, getTokenUsedQuota(t, tokenID))
}
