/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
package model

import (
	"errors"
	"strings"

	"gorm.io/gorm"
)

type HubModelPriceNotificationState struct {
	Id         int    `json:"-" gorm:"primaryKey"`
	ModelName  string `json:"model_name" gorm:"type:varchar(255);not null;uniqueIndex"`
	LastSentAt int64  `json:"last_sent_at" gorm:"not null;index"`
}

func (HubModelPriceNotificationState) TableName() string {
	return "hub_model_price_notification_states"
}

// ClaimHubModelPriceNotification atomically claims a model notification when
// its suppression window has elapsed. The state is persisted so restarts and
// multiple application instances share the same suppression decision.
func ClaimHubModelPriceNotification(modelName string, now int64, suppressWindow int64) (bool, error) {
	modelName = strings.ToLower(strings.TrimSpace(modelName))
	if modelName == "" || now <= 0 || suppressWindow < 0 {
		return false, nil
	}

	var state HubModelPriceNotificationState
	err := DB.Where("model_name = ?", modelName).First(&state).Error
	if err == nil {
		if state.LastSentAt > 0 && now-state.LastSentAt < suppressWindow {
			return false, nil
		}
		result := DB.Model(&HubModelPriceNotificationState{}).
			Where("id = ? AND last_sent_at = ?", state.Id, state.LastSentAt).
			Update("last_sent_at", now)
		return result.RowsAffected > 0, result.Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}

	state = HubModelPriceNotificationState{ModelName: modelName, LastSentAt: now}
	if err := DB.Create(&state).Error; err == nil {
		return true, nil
	}

	// Another instance may have created the unique row concurrently. Re-read
	// it so the losing caller observes the same suppression decision.
	if err := DB.Where("model_name = ?", modelName).First(&state).Error; err != nil {
		return false, err
	}
	return false, nil
}
