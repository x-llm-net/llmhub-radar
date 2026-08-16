package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

const (
	BillingRefundStatusPending  = "pending"
	BillingRefundStatusComplete = "complete"
)

var (
	ErrBillingRefundReferenceConflict = errors.New("billing refund reference conflict")
	ErrBillingRefundUserNotFound      = errors.New("billing refund user not found")
)

// BillingRefund is the durable, request-scoped recovery record for a failed
// request's pre-consume refund. It intentionally stores only IDs and quota
// deltas, never a token key or other credential material.
type BillingRefund struct {
	Id                     int    `json:"id" gorm:"primaryKey"`
	RequestId              string `json:"request_id" gorm:"type:varchar(96);not null;uniqueIndex"`
	Status                 string `json:"status" gorm:"type:varchar(24);not null;index"`
	UserId                 int    `json:"user_id" gorm:"not null;index"`
	TokenId                int    `json:"token_id" gorm:"not null;default:0;index"`
	TaskId                 int64  `json:"task_id" gorm:"not null;default:0;index"`
	FundingSource          string `json:"funding_source" gorm:"type:varchar(24);not null"`
	FundingQuota           int    `json:"funding_quota" gorm:"not null;default:0"`
	SubscriptionId         int    `json:"subscription_id" gorm:"not null;default:0;index"`
	SubscriptionExtraQuota int    `json:"subscription_extra_quota" gorm:"not null;default:0"`
	TokenQuota             int    `json:"token_quota" gorm:"not null;default:0"`
	AttemptCount           int    `json:"attempt_count" gorm:"not null;default:0"`
	LastAttemptAt          int64  `json:"last_attempt_at" gorm:"bigint;not null;default:0"`
	CompletedAt            int64  `json:"completed_at" gorm:"bigint;not null;default:0"`
	LastError              string `json:"last_error" gorm:"type:text;not null"`
	CreatedAt              int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt              int64  `json:"updated_at" gorm:"bigint;index"`
}

type BillingRefundParams struct {
	RequestId              string
	UserId                 int
	TokenId                int
	TaskId                 int64
	FundingSource          string
	FundingQuota           int
	SubscriptionId         int
	SubscriptionExtraQuota int
	TokenQuota             int
}

func (refund *BillingRefund) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	if refund.CreatedAt == 0 {
		refund.CreatedAt = now
	}
	if refund.UpdatedAt == 0 {
		refund.UpdatedAt = now
	}
	return nil
}

func CreateBillingRefund(params BillingRefundParams) (*BillingRefund, error) {
	params.RequestId = strings.TrimSpace(params.RequestId)
	params.FundingSource = strings.TrimSpace(params.FundingSource)
	if err := validateBillingRefundParams(params); err != nil {
		return nil, err
	}

	refund := &BillingRefund{
		RequestId:              params.RequestId,
		Status:                 BillingRefundStatusPending,
		UserId:                 params.UserId,
		TokenId:                params.TokenId,
		TaskId:                 params.TaskId,
		FundingSource:          params.FundingSource,
		FundingQuota:           params.FundingQuota,
		SubscriptionId:         params.SubscriptionId,
		SubscriptionExtraQuota: params.SubscriptionExtraQuota,
		TokenQuota:             params.TokenQuota,
	}
	if err := DB.Create(refund).Error; err == nil {
		return refund, nil
	}

	var existing BillingRefund
	if err := DB.Where("request_id = ?", params.RequestId).First(&existing).Error; err != nil {
		return nil, err
	}
	if !billingRefundMatches(&existing, params) {
		return nil, ErrBillingRefundReferenceConflict
	}
	return &existing, nil
}

func ProcessBillingRefund(requestId string) (*BillingRefund, error) {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" {
		return nil, errors.New("billing refund requestId is empty")
	}

	var completed BillingRefund
	err := DB.Transaction(func(tx *gorm.DB) error {
		var refund BillingRefund
		if err := lockForUpdate(tx).Where("request_id = ?", requestId).First(&refund).Error; err != nil {
			return err
		}
		if refund.Status == BillingRefundStatusComplete {
			completed = refund
			return nil
		}
		if refund.Status != BillingRefundStatusPending {
			return fmt.Errorf("unsupported billing refund status: %s", refund.Status)
		}
		// A refund and cancellation of the matching provider earning are one
		// accounting decision. If the earning is already settled, fail the
		// refund transaction instead of making the platform absorb both sides.
		if err := cancelHubProviderEarningTx(tx, refund.RequestId); err != nil {
			return err
		}

		now := common.GetTimestamp()
		switch refund.FundingSource {
		case "wallet":
			if refund.FundingQuota > 0 {
				result := tx.Model(&User{}).
					Where("id = ?", refund.UserId).
					Update("quota", gorm.Expr("quota + ?", refund.FundingQuota))
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected == 0 {
					return ErrBillingRefundUserNotFound
				}
			}
		case "subscription":
			if refund.FundingQuota > 0 {
				if err := refundSubscriptionPreConsumeTx(tx, refund.RequestId); err != nil {
					return err
				}
			}
			if refund.SubscriptionExtraQuota > 0 {
				if err := postConsumeUserSubscriptionDeltaTx(tx, refund.SubscriptionId, -int64(refund.SubscriptionExtraQuota)); err != nil {
					return err
				}
			}
		default:
			return fmt.Errorf("unsupported billing refund funding source: %s", refund.FundingSource)
		}

		if refund.TokenQuota > 0 && refund.TokenId > 0 {
			result := tx.Model(&Token{}).
				Where("id = ?", refund.TokenId).
				Updates(map[string]any{
					"remain_quota":  gorm.Expr("remain_quota + ?", refund.TokenQuota),
					"used_quota":    gorm.Expr("used_quota - ?", refund.TokenQuota),
					"accessed_time": now,
				})
			if result.Error != nil {
				return result.Error
			}
		}
		if refund.TaskId > 0 {
			if err := tx.Model(&Task{}).
				Where("id = ? AND user_id = ?", refund.TaskId, refund.UserId).
				Update("quota", 0).Error; err != nil {
				return err
			}
		}

		if err := tx.Model(&BillingRefund{}).Where("id = ? AND status = ?", refund.Id, BillingRefundStatusPending).Updates(map[string]any{
			"status":          BillingRefundStatusComplete,
			"attempt_count":   refund.AttemptCount + 1,
			"last_attempt_at": now,
			"completed_at":    now,
			"last_error":      "",
			"updated_at":      now,
		}).Error; err != nil {
			return err
		}
		refund.Status = BillingRefundStatusComplete
		refund.AttemptCount++
		refund.LastAttemptAt = now
		refund.CompletedAt = now
		refund.LastError = ""
		refund.UpdatedAt = now
		completed = refund
		return nil
	})
	if err != nil {
		RecordBillingRefundFailure(requestId, err)
		return nil, err
	}
	invalidateBillingRefundCaches(completed.UserId, completed.TokenId)
	return &completed, nil
}

func RecordBillingRefundFailure(requestId string, cause error) {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" || cause == nil {
		return
	}
	now := common.GetTimestamp()
	if err := DB.Model(&BillingRefund{}).
		Where("request_id = ? AND status = ?", requestId, BillingRefundStatusPending).
		Updates(map[string]any{
			"attempt_count":   gorm.Expr("attempt_count + ?", 1),
			"last_attempt_at": now,
			"last_error":      cause.Error(),
			"updated_at":      now,
		}).Error; err != nil {
		common.SysLog("failed to record billing refund failure: " + err.Error())
	}
}

func ListPendingBillingRefundRequestIDs(limit int) ([]string, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	requestIDs := make([]string, 0, limit)
	err := DB.Model(&BillingRefund{}).
		Where("status = ?", BillingRefundStatusPending).
		Order("id asc").
		Limit(limit).
		Pluck("request_id", &requestIDs).Error
	return requestIDs, err
}

func HasPendingBillingRefunds() (bool, error) {
	var count int64
	if err := DB.Model(&BillingRefund{}).Where("status = ?", BillingRefundStatusPending).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func validateBillingRefundParams(params BillingRefundParams) error {
	if params.RequestId == "" || params.UserId <= 0 {
		return errors.New("invalid billing refund reference")
	}
	if params.TokenId < 0 || params.TaskId < 0 || params.FundingQuota < 0 || params.SubscriptionId < 0 ||
		params.SubscriptionExtraQuota < 0 || params.TokenQuota < 0 {
		return errors.New("billing refund quota cannot be negative")
	}
	switch params.FundingSource {
	case "wallet":
		if params.SubscriptionId != 0 || params.SubscriptionExtraQuota != 0 {
			return errors.New("wallet billing refund cannot contain subscription fields")
		}
	case "subscription":
		if params.FundingQuota > 0 || params.SubscriptionExtraQuota > 0 {
			if params.SubscriptionId <= 0 {
				return errors.New("subscription billing refund requires subscription id")
			}
		}
	default:
		return fmt.Errorf("unsupported billing refund funding source: %s", params.FundingSource)
	}
	return nil
}

func billingRefundMatches(refund *BillingRefund, params BillingRefundParams) bool {
	return refund != nil &&
		refund.RequestId == params.RequestId &&
		refund.UserId == params.UserId &&
		refund.TokenId == params.TokenId &&
		refund.TaskId == params.TaskId &&
		refund.FundingSource == params.FundingSource &&
		refund.FundingQuota == params.FundingQuota &&
		refund.SubscriptionId == params.SubscriptionId &&
		refund.SubscriptionExtraQuota == params.SubscriptionExtraQuota &&
		refund.TokenQuota == params.TokenQuota
}

func invalidateBillingRefundCaches(userId int, tokenId int) {
	gopool.Go(func() {
		if userId > 0 {
			if err := invalidateUserCache(userId); err != nil {
				common.SysLog("failed to invalidate user cache after billing refund: " + err.Error())
			}
		}
		if tokenId <= 0 || !common.RedisEnabled {
			return
		}
		var token Token
		if err := DB.Select("key").Where("id = ?", tokenId).First(&token).Error; err != nil {
			return
		}
		if err := cacheDeleteToken(token.Key); err != nil {
			common.SysLog("failed to invalidate token cache after billing refund: " + err.Error())
		}
	})
}
