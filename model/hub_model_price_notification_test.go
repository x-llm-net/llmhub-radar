package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestClaimHubModelPriceNotificationPersistsSuppression(t *testing.T) {
	previousDB := DB
	t.Cleanup(func() { DB = previousDB })

	db, err := gorm.Open(sqlite.Open("file:hub-model-price-notification-test?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	require.NoError(t, DB.AutoMigrate(&HubModelPriceNotificationState{}))

	claimed, err := ClaimHubModelPriceNotification(" GPT-5 ", 1000, 3600)
	require.NoError(t, err)
	require.True(t, claimed)

	claimed, err = ClaimHubModelPriceNotification("gpt-5", 1001, 3600)
	require.NoError(t, err)
	require.False(t, claimed)

	claimed, err = ClaimHubModelPriceNotification("gpt-5", 4600, 3600)
	require.NoError(t, err)
	require.True(t, claimed)

	var state HubModelPriceNotificationState
	require.NoError(t, DB.Where("model_name = ?", "gpt-5").First(&state).Error)
	require.Equal(t, int64(4600), state.LastSentAt)
}
