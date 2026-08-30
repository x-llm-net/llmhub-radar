package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetTenantUsersInChannelsOnlyReturnsUsersWithOwnedChannelActivity(t *testing.T) {
	previousDB := DB
	previousLogDB := LOG_DB
	previousMainType := common.MainDatabaseType()
	previousLogType := common.LogDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB, LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.SetLogDatabaseType(common.DatabaseTypeSQLite)
	initCol()
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		common.SetMainDatabaseType(previousMainType)
		common.SetLogDatabaseType(previousLogType)
		initCol()
	})
	require.NoError(t, db.AutoMigrate(&User{}, &Log{}, &Task{}))

	for _, user := range []*User{
		{Id: 1, Username: "tenant-user", DisplayName: "Tenant User", Password: "unused", AffCode: "tenant-user", Group: "default"},
		{Id: 2, Username: "foreign-user", DisplayName: "Foreign User", Password: "unused", AffCode: "foreign-user", Group: "default"},
		{Id: 3, Username: "task-user", DisplayName: "Task User", Password: "unused", AffCode: "task-user", Group: "default"},
	} {
		require.NoError(t, db.Create(user).Error)
	}
	require.NoError(t, db.Create(&Log{UserId: 1, ChannelId: 11, Username: "tenant-user", CreatedAt: 1}).Error)
	require.NoError(t, db.Create(&Log{UserId: 2, ChannelId: 22, Username: "foreign-user", CreatedAt: 1}).Error)
	require.NoError(t, db.Create(&Task{UserId: 3, ChannelId: 11, TaskID: "tenant-task"}).Error)

	items, total, err := GetTenantUsersInChannels([]int{11}, "", "", nil, 0, 20, NewUserSortOptions("id", "asc"))
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, items, 2)
	assert.Equal(t, []int{1, 3}, []int{items[0].Id, items[1].Id})
	assert.Equal(t, "tenant-user", items[0].Username)
	assert.Equal(t, "task-user", items[1].Username)

	items, total, err = GetTenantUsersInChannels([]int{11}, "foreign", "", nil, 0, 20)
	require.NoError(t, err)
	assert.Zero(t, total)
	assert.Empty(t, items)
}

func TestTaskQueriesApplyTenantChannelScope(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Task{}))
	require.NoError(t, db.Create(&Task{TaskID: "tenant-task", ChannelId: 11}).Error)
	require.NoError(t, db.Create(&Task{TaskID: "foreign-task", ChannelId: 22}).Error)

	query := SyncTaskQueryParams{ChannelIDs: []int{11}}
	items := TaskGetAllTasks(0, 20, query)
	assert.Len(t, items, 1)
	assert.Equal(t, "tenant-task", items[0].TaskID)
	assert.Equal(t, int64(1), TaskCountAllTasks(query))

	emptyQuery := SyncTaskQueryParams{ChannelIDs: []int{}}
	assert.Empty(t, TaskGetAllTasks(0, 20, emptyQuery))
	assert.Zero(t, TaskCountAllTasks(emptyQuery))
}
