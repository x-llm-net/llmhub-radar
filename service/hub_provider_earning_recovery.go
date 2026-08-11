package service

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

const hubProviderEarningRecoveryBatchSize = 100

type HubProviderEarningRecoveryResult struct {
	Scanned   int `json:"scanned"`
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
}

// RecoverReadyHubProviderEarnings retries only earnings released after
// consumer billing. Deferred async-task earnings remain untouched.
func RecoverReadyHubProviderEarnings(ctx context.Context, limit int) (HubProviderEarningRecoveryResult, error) {
	if limit <= 0 {
		limit = hubProviderEarningRecoveryBatchSize
	}
	earnings, err := model.ListReadyPendingHubProviderEarnings(limit)
	if err != nil {
		return HubProviderEarningRecoveryResult{}, err
	}
	result := HubProviderEarningRecoveryResult{Scanned: len(earnings)}
	for _, earning := range earnings {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if err := model.SettleHubProviderEarning(earning.RequestId, earning.GrossQuota); err != nil {
			result.Failed++
			logger.LogWarn(ctx, fmt.Sprintf("hub provider earning recovery failed (request_id=%s): %v", earning.RequestId, err))
			continue
		}
		result.Completed++
	}
	return result, nil
}

type hubProviderEarningRecoveryHandler struct{}

func (hubProviderEarningRecoveryHandler) Type() string {
	return model.SystemTaskTypeHubProviderEarningRecovery
}

func (hubProviderEarningRecoveryHandler) Enabled() bool {
	pending, err := model.HasReadyPendingHubProviderEarnings()
	return err == nil && pending
}

func (hubProviderEarningRecoveryHandler) Interval() time.Duration {
	return 15 * time.Second
}

func (hubProviderEarningRecoveryHandler) NewPayload() any {
	return nil
}

func (hubProviderEarningRecoveryHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	result, err := RecoverReadyHubProviderEarnings(ctx, hubProviderEarningRecoveryBatchSize)
	if err != nil {
		failSystemTask(task, runnerID, err)
		return
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, result, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}
