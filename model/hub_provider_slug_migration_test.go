/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type legacyHubProviderWithoutSlug struct {
	Id          int    `gorm:"primaryKey"`
	OwnerUserId int    `gorm:"not null"`
	Slot        int    `gorm:"not null"`
	Name        string `gorm:"type:varchar(80);not null"`
	Website     string `gorm:"type:varchar(512);not null"`
	Description string `gorm:"type:varchar(1000);not null"`
	LogoURL     string `gorm:"type:varchar(1024);not null"`
	Status      string `gorm:"type:varchar(24);not null"`
	CreatedAt   int64
	UpdatedAt   int64
}

func (legacyHubProviderWithoutSlug) TableName() string {
	return "hub_providers"
}

func TestMigrateHubProviderSlugsBackfillsUniqueStableSlugs(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&legacyHubProviderWithoutSlug{}))
	require.NoError(t, db.Create(&[]legacyHubProviderWithoutSlug{
		{Id: 1, OwnerUserId: 11, Slot: 1, Name: "LLM Routers", Status: HubProviderStatusActive},
		{Id: 2, OwnerUserId: 12, Slot: 1, Name: "LLM Routers", Status: HubProviderStatusActive},
	}).Error)

	require.NoError(t, db.AutoMigrate(&HubProvider{}))
	require.NoError(t, migrateHubProviderSlugs())
	require.NoError(t, migrateHubProviderSlugs())

	var providers []HubProvider
	require.NoError(t, db.Order("id ASC").Find(&providers).Error)
	require.Len(t, providers, 2)
	assert.Equal(t, "llm-routers", providers[0].Slug)
	assert.Equal(t, "llm-routers-2", providers[1].Slug)
	assert.True(t, db.Migrator().HasIndex(&HubProvider{}, hubProviderSlugIndexName))
}
