package service

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

const billingTaskSettlementRecoveryBatchSize = 100

type BillingTaskSettlementRecoveryResult struct {
	Scanned   int `json:"scanned"`
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
}

// RecoverPendingBillingTaskSettlements completes durable task quota changes
// and releases provider earnings after a process interruption.
func RecoverPendingBillingTaskSettlements(ctx context.Context, limit int) (BillingTaskSettlementRecoveryResult, error) {
	if limit <= 0 {
		limit = billingTaskSettlementRecoveryBatchSize
	}
	taskIds, err := model.ListRecoverableBillingTaskSettlementIDs(limit)
	if err != nil {
		return BillingTaskSettlementRecoveryResult{}, err
	}
	result := BillingTaskSettlementRecoveryResult{Scanned: len(taskIds)}
	for _, taskId := range taskIds {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		settlement, err := model.GetBillingTaskSettlement(taskId)
		if err != nil {
			result.Failed++
			model.RecordBillingTaskSettlementFailure(taskId, err)
			logger.LogWarn(ctx, fmt.Sprintf("billing task settlement lookup failed (task_id=%d): %v", taskId, err))
			continue
		}
		if settlement.Status == model.BillingTaskSettlementStatusPending {
			settlement, err = model.ProcessBillingTaskSettlement(taskId)
			if err != nil {
				result.Failed++
				logger.LogWarn(ctx, fmt.Sprintf("billing task settlement recovery failed (task_id=%d): %v", taskId, err))
				continue
			}
		}

		var task model.Task
		if err := model.DB.Where("id = ?", taskId).First(&task).Error; err != nil {
			result.Failed++
			model.RecordBillingTaskSettlementFailure(taskId, err)
			logger.LogWarn(ctx, fmt.Sprintf("billing task settlement task lookup failed (task_id=%d): %v", taskId, err))
			continue
		}
		task.Quota = settlement.ActualQuota
		if settlement.AccountingRecordedAt == 0 {
			if err := recordTaskQuotaAdjustment(ctx, &task, settlement.PreQuota, settlement.ActualQuota, settlement.Reason, true); err != nil {
				result.Failed++
				model.RecordBillingTaskSettlementFailure(taskId, err)
				logger.LogWarn(ctx, fmt.Sprintf("billing task settlement accounting log failed (task_id=%d): %v", taskId, err))
				continue
			}
			if err := model.MarkBillingTaskSettlementAccountingRecorded(taskId); err != nil {
				result.Failed++
				model.RecordBillingTaskSettlementFailure(taskId, err)
				logger.LogWarn(ctx, fmt.Sprintf("billing task settlement accounting marker failed (task_id=%d): %v", taskId, err))
				continue
			}
		}
		if err := FinalizeTaskProviderEarning(ctx, &task); err != nil {
			result.Failed++
			model.RecordBillingTaskSettlementFailure(taskId, err)
			logger.LogWarn(ctx, fmt.Sprintf("billing task provider earning recovery failed (task_id=%d): %v", taskId, err))
			continue
		}
		if err := model.MarkBillingTaskSettlementEarningReleased(taskId); err != nil {
			result.Failed++
			model.RecordBillingTaskSettlementFailure(taskId, err)
			logger.LogWarn(ctx, fmt.Sprintf("billing task settlement completion marker failed (task_id=%d): %v", taskId, err))
			continue
		}
		result.Completed++
	}
	return result, nil
}

type billingTaskSettlementRecoveryHandler struct{}

func (billingTaskSettlementRecoveryHandler) Type() string {
	return model.SystemTaskTypeBillingTaskSettlementRecovery
}

func (billingTaskSettlementRecoveryHandler) Enabled() bool {
	pending, err := model.HasRecoverableBillingTaskSettlements()
	return err == nil && pending
}

func (billingTaskSettlementRecoveryHandler) Interval() time.Duration {
	return 15 * time.Second
}

func (billingTaskSettlementRecoveryHandler) NewPayload() any {
	return nil
}

func (billingTaskSettlementRecoveryHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	result, err := RecoverPendingBillingTaskSettlements(ctx, billingTaskSettlementRecoveryBatchSize)
	if err != nil {
		failSystemTask(task, runnerID, err)
		return
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, result, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}
