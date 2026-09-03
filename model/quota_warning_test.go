package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestClaimWalletQuotaWarningTracksLowBalanceEpisodes(t *testing.T) {
	previousDB := DB
	t.Cleanup(func() { DB = previousDB })

	db, err := gorm.Open(sqlite.Open("file:quota-warning-test?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	require.NoError(t, DB.AutoMigrate(&QuotaWarningState{}))

	claimed, err := ClaimWalletQuotaWarning(7, 99, 100)
	require.NoError(t, err)
	require.True(t, claimed)

	claimed, err = ClaimWalletQuotaWarning(7, 98, 100)
	require.NoError(t, err)
	require.False(t, claimed)

	require.NoError(t, ResetWalletQuotaWarning(7))
	claimed, err = ClaimWalletQuotaWarning(7, 99, 100)
	require.NoError(t, err)
	require.True(t, claimed)
}
