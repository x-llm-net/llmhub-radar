package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	BillingTaskSettlementStatusPending  = "pending"
	BillingTaskSettlementStatusComplete = "complete"
)

var (
	ErrBillingTaskSettlementReferenceConflict     = errors.New("billing task settlement reference conflict")
	ErrBillingTaskSettlementTaskNotFound          = errors.New("billing task settlement task not found")
	ErrBillingTaskSettlementUserNotFound          = errors.New("billing task settlement user not found")
	ErrBillingTaskSettlementUserQuotaInsufficient = errors.New("billing task settlement user quota insufficient")
	ErrBillingTaskSettlementTokenNotFound         = errors.New("billing task settlement token not found")
)

// BillingTaskSettlement is the durable record for the final quota adjustment
// of a successful asynchronous task. The task row, consumer funding, token
// quota and this record are completed in one primary-database transaction.
type BillingTaskSettlement struct {
	Id                   int    `json:"id" gorm:"primaryKey"`
	TaskId               int64  `json:"task_id" gorm:"not null;uniqueIndex"`
	RequestId            string `json:"request_id" gorm:"type:varchar(96);index"`
	Status               string `json:"status" gorm:"type:varchar(24);not null;index"`
	UserId               int    `json:"user_id" gorm:"not null;index"`
	TokenId              int    `json:"token_id" gorm:"not null;default:0;index"`
	FundingSource        string `json:"funding_source" gorm:"type:varchar(24);not null"`
	SubscriptionId       int    `json:"subscription_id" gorm:"not null;default:0;index"`
	PreQuota             int    `json:"pre_quota" gorm:"not null;default:0"`
	ActualQuota          int    `json:"actual_quota" gorm:"not null;default:0"`
	DeltaQuota           int    `json:"delta_quota" gorm:"not null;default:0"`
	Reason               string `json:"reason" gorm:"type:varchar(512);not null"`
	AttemptCount         int    `json:"attempt_count" gorm:"not null;default:0"`
	LastAttemptAt        int64  `json:"last_attempt_at" gorm:"bigint;not null;default:0"`
	NextAttemptAt        int64  `json:"next_attempt_at" gorm:"bigint;not null;default:0;index"`
	CompletedAt          int64  `json:"completed_at" gorm:"bigint;not null;default:0"`
	AccountingRecordedAt int64  `json:"accounting_recorded_at" gorm:"bigint;not null;default:0"`
	EarningReleasedAt    int64  `json:"earning_released_at" gorm:"bigint;not null;default:0"`
	LastError            string `json:"last_error" gorm:"type:varchar(1024);not null"`
	CreatedAt            int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt            int64  `json:"updated_at" gorm:"bigint;index"`
}

type BillingTaskSettlementParams struct {
	TaskId         int64
	RequestId      string
	UserId         int
	TokenId        int
	FundingSource  string
	SubscriptionId int
	PreQuota       int
	ActualQuota    int
	Reason         string
}

func (settlement *BillingTaskSettlement) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	if settlement.CreatedAt == 0 {
		settlement.CreatedAt = now
	}
	if settlement.UpdatedAt == 0 {
		settlement.UpdatedAt = now
	}
	return nil
}

func CreateBillingTaskSettlement(params BillingTaskSettlementParams) (*BillingTaskSettlement, error) {
	if err := validateBillingTaskSettlementParams(params); err != nil {
		return nil, err
	}
	return createBillingTaskSettlementTx(DB, params)
}

func createBillingTaskSettlementTx(tx *gorm.DB, params BillingTaskSettlementParams) (*BillingTaskSettlement, error) {
	if tx == nil {
		return nil, errors.New("billing task settlement transaction is nil")
	}
	requestId := strings.TrimSpace(params.RequestId)
	if requestId == "" {
		requestId = fmt.Sprintf("task-settlement:%d", params.TaskId)
	}
	settlement := &BillingTaskSettlement{
		TaskId:         params.TaskId,
		RequestId:      requestId,
		Status:         BillingTaskSettlementStatusPending,
		UserId:         params.UserId,
		TokenId:        params.TokenId,
		FundingSource:  strings.TrimSpace(params.FundingSource),
		SubscriptionId: params.SubscriptionId,
		PreQuota:       params.PreQuota,
		ActualQuota:    params.ActualQuota,
		DeltaQuota:     params.ActualQuota - params.PreQuota,
		Reason:         params.Reason,
	}
	result := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "task_id"}},
		DoNothing: true,
	}).Create(settlement)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 1 {
		return settlement, nil
	}

	var existing BillingTaskSettlement
	if err := tx.Where("task_id = ?", params.TaskId).First(&existing).Error; err != nil {
		return nil, err
	}
	if !billingTaskSettlementMatches(&existing, settlement) {
		return nil, ErrBillingTaskSettlementReferenceConflict
	}
	return &existing, nil
}

// UpdateWithStatusAndBillingSettlement atomically publishes a successful task
// terminal state and its durable final-billing intent. A process interruption
// can therefore leave both changes committed or neither change committed.
func (t *Task) UpdateWithStatusAndBillingSettlement(fromStatus TaskStatus, params BillingTaskSettlementParams) (bool, *BillingTaskSettlement, error) {
	if t == nil || t.ID <= 0 {
		return false, nil, errors.New("billing task is empty")
	}
	if params.TaskId != t.ID || params.UserId != t.UserId || params.PreQuota != t.Quota {
		return false, nil, ErrBillingTaskSettlementReferenceConflict
	}
	if err := validateBillingTaskSettlementParams(params); err != nil {
		return false, nil, err
	}

	var settlement *BillingTaskSettlement
	won := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(t).Where("status = ?", fromStatus).Select("*").Updates(t)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		created, err := createBillingTaskSettlementTx(tx, params)
		if err != nil {
			return err
		}
		settlement = created
		won = true
		return nil
	})
	return won, settlement, err
}

func ProcessBillingTaskSettlement(taskId int64) (*BillingTaskSettlement, error) {
	if taskId <= 0 {
		return nil, errors.New("billing task settlement taskId is empty")
	}

	var completed BillingTaskSettlement
	err := DB.Transaction(func(tx *gorm.DB) error {
		var settlement BillingTaskSettlement
		if err := lockForUpdate(tx).Where("task_id = ?", taskId).First(&settlement).Error; err != nil {
			return err
		}
		if settlement.Status == BillingTaskSettlementStatusComplete {
			completed = settlement
			return nil
		}
		if settlement.Status != BillingTaskSettlementStatusPending {
			return fmt.Errorf("unsupported billing task settlement status: %s", settlement.Status)
		}
		var task Task
		if err := lockForUpdate(tx).
			Where("id = ? AND user_id = ?", settlement.TaskId, settlement.UserId).
			First(&task).Error; err != nil {
			return ErrBillingTaskSettlementTaskNotFound
		}
		if task.Quota != settlement.PreQuota {
			return ErrBillingTaskSettlementReferenceConflict
		}

		now := common.GetTimestamp()
		delta := settlement.DeltaQuota
		if delta != 0 {
			switch settlement.FundingSource {
			case "wallet":
				result := tx.Model(&User{}).
					Where("id = ? AND quota >= ?", settlement.UserId, delta).
					Update("quota", gorm.Expr("quota - ?", delta))
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected == 0 {
					var user User
					if err := tx.Select("id").Where("id = ?", settlement.UserId).First(&user).Error; err != nil {
						return ErrBillingTaskSettlementUserNotFound
					}
					return ErrBillingTaskSettlementUserQuotaInsufficient
				}
			case "subscription":
				if err := postConsumeUserSubscriptionDeltaTx(tx, settlement.SubscriptionId, int64(delta)); err != nil {
					if delta < 0 || !errors.Is(err, ErrSubscriptionQuotaInsufficient) {
						return err
					}
					allowOverflow, overflowErr := userActiveSubscriptionsAllowWalletOverflowTx(tx, settlement.UserId)
					if overflowErr != nil {
						return overflowErr
					}
					if !allowOverflow {
						return err
					}
					result := tx.Model(&User{}).
						Where("id = ? AND quota >= ?", settlement.UserId, delta).
						Update("quota", gorm.Expr("quota - ?", delta))
					if result.Error != nil {
						return result.Error
					}
					if result.RowsAffected == 0 {
						var user User
						if err := tx.Select("id").Where("id = ?", settlement.UserId).First(&user).Error; err != nil {
							return ErrBillingTaskSettlementUserNotFound
						}
						return ErrBillingTaskSettlementUserQuotaInsufficient
					}
				}
			default:
				return fmt.Errorf("unsupported billing task settlement funding source: %s", settlement.FundingSource)
			}

			if settlement.TokenId > 0 {
				if delta > 0 {
					var token Token
					if err := lockForUpdate(tx.Unscoped()).Select("id", "user_id").Where("id = ? AND user_id = ?", settlement.TokenId, settlement.UserId).First(&token).Error; err != nil {
						return ErrBillingTaskSettlementTokenNotFound
					}
					if err := decreaseTokenQuotaTx(tx, settlement.TokenId, delta); err != nil {
						if errors.Is(err, gorm.ErrRecordNotFound) {
							return ErrBillingTaskSettlementTokenNotFound
						}
						return err
					}
				} else {
					result := tx.Unscoped().Model(&Token{}).
						Where("id = ? AND user_id = ?", settlement.TokenId, settlement.UserId).
						Updates(map[string]any{
							"remain_quota":  gorm.Expr("CASE WHEN unlimited_quota = ? THEN remain_quota ELSE remain_quota - ? END", true, delta),
							"used_quota":    gorm.Expr("used_quota + ?", delta),
							"accessed_time": now,
						})
					if result.Error != nil {
						return result.Error
					}
					if result.RowsAffected == 0 {
						return ErrBillingTaskSettlementTokenNotFound
					}
				}
			}

			result := tx.Model(&User{}).
				Where("id = ?", settlement.UserId).
				Update("used_quota", gorm.Expr("used_quota + ?", delta))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return ErrBillingTaskSettlementUserNotFound
			}
			if task.ChannelId > 0 {
				result = tx.Model(&Channel{}).
					Where("id = ?", task.ChannelId).
					Update("used_quota", gorm.Expr("used_quota + ?", delta))
				if result.Error != nil {
					return result.Error
				}
			}
		}

		if settlement.ActualQuota != settlement.PreQuota {
			result := tx.Model(&Task{}).
				Where("id = ? AND user_id = ? AND quota = ?", settlement.TaskId, settlement.UserId, settlement.PreQuota).
				Update("quota", settlement.ActualQuota)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return ErrBillingTaskSettlementTaskNotFound
			}
		}

		result := tx.Model(&BillingTaskSettlement{}).
			Where("id = ? AND status = ?", settlement.Id, BillingTaskSettlementStatusPending).
			Updates(map[string]any{
				"status":          BillingTaskSettlementStatusComplete,
				"attempt_count":   settlement.AttemptCount + 1,
				"last_attempt_at": now,
				"next_attempt_at": 0,
				"completed_at":    now,
				"last_error":      "",
				"updated_at":      now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrBillingTaskSettlementReferenceConflict
		}

		settlement.Status = BillingTaskSettlementStatusComplete
		settlement.AttemptCount++
		settlement.LastAttemptAt = now
		settlement.CompletedAt = now
		settlement.LastError = ""
		settlement.UpdatedAt = now
		completed = settlement
		return nil
	})
	if err != nil {
		RecordBillingTaskSettlementFailure(taskId, err)
		return nil, err
	}
	invalidateBillingTaskSettlementCaches(completed.UserId, completed.TokenId)
	return &completed, nil
}

func RecordBillingTaskSettlementFailure(taskId int64, cause error) {
	if taskId <= 0 || cause == nil {
		return
	}
	now := common.GetTimestamp()
	var settlement BillingTaskSettlement
	if err := DB.Where("task_id = ?", taskId).First(&settlement).Error; err != nil {
		common.SysLog("failed to load billing task settlement failure state: " + err.Error())
		return
	}
	if settlement.Status == BillingTaskSettlementStatusComplete && settlement.EarningReleasedAt > 0 {
		return
	}
	attemptCount := settlement.AttemptCount + 1
	backoffSeconds := int64(15)
	for i := 1; i < attemptCount && backoffSeconds < 3600; i++ {
		backoffSeconds *= 2
	}
	if backoffSeconds > 3600 {
		backoffSeconds = 3600
	}
	if err := DB.Model(&BillingTaskSettlement{}).
		Where("task_id = ? AND (status = ? OR (status = ? AND earning_released_at = 0))", taskId,
			BillingTaskSettlementStatusPending, BillingTaskSettlementStatusComplete).
		Updates(map[string]any{
			"attempt_count":   gorm.Expr("attempt_count + 1"),
			"last_attempt_at": now,
			"next_attempt_at": now + backoffSeconds,
			"last_error":      cause.Error(),
			"updated_at":      now,
		}).Error; err != nil {
		common.SysLog("failed to record billing task settlement failure: " + err.Error())
	}
}

func GetBillingTaskSettlement(taskId int64) (*BillingTaskSettlement, error) {
	if taskId <= 0 {
		return nil, errors.New("billing task settlement taskId is empty")
	}
	var settlement BillingTaskSettlement
	if err := DB.Where("task_id = ?", taskId).First(&settlement).Error; err != nil {
		return nil, err
	}
	return &settlement, nil
}

func MarkBillingTaskSettlementEarningReleased(taskId int64) error {
	if taskId <= 0 {
		return errors.New("billing task settlement taskId is empty")
	}
	now := common.GetTimestamp()
	result := DB.Model(&BillingTaskSettlement{}).
		Where("task_id = ? AND status = ? AND earning_released_at = 0", taskId, BillingTaskSettlementStatusComplete).
		Updates(map[string]any{"earning_released_at": now, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		return nil
	}
	var settlement BillingTaskSettlement
	if err := DB.Where("task_id = ?", taskId).First(&settlement).Error; err != nil {
		return err
	}
	if settlement.Status == BillingTaskSettlementStatusComplete && settlement.EarningReleasedAt > 0 {
		return nil
	}
	return errors.New("billing task settlement is not complete")
}

func MarkBillingTaskSettlementAccountingRecorded(taskId int64) error {
	if taskId <= 0 {
		return errors.New("billing task settlement taskId is empty")
	}
	now := common.GetTimestamp()
	result := DB.Model(&BillingTaskSettlement{}).
		Where("task_id = ? AND status = ? AND accounting_recorded_at = 0", taskId, BillingTaskSettlementStatusComplete).
		Updates(map[string]any{"accounting_recorded_at": now, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		return nil
	}
	var settlement BillingTaskSettlement
	if err := DB.Where("task_id = ?", taskId).First(&settlement).Error; err != nil {
		return err
	}
	if settlement.Status == BillingTaskSettlementStatusComplete && settlement.AccountingRecordedAt > 0 {
		return nil
	}
	return errors.New("billing task settlement is not complete")
}

func ListRecoverableBillingTaskSettlementIDs(limit int) ([]int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	ids := make([]int64, 0, limit)
	now := common.GetTimestamp()
	err := DB.Model(&BillingTaskSettlement{}).
		Where("(status = ? OR (status = ? AND earning_released_at = 0)) AND (next_attempt_at = 0 OR next_attempt_at <= ?)",
			BillingTaskSettlementStatusPending, BillingTaskSettlementStatusComplete, now).
		Order("id asc").Limit(limit).Pluck("task_id", &ids).Error
	return ids, err
}

func HasRecoverableBillingTaskSettlements() (bool, error) {
	var count int64
	now := common.GetTimestamp()
	err := DB.Model(&BillingTaskSettlement{}).
		Where("(status = ? OR (status = ? AND earning_released_at = 0)) AND (next_attempt_at = 0 OR next_attempt_at <= ?)",
			BillingTaskSettlementStatusPending, BillingTaskSettlementStatusComplete, now).
		Count(&count).Error
	return count > 0, err
}

func validateBillingTaskSettlementParams(params BillingTaskSettlementParams) error {
	if params.TaskId <= 0 || params.UserId <= 0 || params.PreQuota < 0 || params.ActualQuota < 0 || params.TokenId < 0 || params.SubscriptionId < 0 {
		return errors.New("invalid billing task settlement")
	}
	switch strings.TrimSpace(params.FundingSource) {
	case "wallet":
		if params.SubscriptionId != 0 {
			return errors.New("wallet billing task settlement cannot contain subscription id")
		}
	case "subscription":
		if params.SubscriptionId <= 0 {
			return errors.New("subscription billing task settlement requires subscription id")
		}
	default:
		return fmt.Errorf("unsupported billing task settlement funding source: %s", params.FundingSource)
	}
	return nil
}

func billingTaskSettlementMatches(existing, expected *BillingTaskSettlement) bool {
	return existing != nil && expected != nil &&
		existing.TaskId == expected.TaskId &&
		existing.RequestId == expected.RequestId &&
		existing.UserId == expected.UserId &&
		existing.TokenId == expected.TokenId &&
		existing.FundingSource == expected.FundingSource &&
		existing.SubscriptionId == expected.SubscriptionId &&
		existing.PreQuota == expected.PreQuota &&
		existing.ActualQuota == expected.ActualQuota &&
		existing.DeltaQuota == expected.DeltaQuota
}

func invalidateBillingTaskSettlementCaches(userId, tokenId int) {
	if userId > 0 {
		if err := invalidateUserCache(userId); err != nil {
			common.SysLog("failed to invalidate user cache after billing task settlement: " + err.Error())
		}
	}
	if tokenId <= 0 || !common.RedisEnabled {
		return
	}
	var token Token
	if err := DB.Unscoped().Select("key").Where("id = ?", tokenId).First(&token).Error; err != nil {
		return
	}
	if err := cacheDeleteToken(token.Key); err != nil {
		common.SysLog("failed to invalidate token cache after billing task settlement: " + err.Error())
	}
}
