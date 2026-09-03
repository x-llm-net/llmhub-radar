/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
package model

import (
	"errors"
	"sync"

	"gorm.io/gorm"
)

const quotaWarningScopeWallet = "wallet"

var quotaWarningMu sync.Mutex

// QuotaWarningState records whether the current low-balance episode has been
// notified. It is intentionally separate from User.Setting so settings saves
// cannot reset or overwrite notification state.
type QuotaWarningState struct {
	Id       int    `json:"-" gorm:"primaryKey"`
	UserId   int    `json:"-" gorm:"not null;uniqueIndex:idx_quota_warning_scope"`
	Scope    string `json:"-" gorm:"type:varchar(32);not null;uniqueIndex:idx_quota_warning_scope"`
	ScopeId  int64  `json:"-" gorm:"not null;uniqueIndex:idx_quota_warning_scope"`
	Notified bool   `json:"-" gorm:"not null;default:false"`
}

func (QuotaWarningState) TableName() string {
	return "quota_warning_states"
}

// ResetWalletQuotaWarning starts a new warning episode after a wallet credit.
// It is safe to call when no warning state exists yet.
func ResetWalletQuotaWarning(userId int) error {
	if userId <= 0 {
		return nil
	}
	key := map[string]interface{}{
		"user_id":  userId,
		"scope":    quotaWarningScopeWallet,
		"scope_id": 0,
	}
	return DB.Model(&QuotaWarningState{}).Where(key).Update("notified", false).Error
}

// ClaimWalletQuotaWarning returns true for exactly one caller while the
// balance remains below the threshold. A wallet credit resets the state via
// ResetWalletQuotaWarning, so request-local balance snapshots cannot reopen an
// already active episode under concurrency.
func ClaimWalletQuotaWarning(userId int, postBalance int, threshold int) (bool, error) {
	if userId <= 0 || threshold <= 0 || postBalance >= threshold {
		return false, nil
	}
	quotaWarningMu.Lock()
	defer quotaWarningMu.Unlock()

	key := map[string]interface{}{
		"user_id":  userId,
		"scope":    quotaWarningScopeWallet,
		"scope_id": 0,
	}
	result := DB.Model(&QuotaWarningState{}).
		Where(key).
		Where("notified = ?", false).
		Update("notified", true)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected > 0 {
		return true, nil
	}

	state := &QuotaWarningState{UserId: userId, Scope: quotaWarningScopeWallet, ScopeId: 0, Notified: true}
	if err := DB.Create(state).Error; err == nil {
		return true, nil
	} else {
		var existing QuotaWarningState
		findErr := DB.Where(key).First(&existing).Error
		if findErr == nil {
			return false, nil
		}
		if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return false, findErr
		}
		return false, err
	}
}
