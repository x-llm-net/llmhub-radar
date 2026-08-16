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
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type HubAdminNotification struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	Type      string `json:"type" gorm:"type:varchar(64);not null;index"`
	Title     string `json:"title" gorm:"type:varchar(255);not null"`
	Content   string `json:"content" gorm:"type:text;not null"`
	Link      string `json:"link" gorm:"type:varchar(512);not null;default:''"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;not null;index"`
}

func (HubAdminNotification) TableName() string {
	return "hub_admin_notifications"
}

func (notification *HubAdminNotification) BeforeCreate(_ *gorm.DB) error {
	if notification.CreatedAt == 0 {
		notification.CreatedAt = common.GetTimestamp()
	}
	return nil
}

func CreateHubAdminNotification(notification *HubAdminNotification) error {
	return DB.Create(notification).Error
}

func ListHubAdminNotifications(limit int) ([]HubAdminNotification, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var notifications []HubAdminNotification
	err := DB.Order("created_at desc, id desc").Limit(limit).Find(&notifications).Error
	return notifications, err
}
