package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrLegacyBillingUserNotFound          = errors.New("legacy billing user not found")
	ErrLegacyBillingUserQuotaInsufficient = errors.New("legacy billing user quota insufficient")
	ErrLegacyBillingTokenNotFound         = errors.New("legacy billing token not found")
)

// ApplyLegacyQuotaAdjustment keeps the remaining non-BillingSession entry
// points atomic without changing their pricing or notification behavior.
func ApplyLegacyQuotaAdjustment(userId, tokenId, subscriptionId int, fundingSource string, quota int, playground bool) error {
	if userId <= 0 {
		return ErrLegacyBillingUserNotFound
	}
	if quota == 0 {
		return nil
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if !playground {
			var token Token
			if err := lockForUpdate(tx.Unscoped()).Select("id").
				Where("id = ? AND user_id = ?", tokenId, userId).
				First(&token).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrLegacyBillingTokenNotFound
				}
				return err
			}
			var err error
			if quota > 0 {
				err = decreaseTokenQuotaTx(tx, tokenId, quota)
			} else {
				err = increaseTokenQuotaTx(tx, tokenId, -quota)
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrLegacyBillingTokenNotFound
			}
			if err != nil {
				return err
			}
		}

		switch fundingSource {
		case "subscription":
			if subscriptionId <= 0 {
				return errors.New("subscription id is missing")
			}
			var subscription UserSubscription
			if err := lockForUpdate(tx).Select("id").
				Where("id = ? AND user_id = ?", subscriptionId, userId).
				First(&subscription).Error; err != nil {
				return err
			}
			return postConsumeUserSubscriptionDeltaTx(tx, subscriptionId, int64(quota))
		case "wallet", "":
			if quota > 0 {
				result := tx.Model(&User{}).
					Where("id = ? AND quota >= ?", userId, quota).
					Update("quota", gorm.Expr("quota - ?", quota))
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected == 0 {
					var user User
					if err := tx.Select("id").Where("id = ?", userId).First(&user).Error; err != nil {
						return ErrLegacyBillingUserNotFound
					}
					return ErrLegacyBillingUserQuotaInsufficient
				}
				return nil
			}
			result := tx.Model(&User{}).
				Where("id = ?", userId).
				Update("quota", gorm.Expr("quota + ?", -quota))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return ErrLegacyBillingUserNotFound
			}
			return nil
		default:
			return fmt.Errorf("unsupported legacy billing funding source: %s", fundingSource)
		}
	})
	if err != nil {
		return err
	}
	if err := invalidateUserCache(userId); err != nil {
		common.SysLog("failed to invalidate user cache after legacy billing: " + err.Error())
	}
	if tokenId > 0 && common.RedisEnabled {
		var token Token
		if err := DB.Unscoped().Select("key").Where("id = ?", tokenId).First(&token).Error; err == nil {
			if err := cacheDeleteToken(token.Key); err != nil {
				common.SysLog("failed to invalidate token cache after legacy billing: " + err.Error())
			}
		}
	}
	return nil
}
