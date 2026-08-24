/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
package controller

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type hubTenantBalanceTransferRequest struct {
	AmountQuota    int    `json:"amount_quota"`
	IdempotencyKey string `json:"idempotency_key"`
}

func hubTenantFinanceID(c *gin.Context) (int, bool) {
	tenantID := common.GetContextKeyInt(c, constant.ContextKeyTenantId)
	if tenantID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgAuthInsufficientPrivilege)
		return 0, false
	}
	return tenantID, true
}

func hubTenantFinanceOwnerID(c *gin.Context, tenantID int) (int, bool) {
	if isPlatformAdmin(c) {
		member, err := model.GetTenantOwnerMember(tenantID)
		if err != nil {
			common.ApiError(c, err)
			return 0, false
		}
		return member.UserId, true
	}
	member, err := model.GetActiveTenantMember(tenantID, c.GetInt("id"))
	if err != nil || member.Role != model.TenantMemberRoleOwner {
		common.ApiErrorI18n(c, i18n.MsgAuthInsufficientPrivilege)
		return 0, false
	}
	return member.UserId, true
}

func requireHubTenantWithdrawalScope(c *gin.Context, tenantID int) bool {
	if isPlatformAdmin(c) {
		return true
	}
	currentTenantID := common.GetContextKeyInt(c, constant.ContextKeyTenantId)
	if currentTenantID != tenantID {
		common.ApiErrorI18n(c, i18n.MsgNotFound)
		return false
	}
	return true
}

func GetHubTenantEarningSummary(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	summary, err := model.GetHubTenantSettlementSummary(tenantID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

func AdminListHubTenantSettlementSummaries(c *gin.Context) {
	items, err := model.AdminListHubTenantSettlementSummaries()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": items})
}

func GetHubTenantEarnings(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListHubTenantEarnings(tenantID, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func CreateHubTenantBalanceTransfer(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	ownerUserID, ok := hubTenantFinanceOwnerID(c, tenantID)
	if !ok {
		return
	}
	var request hubTenantBalanceTransferRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	if request.AmountQuota <= 0 || request.IdempotencyKey == "" || len(request.IdempotencyKey) > 48 {
		common.ApiErrorI18n(c, i18n.MsgHubProviderBalanceTransferInvalid)
		return
	}
	transfer, err := model.CreateHubTenantBalanceTransfer(tenantID, ownerUserID, request.AmountQuota, request.IdempotencyKey)
	if err != nil {
		if errors.Is(err, model.ErrHubTenantBalanceTransferInsufficient) {
			common.ApiErrorI18n(c, i18n.MsgHubProviderBalanceTransferInsufficient)
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, transfer)
}

type hubTenantPayoutAccountRequest struct {
	Method        string                                `json:"method"`
	Details       model.HubProviderPayoutAccountDetails `json:"details"`
	QRCodeAssetId int                                   `json:"qr_code_asset_id"`
	IsDefault     bool                                  `json:"is_default"`
}

func (request hubTenantPayoutAccountRequest) input() model.HubProviderPayoutAccountInput {
	return model.HubProviderPayoutAccountInput{
		Method:        request.Method,
		Details:       request.Details,
		QRCodeAssetId: request.QRCodeAssetId,
		IsDefault:     request.IsDefault,
	}
}

func GetHubTenantPayoutAccounts(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	accounts, err := model.ListHubTenantPayoutAccounts(tenantID)
	if err != nil {
		payoutAccountError(c, err)
		return
	}
	common.ApiSuccess(c, accounts)
}

func CreateHubTenantPayoutAccount(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	ownerUserID, ok := hubTenantFinanceOwnerID(c, tenantID)
	if !ok {
		return
	}
	var request hubTenantPayoutAccountRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	account, err := model.CreateHubTenantPayoutAccount(tenantID, ownerUserID, request.input())
	if err != nil {
		payoutAccountError(c, err)
		return
	}
	common.ApiSuccess(c, account)
}

func UpdateHubTenantPayoutAccount(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	ownerUserID, ok := hubTenantFinanceOwnerID(c, tenantID)
	if !ok {
		return
	}
	accountID, err := strconv.Atoi(c.Param("account_id"))
	if err != nil || accountID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	var request hubTenantPayoutAccountRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	account, err := model.UpdateHubTenantPayoutAccount(tenantID, ownerUserID, accountID, request.input())
	if err != nil {
		payoutAccountError(c, err)
		return
	}
	common.ApiSuccess(c, account)
}

func DeleteHubTenantPayoutAccount(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	ownerUserID, ok := hubTenantFinanceOwnerID(c, tenantID)
	if !ok {
		return
	}
	accountID, err := strconv.Atoi(c.Param("account_id"))
	if err != nil || accountID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.DeleteHubTenantPayoutAccount(tenantID, ownerUserID, accountID); err != nil {
		payoutAccountError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func UploadHubTenantPayoutQRCode(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	ownerUserID, ok := hubTenantFinanceOwnerID(c, tenantID)
	if !ok {
		return
	}
	if c.Request.ContentLength > hubProviderPayoutQRCodeMaxBytes+256*1024 {
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutQRCodeInvalid)
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutQRCodeInvalid)
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutQRCodeInvalid)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, hubProviderPayoutQRCodeMaxBytes+1))
	if err != nil || len(data) == 0 || len(data) > hubProviderPayoutQRCodeMaxBytes {
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutQRCodeInvalid)
		return
	}
	contentType := strings.ToLower(http.DetectContentType(data))
	if _, ok := hubProviderPayoutQRCodeContentTypes[contentType]; !ok {
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutQRCodeInvalid)
		return
	}
	asset, err := model.CreateHubTenantPayoutAsset(tenantID, ownerUserID, contentType, data)
	if err != nil {
		payoutAccountError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": asset.Id, "content_type": asset.ContentType})
}

func GetHubTenantPayoutAsset(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	assetID, err := strconv.Atoi(c.Param("asset_id"))
	if err != nil || assetID <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	asset, err := model.GetHubTenantPayoutAsset(assetID, tenantID)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, asset.ContentType, asset.Data)
}

func AdminGetHubTenantPayoutAsset(c *gin.Context) {
	assetID, err := strconv.Atoi(c.Param("asset_id"))
	if err != nil || assetID <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	var tenantID *int
	if !isPlatformAdmin(c) {
		id := common.GetContextKeyInt(c, constant.ContextKeyTenantId)
		if id <= 0 {
			c.Status(http.StatusNotFound)
			return
		}
		tenantID = &id
	}
	asset, err := model.GetHubTenantPayoutAssetForAdmin(assetID, tenantID)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, asset.ContentType, asset.Data)
}

func GetHubTenantWithdrawals(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListHubTenantWithdrawals(tenantID, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func CreateHubTenantWithdrawal(c *gin.Context) {
	tenantID, ok := hubTenantFinanceID(c)
	if !ok {
		return
	}
	ownerUserID, ok := hubTenantFinanceOwnerID(c, tenantID)
	if !ok {
		return
	}
	var request hubProviderWithdrawalCreateRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if request.AmountQuota <= 0 || request.PayoutAccountId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalInvalid)
		return
	}
	withdrawal, err := model.CreateHubTenantWithdrawal(tenantID, ownerUserID, request.AmountQuota, request.PayoutAccountId)
	if err != nil {
		tenantWithdrawalError(c, err)
		return
	}
	common.ApiSuccess(c, withdrawal)
}

func tenantWithdrawalError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrHubTenantWithdrawalPending):
		common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalPending)
	case errors.Is(err, model.ErrHubTenantWithdrawalBelowMinimum):
		common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalBelowMinimum)
	case errors.Is(err, model.ErrHubTenantWithdrawalInsufficient),
		errors.Is(err, model.ErrHubTenantBalanceTransferInsufficient):
		common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalInsufficient)
	case errors.Is(err, model.ErrHubTenantWithdrawalPaymentInvalid):
		common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalPaymentInvalid)
	case errors.Is(err, model.ErrHubTenantWithdrawalRemarkRequired):
		common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalRemarkRequired)
	case errors.Is(err, model.ErrHubTenantWithdrawalTransition):
		common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalTransition)
	case errors.Is(err, model.ErrHubProviderPayoutAccountNotFound),
		errors.Is(err, model.ErrHubProviderPayoutAccountInvalid),
		errors.Is(err, model.ErrHubProviderPayoutAssetInvalid):
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutAccountInvalid)
	default:
		common.ApiError(c, err)
	}
}

func AdminGetHubTenantWithdrawals(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	status := strings.TrimSpace(c.Query("status"))
	var items []model.HubTenantWithdrawalAdminItem
	var total int64
	var err error
	if isPlatformAdmin(c) {
		items, total, err = model.AdminListHubTenantWithdrawals(status, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	} else {
		tenantID, ok := hubTenantFinanceID(c)
		if !ok {
			return
		}
		items, total, err = model.AdminListHubTenantWithdrawalsInTenant(status, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), tenantID)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func AdminUpdateHubTenantWithdrawalStatus(c *gin.Context) {
	withdrawalID, err := strconv.Atoi(c.Param("withdrawal_id"))
	if err != nil || withdrawalID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	withdrawal, err := model.GetHubTenantWithdrawalByID(withdrawalID)
	if err != nil {
		tenantWithdrawalError(c, err)
		return
	}
	if !requireHubTenantWithdrawalScope(c, withdrawal.TenantId) {
		return
	}
	var request hubProviderWithdrawalStatusRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	request.Status = strings.TrimSpace(request.Status)
	request.AdminRemark = strings.TrimSpace(request.AdminRemark)
	request.PayoutCurrency = strings.TrimSpace(request.PayoutCurrency)
	request.ExchangeRate = strings.TrimSpace(request.ExchangeRate)
	if !model.IsValidHubTenantWithdrawalStatus(request.Status) || request.Status == model.HubTenantWithdrawalStatusPending || utf8.RuneCountInString(request.AdminRemark) > hubProviderSettlementRemarkMaxLength {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if (request.Status == model.HubTenantWithdrawalStatusPaid || request.Status == model.HubTenantWithdrawalStatusRejected) && request.AdminRemark == "" {
		common.ApiErrorI18n(c, i18n.MsgHubProviderWithdrawalRemarkRequired)
		return
	}
	var payment *model.HubProviderWithdrawalPayment
	if request.Status == model.HubTenantWithdrawalStatusPaid {
		payment = &model.HubProviderWithdrawalPayment{Currency: request.PayoutCurrency, AmountMinor: request.PayoutAmountMinor, ExchangeRate: request.ExchangeRate}
	}
	withdrawal, err = model.UpdateHubTenantWithdrawalStatus(withdrawalID, request.Status, c.GetInt("id"), request.AdminRemark, payment)
	if err != nil {
		tenantWithdrawalError(c, err)
		return
	}
	auditAction := "hub_tenant.withdrawal_approve"
	if request.Status == model.HubTenantWithdrawalStatusPaid {
		auditAction = "hub_tenant.withdrawal_paid"
	} else if request.Status == model.HubTenantWithdrawalStatusRejected {
		auditAction = "hub_tenant.withdrawal_reject"
	}
	recordManageAuditFor(c, withdrawal.OwnerUserId, auditAction, map[string]interface{}{
		"withdrawal_id":       withdrawal.Id,
		"tenant_id":           withdrawal.TenantId,
		"payout_currency":     withdrawal.PayoutCurrency,
		"payout_amount_minor": withdrawal.PayoutAmountMinor,
	})
	common.ApiSuccess(c, withdrawal)
}
