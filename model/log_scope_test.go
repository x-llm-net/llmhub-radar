package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func useLogScopeDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := useHubSupplyGroupMigrationDB(t)
	previousLogDB := LOG_DB
	previousLogDatabaseType := common.LogDatabaseType()
	previousMemoryCacheEnabled := common.MemoryCacheEnabled
	LOG_DB = db
	common.SetLogDatabaseType(common.DatabaseTypeSQLite)
	common.MemoryCacheEnabled = false
	initCol()
	t.Cleanup(func() {
		LOG_DB = previousLogDB
		common.SetLogDatabaseType(previousLogDatabaseType)
		common.MemoryCacheEnabled = previousMemoryCacheEnabled
		initCol()
	})
	return db
}

func TestScopedAdminLogsAndStatsUseChannelIDs(t *testing.T) {
	db := useLogScopeDB(t)
	// A real channels table is needed because the admin log query hydrates names
	// after reading the scoped rows from the log database.
	require.NoError(t, db.AutoMigrate(&Log{}, &Channel{}))
	require.NoError(t, db.Create(&Channel{Id: 11, Name: "tenant channel", Key: "key-11"}).Error)
	require.NoError(t, db.Create(&Channel{Id: 22, Name: "other channel", Key: "key-22"}).Error)
	now := common.GetTimestamp()
	require.NoError(t, db.Create(&Log{Type: LogTypeConsume, ChannelId: 11, Quota: 100, PromptTokens: 2, CompletionTokens: 3, CreatedAt: now}).Error)
	require.NoError(t, db.Create(&Log{Type: LogTypeConsume, ChannelId: 22, Quota: 200, PromptTokens: 4, CompletionTokens: 6, CreatedAt: now}).Error)

	logs, total, err := GetAllLogsInChannels(LogTypeConsume, 0, 0, "", "", "", 0, 100, 0, "", "", "", []int{11})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, logs, 1)
	assert.Equal(t, 11, logs[0].ChannelId)
	assert.Equal(t, "tenant channel", logs[0].ChannelName)

	stat, err := SumUsedQuotaInChannels(LogTypeConsume, 0, 0, "", "", "", 0, "", []int{11})
	require.NoError(t, err)
	assert.Equal(t, 100, stat.Quota)
	assert.Equal(t, 1, stat.Rpm)
	assert.Equal(t, 5, stat.Tpm)

	logs, total, err = GetAllLogsInChannels(LogTypeConsume, 0, 0, "", "", "", 0, 100, 0, "", "", "", []int{})
	require.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Empty(t, logs)

	stat, err = SumUsedQuotaInChannels(LogTypeConsume, 0, 0, "", "", "", 0, "", []int{})
	require.NoError(t, err)
	assert.Equal(t, Stat{}, stat)
}

func TestUnscopedAdminLogsRemainPlatformWide(t *testing.T) {
	db := useLogScopeDB(t)
	require.NoError(t, db.AutoMigrate(&Log{}, &Channel{}))
	require.NoError(t, db.Create(&Channel{Id: 11, Name: "channel 11", Key: "key-11"}).Error)
	require.NoError(t, db.Create(&Channel{Id: 22, Name: "channel 22", Key: "key-22"}).Error)
	require.NoError(t, db.Create(&Log{Type: LogTypeConsume, ChannelId: 11, CreatedAt: common.GetTimestamp()}).Error)
	require.NoError(t, db.Create(&Log{Type: LogTypeConsume, ChannelId: 22, CreatedAt: common.GetTimestamp()}).Error)

	logs, total, err := GetAllLogs(LogTypeConsume, 0, 0, "", "", "", 0, 100, 0, "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, logs, 2)
}
