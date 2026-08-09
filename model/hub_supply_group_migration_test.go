package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func useHubSupplyGroupMigrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := DB
	previousType := common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousType)
	})
	return db
}

type legacyHubSupplyGroup struct {
	Id              int     `gorm:"primaryKey"`
	PublicId        string  `gorm:"type:varchar(32);not null;uniqueIndex"`
	ProviderId      int     `gorm:"not null"`
	NewAPIChannelId int     `gorm:"column:new_api_channel_id;not null;uniqueIndex"`
	Name            string  `gorm:"type:varchar(80);not null"`
	Models          string  `gorm:"type:text;not null;default:''"`
	PriceMultiplier float64 `gorm:"type:real;not null"`
	Status          string  `gorm:"type:varchar(24);not null"`
	CreatedAt       int64
	UpdatedAt       int64
}

func (legacyHubSupplyGroup) TableName() string {
	return "hub_supply_groups"
}

func TestMigrateHubSupplyGroupLegacyColumnsPreservesPublicationData(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&legacyHubSupplyGroup{}))
	require.NoError(t, db.Create(&legacyHubSupplyGroup{
		Id:              1,
		PublicId:        "legacy-group",
		ProviderId:      7,
		NewAPIChannelId: 11,
		Name:            "Legacy name",
		Models:          "gpt-5,claude-sonnet-5",
		PriceMultiplier: 0.8,
		Status:          "available",
		CreatedAt:       100,
		UpdatedAt:       200,
	}).Error)

	require.NoError(t, db.AutoMigrate(&HubSupplyGroup{}))
	require.NoError(t, migrateHubSupplyGroupLegacyColumns())
	require.NoError(t, migrateHubSupplyGroupLegacyColumns())

	assert.False(t, db.Migrator().HasColumn(&HubSupplyGroup{}, "name"))
	assert.False(t, db.Migrator().HasColumn(&HubSupplyGroup{}, "models"))

	var migrated HubSupplyGroup
	require.NoError(t, db.First(&migrated, 1).Error)
	assert.Equal(t, "gpt-5,claude-sonnet-5", migrated.PublishedModels)
	assert.Equal(t, 7, migrated.ProviderId)
	assert.Equal(t, 11, migrated.NewAPIChannelId)
	assert.Equal(t, 0.8, migrated.PriceMultiplier)

	newGroup := HubSupplyGroup{
		PublicId:        "new-group",
		ProviderId:      8,
		NewAPIChannelId: 12,
		PriceMultiplier: 1,
	}
	require.NoError(t, db.Create(&newGroup).Error)
	assert.NotZero(t, newGroup.Id)
}
