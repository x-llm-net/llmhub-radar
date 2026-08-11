package service

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

const billingRefundRecoveryBatchSize = 100

type BillingRefundRecoveryResult struct {
	Scanned   int `json:"scanned"`
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
}

// RecoverPendingBillingRefunds completes records left by a failed process or a
// transient database error. ProcessBillingRefund is request-id idempotent.
func RecoverPendingBillingRefunds(ctx context.Context, limit int) (BillingRefundRecoveryResult, error) {
	if limit <= 0 {
		limit = billingRefundRecoveryBatchSize
	}
	requestIds, err := model.ListPendingBillingRefundRequestIDs(limit)
	if err != nil {
		return BillingRefundRecoveryResult{}, err
	}
	result := BillingRefundRecoveryResult{Scanned: len(requestIds)}
	for _, requestId := range requestIds {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		refund, err := model.ProcessBillingRefund(requestId)
		if err != nil {
			result.Failed++
			logger.LogWarn(ctx, fmt.Sprintf("billing refund recovery failed (request_id=%s): %v", requestId, err))
			continue
		}
		if err := model.CancelHubProviderEarning(refund.RequestId); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("cancel provider earning after refund recovery failed (request_id=%s): %v", requestId, err))
		}
		result.Completed++
	}
	return result, nil
}

type billingRefundRecoveryHandler struct{}

func (billingRefundRecoveryHandler) Type() string {
	return model.SystemTaskTypeBillingRefundRecovery
}

func (billingRefundRecoveryHandler) Enabled() bool {
	pending, err := model.HasPendingBillingRefunds()
	if err != nil {
		common.SysLog("failed to check pending billing refunds: " + err.Error())
		return false
	}
	return pending
}

func (billingRefundRecoveryHandler) Interval() time.Duration {
	return 15 * time.Second
}

func (billingRefundRecoveryHandler) NewPayload() any {
	return nil
}

func (billingRefundRecoveryHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	result, err := RecoverPendingBillingRefunds(ctx, billingRefundRecoveryBatchSize)
	if err != nil {
		failSystemTask(task, runnerID, err)
		return
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, result, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}
