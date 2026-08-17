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
	BillingTokenAdjustmentStatusPending  = "pending"
	BillingTokenAdjustmentStatusComplete = "complete"
)

var (
	ErrBillingTokenAdjustmentReferenceConflict = errors.New("billing token adjustment reference conflict")
	ErrBillingTokenAdjustmentTokenNotFound     = errors.New("billing token adjustment token not found")
)

// BillingTokenAdjustment records a token quota delta that still needs to be
// applied after the request's wallet or subscription funding was committed.
// It stores the token ID only, never the token key.
type BillingTokenAdjustment struct {
	Id            int    `json:"id" gorm:"primaryKey"`
	RequestId     string `json:"request_id" gorm:"type:varchar(96);not null;uniqueIndex"`
	Status        string `json:"status" gorm:"type:varchar(24);not null;index"`
	TokenId       int    `json:"token_id" gorm:"not null;index"`
	DeltaQuota    int    `json:"delta_quota" gorm:"not null"`
	AttemptCount  int    `json:"attempt_count" gorm:"not null;default:0"`
	LastAttemptAt int64  `json:"last_attempt_at" gorm:"bigint;not null;default:0"`
	CompletedAt   int64  `json:"completed_at" gorm:"bigint;not null;default:0"`
	LastError     string `json:"last_error" gorm:"type:text;not null"`
	CreatedAt     int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt     int64  `json:"updated_at" gorm:"bigint;index"`
}

func (adjustment *BillingTokenAdjustment) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	if adjustment.CreatedAt == 0 {
		adjustment.CreatedAt = now
	}
	if adjustment.UpdatedAt == 0 {
		adjustment.UpdatedAt = now
	}
	return nil
}

func CreateBillingTokenAdjustment(requestId string, tokenId, deltaQuota int, cause error) (*BillingTokenAdjustment, error) {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" || tokenId <= 0 || deltaQuota == 0 {
		return nil, errors.New("invalid billing token adjustment")
	}
	lastError := ""
	if cause != nil {
		lastError = cause.Error()
	}
	adjustment := &BillingTokenAdjustment{
		RequestId:  requestId,
		Status:     BillingTokenAdjustmentStatusPending,
		TokenId:    tokenId,
		DeltaQuota: deltaQuota,
		LastError:  lastError,
	}
	if err := DB.Create(adjustment).Error; err == nil {
		return adjustment, nil
	}

	var existing BillingTokenAdjustment
	if err := DB.Where("request_id = ?", requestId).First(&existing).Error; err != nil {
		return nil, err
	}
	if existing.TokenId != tokenId || existing.DeltaQuota != deltaQuota {
		return nil, ErrBillingTokenAdjustmentReferenceConflict
	}
	return &existing, nil
}

func ProcessBillingTokenAdjustment(requestId string) (*BillingTokenAdjustment, error) {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" {
		return nil, errors.New("billing token adjustment requestId is empty")
	}

	var completed BillingTokenAdjustment
	err := DB.Transaction(func(tx *gorm.DB) error {
		var adjustment BillingTokenAdjustment
		if err := lockForUpdate(tx).Where("request_id = ?", requestId).First(&adjustment).Error; err != nil {
			return err
		}
		if adjustment.Status == BillingTokenAdjustmentStatusComplete {
			completed = adjustment
			return nil
		}
		if adjustment.Status != BillingTokenAdjustmentStatusPending {
			return fmt.Errorf("unsupported billing token adjustment status: %s", adjustment.Status)
		}

		now := common.GetTimestamp()
		if adjustment.DeltaQuota > 0 {
			if err := decreaseTokenQuotaTx(tx, adjustment.TokenId, adjustment.DeltaQuota); err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrBillingTokenAdjustmentTokenNotFound
				}
				return err
			}
		} else {
			result := tx.Unscoped().Model(&Token{}).Where("id = ?", adjustment.TokenId).Updates(map[string]any{
				"remain_quota":  gorm.Expr("CASE WHEN unlimited_quota = ? THEN remain_quota ELSE remain_quota - ? END", true, adjustment.DeltaQuota),
				"used_quota":    gorm.Expr("used_quota + ?", adjustment.DeltaQuota),
				"accessed_time": now,
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return ErrBillingTokenAdjustmentTokenNotFound
			}
		}
		if err := tx.Model(&BillingTokenAdjustment{}).
			Where("id = ? AND status = ?", adjustment.Id, BillingTokenAdjustmentStatusPending).
			Updates(map[string]any{
				"status":          BillingTokenAdjustmentStatusComplete,
				"attempt_count":   adjustment.AttemptCount + 1,
				"last_attempt_at": now,
				"completed_at":    now,
				"last_error":      "",
				"updated_at":      now,
			}).Error; err != nil {
			return err
		}
		adjustment.Status = BillingTokenAdjustmentStatusComplete
		adjustment.AttemptCount++
		adjustment.LastAttemptAt = now
		adjustment.CompletedAt = now
		adjustment.LastError = ""
		adjustment.UpdatedAt = now
		completed = adjustment
		return nil
	})
	if err != nil {
		RecordBillingTokenAdjustmentFailure(requestId, err)
		return nil, err
	}
	invalidateBillingTokenAdjustmentCache(completed.TokenId)
	return &completed, nil
}

func RecordBillingTokenAdjustmentFailure(requestId string, cause error) {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" || cause == nil {
		return
	}
	now := common.GetTimestamp()
	if err := DB.Model(&BillingTokenAdjustment{}).
		Where("request_id = ? AND status = ?", requestId, BillingTokenAdjustmentStatusPending).
		Updates(map[string]any{
			"attempt_count":   gorm.Expr("attempt_count + ?", 1),
			"last_attempt_at": now,
			"last_error":      cause.Error(),
			"updated_at":      now,
		}).Error; err != nil {
		common.SysLog("failed to record billing token adjustment failure: " + err.Error())
	}
}

func ListPendingBillingTokenAdjustmentRequestIDs(limit int) ([]string, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	requestIds := make([]string, 0, limit)
	err := DB.Model(&BillingTokenAdjustment{}).
		Where("status = ?", BillingTokenAdjustmentStatusPending).
		Order("last_attempt_at asc, id asc").Limit(limit).
		Pluck("request_id", &requestIds).Error
	return requestIds, err
}

func HasPendingBillingTokenAdjustments() (bool, error) {
	var count int64
	err := DB.Model(&BillingTokenAdjustment{}).
		Where("status = ?", BillingTokenAdjustmentStatusPending).
		Count(&count).Error
	return count > 0, err
}

func invalidateBillingTokenAdjustmentCache(tokenId int) {
	if tokenId <= 0 || !common.RedisEnabled {
		return
	}
	gopool.Go(func() {
		var token Token
		if err := DB.Unscoped().Select("key").Where("id = ?", tokenId).First(&token).Error; err != nil {
			return
		}
		if err := cacheDeleteToken(token.Key); err != nil {
			common.SysLog("failed to invalidate token cache after billing adjustment: " + err.Error())
		}
	})
}
