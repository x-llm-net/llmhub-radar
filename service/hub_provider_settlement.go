/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func prepareHubProviderEarning(ctx context.Context, relayInfo *relaycommon.RelayInfo, actualQuota int, settlementDeferred *bool) (string, error) {
	if relayInfo == nil || actualQuota <= 0 {
		return "", nil
	}
	pricing := relayInfo.PriceData.GroupRatioInfo
	if !pricing.HasSupplyPricing {
		return "", nil
	}
	if pricing.SupplyGroupId <= 0 || pricing.SupplyProviderId <= 0 ||
		pricing.SupplyOwnerUserId <= 0 || relayInfo.ChannelId <= 0 {
		return "", errors.New("incomplete hub provider earning snapshot")
	}
	requestId := relayInfo.RequestId
	if requestId == "" {
		requestId = common.NewRequestId()
		relayInfo.RequestId = requestId
	}
	var earning *model.HubProviderEarning
	err := billingOperationWithRetry(func() error {
		var err error
		earning, err = model.PrepareHubProviderEarning(model.HubProviderEarningParams{
			RequestId:                 requestId,
			ProviderId:                pricing.SupplyProviderId,
			OwnerUserId:               pricing.SupplyOwnerUserId,
			ConsumerUserId:            relayInfo.UserId,
			TokenId:                   relayInfo.TokenId,
			SupplyGroupId:             pricing.SupplyGroupId,
			ChannelId:                 relayInfo.ChannelId,
			ModelName:                 relayInfo.OriginModelName,
			BillingSource:             relayInfo.BillingSource,
			GrossQuota:                actualQuota,
			BaseGroupRatio:            pricing.BaseGroupRatio,
			SupplyMultiplier:          pricing.SupplyMultiplier,
			BillingRatio:              pricing.GroupRatio,
			PlatformFeeBasisPoints:    pricing.PlatformFeeBasisPoints,
			HasPlatformFeeBasisPoints: pricing.HasPlatformFeeBasisPoints,
			SettlementDeferred:        settlementDeferred,
		})
		return err
	})
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf(
			"prepare hub provider earning failed (request_id=%s, provider_id=%d, channel_id=%d): %s",
			requestId,
			pricing.SupplyProviderId,
			relayInfo.ChannelId,
			err.Error(),
		))
		return "", fmt.Errorf("prepare hub provider earning: %w", err)
	}
	relayInfo.PriceData.GroupRatioInfo.PlatformFeeBasisPoints = earning.PlatformFeeBasisPoints
	relayInfo.PriceData.GroupRatioInfo.HasPlatformFeeBasisPoints = true
	return requestId, nil
}

// SettleBillingAndProviderEarning prepares the provider share before charging
// the consumer, then publishes the final amount for immediate or recovered
// settlement. Preparation failures stop consumer settlement.
func SettleBillingAndProviderEarning(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) error {
	deferred := true
	requestId, err := prepareHubProviderEarning(ctx, relayInfo, actualQuota, &deferred)
	if err != nil {
		return err
	}
	if err := SettleBilling(ctx, relayInfo, actualQuota); err != nil {
		if requestId != "" {
			if BillingSettlementCommitted(relayInfo) {
				committedQuota := BillingCommittedQuota(relayInfo)
				if committedQuota <= 0 {
					if cancelErr := model.CancelHubProviderEarning(requestId); cancelErr != nil {
						logger.LogError(ctx, "cancel zero-quota provider earning after billing failure: "+cancelErr.Error())
					}
				} else if releaseErr := settlePreparedHubProviderEarning(ctx, requestId, committedQuota); releaseErr != nil {
					logger.LogError(ctx, "release hub provider earning after committed billing failure: "+releaseErr.Error())
				}
			} else if cancelErr := model.CancelHubProviderEarning(requestId); cancelErr != nil {
				logger.LogError(ctx, "cancel hub provider earning after billing failure: "+cancelErr.Error())
			}
		}
		return err
	}
	if requestId != "" {
		if err := settlePreparedHubProviderEarning(ctx, requestId, actualQuota); err != nil {
			return err
		}
	}
	return nil
}

// SettleTaskBillingAndPrepareProviderEarning charges the consumer for an
// accepted asynchronous task but leaves provider income pending until the task
// reaches a successful terminal state.
func SettleTaskBillingAndPrepareProviderEarning(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) error {
	deferred := true
	requestId, err := prepareHubProviderEarning(ctx, relayInfo, actualQuota, &deferred)
	if err != nil {
		return err
	}
	if err := SettleBilling(ctx, relayInfo, actualQuota); err != nil {
		if requestId != "" {
			if !BillingSettlementCommitted(relayInfo) {
				if cancelErr := model.CancelHubProviderEarning(requestId); cancelErr != nil {
					logger.LogError(ctx, "cancel pending task earning after billing failure: "+cancelErr.Error())
				}
			}
		}
		return err
	}
	return nil
}

// SettleLegacyProviderEarning records revenue for legacy paths that already
// completed consumer billing through PostConsumeQuota.
func SettleLegacyProviderEarning(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) {
	ready := false
	requestId, err := prepareHubProviderEarning(ctx, relayInfo, actualQuota, &ready)
	if err != nil {
		logger.LogError(ctx, err.Error())
		return
	}
	if requestId == "" {
		return
	}
	if err := model.SettleHubProviderEarning(requestId, actualQuota); err != nil {
		logger.LogError(ctx, fmt.Sprintf(
			"settle legacy hub provider earning failed (request_id=%s, quota=%d): %s",
			requestId,
			actualQuota,
			err.Error(),
		))
	}
}

func BillingSettlementCommitted(relayInfo *relaycommon.RelayInfo) bool {
	if relayInfo == nil || relayInfo.Billing == nil {
		return false
	}
	committed, ok := relayInfo.Billing.(interface{ SettlementCommitted() bool })
	return ok && committed.SettlementCommitted()
}

func BillingCommittedQuota(relayInfo *relaycommon.RelayInfo) int {
	if relayInfo == nil || relayInfo.Billing == nil {
		return 0
	}
	committed, ok := relayInfo.Billing.(interface{ CommittedQuota() int })
	if !ok {
		return 0
	}
	return committed.CommittedQuota()
}

func settlePreparedHubProviderEarning(ctx *gin.Context, requestId string, actualQuota int) error {
	if requestId == "" {
		return nil
	}
	if err := billingOperationWithRetry(func() error {
		return model.MarkHubProviderEarningReady(requestId, actualQuota)
	}); err != nil {
		logger.LogError(ctx, fmt.Sprintf(
			"mark hub provider earning ready failed (request_id=%s): %s",
			requestId,
			err.Error(),
		))
		return err
	}
	if err := model.SettleHubProviderEarning(requestId, actualQuota); err != nil {
		logger.LogError(ctx, fmt.Sprintf(
			"settle hub provider earning failed (request_id=%s, quota=%d): %s",
			requestId,
			actualQuota,
			err.Error(),
		))
		// MarkReady persisted the final amount and recovery can now settle it.
	}
	return nil
}

func FinalizeTaskProviderEarning(ctx context.Context, task *model.Task) error {
	if task == nil || task.Quota <= 0 || task.PrivateData.RequestId == "" {
		return nil
	}
	if err := model.MarkHubProviderEarningReady(task.PrivateData.RequestId, task.Quota); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) && !taskExpectsProviderEarning(task) {
			return nil
		}
		logger.LogError(ctx, fmt.Sprintf(
			"mark task provider earning ready failed (task=%s, request_id=%s): %s",
			task.TaskID,
			task.PrivateData.RequestId,
			err.Error(),
		))
		return err
	}
	if err := model.SettleHubProviderEarning(task.PrivateData.RequestId, task.Quota); err != nil {
		logger.LogError(ctx, fmt.Sprintf(
			"finalize task provider earning failed (task=%s, request_id=%s, quota=%d): %s",
			task.TaskID,
			task.PrivateData.RequestId,
			task.Quota,
			err.Error(),
		))
		return err
	}
	return nil
}

func taskExpectsProviderEarning(task *model.Task) bool {
	if task == nil || task.PrivateData.BillingContext == nil {
		return false
	}
	pricing := task.PrivateData.BillingContext
	return pricing.HasSupplyPricing && pricing.SupplyProviderId > 0 && pricing.SupplyOwnerUserId > 0
}

func CancelTaskProviderEarning(ctx context.Context, task *model.Task) {
	if task == nil || task.PrivateData.RequestId == "" {
		return
	}
	if err := model.CancelHubProviderEarning(task.PrivateData.RequestId); err != nil {
		logger.LogError(ctx, fmt.Sprintf(
			"cancel task provider earning failed (task=%s, request_id=%s): %s",
			task.TaskID,
			task.PrivateData.RequestId,
			err.Error(),
		))
	}
}
