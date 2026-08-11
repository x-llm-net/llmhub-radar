package service

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

const billingTokenAdjustmentRecoveryBatchSize = 100

type BillingTokenAdjustmentRecoveryResult struct {
	Scanned   int `json:"scanned"`
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
}

func RecoverPendingBillingTokenAdjustments(ctx context.Context, limit int) (BillingTokenAdjustmentRecoveryResult, error) {
	if limit <= 0 {
		limit = billingTokenAdjustmentRecoveryBatchSize
	}
	requestIds, err := model.ListPendingBillingTokenAdjustmentRequestIDs(limit)
	if err != nil {
		return BillingTokenAdjustmentRecoveryResult{}, err
	}
	result := BillingTokenAdjustmentRecoveryResult{Scanned: len(requestIds)}
	for _, requestId := range requestIds {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if _, err := model.ProcessBillingTokenAdjustment(requestId); err != nil {
			result.Failed++
			logger.LogWarn(ctx, fmt.Sprintf("billing token adjustment recovery failed (request_id=%s): %v", requestId, err))
			continue
		}
		result.Completed++
	}
	return result, nil
}

type billingTokenAdjustmentRecoveryHandler struct{}

func (billingTokenAdjustmentRecoveryHandler) Type() string {
	return model.SystemTaskTypeBillingTokenAdjustmentRecovery
}

func (billingTokenAdjustmentRecoveryHandler) Enabled() bool {
	pending, err := model.HasPendingBillingTokenAdjustments()
	return err == nil && pending
}

func (billingTokenAdjustmentRecoveryHandler) Interval() time.Duration {
	return 15 * time.Second
}

func (billingTokenAdjustmentRecoveryHandler) NewPayload() any {
	return nil
}

func (billingTokenAdjustmentRecoveryHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	result, err := RecoverPendingBillingTokenAdjustments(ctx, billingTokenAdjustmentRecoveryBatchSize)
	if err != nil {
		failSystemTask(task, runnerID, err)
		return
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, result, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}
