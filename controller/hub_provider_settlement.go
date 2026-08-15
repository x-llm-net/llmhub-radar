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
package controller

import (
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const hubProviderSettlementRemarkMaxLength = 1000

type hubProviderWithdrawalCreateRequest struct {
	AmountQuota     int `json:"amount_quota"`
	PayoutAccountId int `json:"payout_account_id"`
}

type hubProviderWithdrawalStatusRequest struct {
	Status            string `json:"status"`
	AdminRemark       string `json:"admin_remark"`
	PayoutCurrency    string `json:"payout_currency"`
	PayoutAmountMinor int64  `json:"payout_amount_minor"`
	ExchangeRate      string `json:"exchange_rate"`
}

type hubProviderEarningAdjustmentRequest struct {
	AmountQuota int    `json:"amount_quota"`
	Remark      string `json:"remark"`
}

type hubProviderBalanceTransferRequest struct {
	AmountQuota    int    `json:"amount_quota"`
	IdempotencyKey string `json:"idempotency_key"`
}

func GetHubProviderEarningSummary(c *gin.Context) {
	provider, ok := currentHubProviderOrError(c)
	if !ok {
		return
	}
	summary, err := model.GetHubProviderSettlementSummary(provider.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

func GetHubProviderEarnings(c *gin.Context) {
	provider, ok := currentHubProviderOrError(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListHubProviderEarnings(
		provider.Id,
		pageInfo.GetStartIdx(),
		pageInfo.GetPageSize(),
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func GetHubProviderWithdrawals(c *gin.Context) {
	provider, ok := currentHubProviderOrError(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListHubProviderWithdrawals(
		provider.Id,
		pageInfo.GetStartIdx(),
		pageInfo.GetPageSize(),
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func CreateHubProviderWithdrawal(c *gin.Context) {
	if _, ok := currentHubProviderOrError(c); !ok {
		return
	}
	var req hubProviderWithdrawalCreateRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if req.AmountQuota <= 0 || req.PayoutAccountId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalInvalid)
		return
	}
	withdrawal, err := model.CreateHubProviderWithdrawal(c.GetInt("id"), req.AmountQuota, req.PayoutAccountId)
	if err != nil {
		switch {
		case errors.Is(err, model.ErrHubProviderWithdrawalPending):
			common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalPending)
		case errors.Is(err, model.ErrHubProviderWithdrawalInsufficient):
			common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalInsufficient)
		case errors.Is(err, model.ErrHubProviderPayoutAccountNotFound),
			errors.Is(err, model.ErrHubProviderPayoutAccountInvalid):
			common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutAccountInvalid)
		default:
			common.ApiError(c, err)
		}
		return
	}
	common.ApiSuccess(c, withdrawal)
}

func CreateHubProviderBalanceTransfer(c *gin.Context) {
	if _, ok := currentHubProviderOrError(c); !ok {
		return
	}
	var req hubProviderBalanceTransferRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.AmountQuota <= 0 || req.IdempotencyKey == "" || len(req.IdempotencyKey) > 48 {
		common.ApiErrorI18n(c, i18n.MsgHubProviderBalanceTransferInvalid)
		return
	}
	transfer, err := model.CreateHubProviderBalanceTransfer(c.GetInt("id"), req.AmountQuota, req.IdempotencyKey)
	if err != nil {
		if errors.Is(err, model.ErrHubProviderBalanceTransferInsufficient) {
			common.ApiErrorI18n(c, i18n.MsgHubProviderBalanceTransferInsufficient)
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, transfer)
}

func AdminGetHubProviderEarnings(c *gin.Context) {
	providerId, err := strconv.Atoi(c.Param("id"))
	if err != nil || providerId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListHubProviderEarnings(
		providerId,
		pageInfo.GetStartIdx(),
		pageInfo.GetPageSize(),
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func AdminGetHubProviderEarningSummary(c *gin.Context) {
	providerId, err := strconv.Atoi(c.Param("id"))
	if err != nil || providerId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	summary, err := model.GetHubProviderSettlementSummary(providerId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

func AdminCreateHubProviderEarningAdjustment(c *gin.Context) {
	providerId, err := strconv.Atoi(c.Param("id"))
	if err != nil || providerId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	var req hubProviderEarningAdjustmentRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.Remark = strings.TrimSpace(req.Remark)
	if req.AmountQuota == 0 || req.Remark == "" || utf8.RuneCountInString(req.Remark) > hubProviderSettlementRemarkMaxLength {
		common.ApiErrorI18n(c, i18n.MsgHubProviderAdjustmentInvalid)
		return
	}
	earning, err := model.CreateHubProviderManualAdjustment(providerId, req.AmountQuota, c.GetInt("id"), req.Remark)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, earning)
}

func AdminGetHubProviderWithdrawals(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.AdminListHubProviderWithdrawals(
		strings.TrimSpace(c.Query("status")),
		pageInfo.GetStartIdx(),
		pageInfo.GetPageSize(),
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func AdminUpdateHubProviderWithdrawalStatus(c *gin.Context) {
	withdrawalId, err := strconv.Atoi(c.Param("withdrawal_id"))
	if err != nil || withdrawalId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	var req hubProviderWithdrawalStatusRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.Status = strings.TrimSpace(req.Status)
	req.AdminRemark = strings.TrimSpace(req.AdminRemark)
	req.PayoutCurrency = strings.TrimSpace(req.PayoutCurrency)
	req.ExchangeRate = strings.TrimSpace(req.ExchangeRate)
	if !model.IsValidHubProviderWithdrawalStatus(req.Status) ||
		req.Status == model.HubProviderWithdrawalStatusPending ||
		utf8.RuneCountInString(req.AdminRemark) > hubProviderSettlementRemarkMaxLength {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if (req.Status == model.HubProviderWithdrawalStatusPaid ||
		req.Status == model.HubProviderWithdrawalStatusRejected) && req.AdminRemark == "" {
		common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalRemarkRequired)
		return
	}
	var payment *model.HubProviderWithdrawalPayment
	if req.Status == model.HubProviderWithdrawalStatusPaid {
		payment = &model.HubProviderWithdrawalPayment{
			Currency:     req.PayoutCurrency,
			AmountMinor:  req.PayoutAmountMinor,
			ExchangeRate: req.ExchangeRate,
		}
	}
	withdrawal, err := model.UpdateHubProviderWithdrawalStatus(
		withdrawalId,
		req.Status,
		c.GetInt("id"),
		req.AdminRemark,
		payment,
	)
	if err != nil {
		if errors.Is(err, model.ErrHubProviderWithdrawalTransition) {
			common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalTransition)
			return
		}
		if errors.Is(err, model.ErrHubProviderWithdrawalRemarkRequired) {
			common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalRemarkRequired)
			return
		}
		if errors.Is(err, model.ErrHubProviderWithdrawalPaymentInvalid) {
			common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalPaymentInvalid)
			return
		}
		common.ApiError(c, err)
		return
	}
	auditAction := "hub_provider.withdrawal_approve"
	switch req.Status {
	case model.HubProviderWithdrawalStatusPaid:
		auditAction = "hub_provider.withdrawal_paid"
	case model.HubProviderWithdrawalStatusRejected:
		auditAction = "hub_provider.withdrawal_reject"
	}
	recordManageAuditFor(c, withdrawal.OwnerUserId, auditAction, map[string]interface{}{
		"withdrawal_id":       withdrawal.Id,
		"provider_id":         withdrawal.ProviderId,
		"payout_currency":     withdrawal.PayoutCurrency,
		"payout_amount_minor": withdrawal.PayoutAmountMinor,
	})
	common.ApiSuccess(c, withdrawal)
}

func currentHubProviderOrError(c *gin.Context) (*model.HubProvider, bool) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return nil, false
	}
	if provider == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderRequired)
		return nil, false
	}
	return provider, true
}
