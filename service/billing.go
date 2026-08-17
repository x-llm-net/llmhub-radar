package service

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

const (
	BillingSourceWallet       = "wallet"
	BillingSourceSubscription = "subscription"
)

func NewBillingSettlementError(err error) *types.NewAPIError {
	if err == nil {
		return nil
	}
	return types.NewErrorWithStatusCode(
		fmt.Errorf("billing settlement failed: %w", err),
		types.ErrorCodeUpdateDataError,
		http.StatusInternalServerError,
		types.ErrOptionWithSkipRetry(),
	)
}

// PreConsumeBilling 根据用户计费偏好创建 BillingSession 并执行预扣费。
// 会话存储在 relayInfo.Billing 上，供后续 Settle / Refund 使用。
func PreConsumeBilling(c *gin.Context, preConsumedQuota int, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	if relayInfo != nil && relayInfo.QuotaClamp != nil {
		return types.NewErrorWithStatusCode(
			relayInfo.QuotaClamp,
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if preConsumedQuota < 0 {
		return types.NewErrorWithStatusCode(
			fmt.Errorf("pre-consume quota cannot be negative: %d", preConsumedQuota),
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	session, apiErr := NewBillingSession(c, relayInfo, preConsumedQuota)
	if apiErr != nil {
		return apiErr
	}
	relayInfo.Billing = session
	return nil
}

// PrepareBillingForSelectedChannel refreshes the reservation after routing or
// retrying to a channel whose user-group or supply multiplier differs.
func PrepareBillingForSelectedChannel(c *gin.Context, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	if relayInfo == nil {
		return types.NewErrorWithStatusCode(
			fmt.Errorf("relay info is nil"),
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if relayInfo.TieredBillingSnapshot != nil {
		return PrepareTieredBillingForSelectedGroup(c, relayInfo)
	}
	if relayInfo.PriceData.QuotaBeforeGroup < 0 {
		return types.NewErrorWithStatusCode(
			fmt.Errorf("quota before group cannot be negative: %f", relayInfo.PriceData.QuotaBeforeGroup),
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}

	targetQuota, err := common.QuotaFromFloatStrict(
		relayInfo.PriceData.QuotaBeforeGroup * relayInfo.PriceData.GroupRatioInfo.GroupRatio,
	)
	if err != nil {
		return types.NewErrorWithStatusCode(
			err,
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	relayInfo.PriceData.QuotaToPreConsume = targetQuota
	if targetQuota == 0 {
		if relayInfo.Billing == nil {
			relayInfo.PriceData.FreeModel = true
		}
		return nil
	}

	relayInfo.PriceData.FreeModel = false
	if relayInfo.Billing == nil {
		return PreConsumeBilling(c, targetQuota, relayInfo)
	}
	if err := relayInfo.Billing.Reserve(targetQuota); err != nil {
		var apiErr *types.NewAPIError
		if errors.As(err, &apiErr) {
			return apiErr
		}
		return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
	}
	relayInfo.FinalPreConsumedQuota = relayInfo.Billing.GetPreConsumedQuota()
	return nil
}

// ---------------------------------------------------------------------------
// SettleBilling — 后结算辅助函数
// ---------------------------------------------------------------------------

// SettleBilling 执行计费结算。如果 RelayInfo 上有 BillingSession 则通过 session 结算，
// 否则回退到旧的 PostConsumeQuota 路径（兼容按次计费等场景）。
func SettleBilling(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) error {
	if relayInfo.Billing != nil {
		preConsumed := relayInfo.Billing.GetPreConsumedQuota()
		delta := actualQuota - preConsumed

		if delta > 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后补扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else if delta < 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后返还扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(-delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费与实际消耗一致，无需调整：%s（按次计费）",
				logger.FormatQuota(actualQuota),
			))
		}

		if err := relayInfo.Billing.Settle(actualQuota); err != nil {
			return err
		}

		// 发送额度通知（订阅计费使用订阅剩余额度）
		if actualQuota != 0 {
			if relayInfo.BillingSource == BillingSourceSubscription {
				checkAndSendSubscriptionQuotaNotify(relayInfo)
			} else {
				checkAndSendQuotaNotify(relayInfo, actualQuota-preConsumed, preConsumed)
			}
		}
		return nil
	}
	if actualQuota > 0 && relayInfo.FinalPreConsumedQuota == 0 {
		// A zero-priced base model can still incur tool or audio surcharges.
		// Create the normal durable wallet session at settlement time instead of
		// falling back to the legacy batched quota updater.
		session := &BillingSession{
			relayInfo: relayInfo,
			funding:   &WalletFunding{userId: relayInfo.UserId},
		}
		relayInfo.Billing = session
		relayInfo.BillingSource = BillingSourceWallet
		return session.Settle(actualQuota)
	}

	// 回退：无 BillingSession 时使用旧路径
	quotaDelta := actualQuota - relayInfo.FinalPreConsumedQuota
	if quotaDelta != 0 {
		return PostConsumeQuota(relayInfo, quotaDelta, relayInfo.FinalPreConsumedQuota, true)
	}
	return nil
}

// BillingAccountedQuota returns the durable amount used for logs and usage
// counters. A failed final adjustment may retain only the original precharge.
func BillingAccountedQuota(relayInfo *relaycommon.RelayInfo, actualQuota int, settlementErr error) int {
	if settlementErr == nil || !BillingSettlementCommitted(relayInfo) {
		return actualQuota
	}
	committedQuota := BillingCommittedQuota(relayInfo)
	if committedQuota < 0 {
		return 0
	}
	return committedQuota
}
