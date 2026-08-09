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
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupHubProviderPayoutControllerTestDB(t *testing.T) {
	t.Helper()
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.HubProvider{},
		&model.HubProviderPayoutAsset{},
		&model.HubProviderPayoutAccount{},
		&model.HubProviderEarning{},
		&model.HubProviderWithdrawal{},
	))
}

func createControllerPayoutAccount(t *testing.T, ownerUserID int) *model.HubProviderPayoutAccount {
	t.Helper()
	account, err := model.CreateHubProviderPayoutAccount(ownerUserID, model.HubProviderPayoutAccountInput{
		Method: model.HubProviderPayoutMethodAlipay,
		Details: model.HubProviderPayoutAccountDetails{
			RecipientName: "Alice",
			Account:       "alice@example.com",
		},
	})
	require.NoError(t, err)
	return account
}

func decodePayoutControllerResponse(t *testing.T, recorder *httptest.ResponseRecorder) struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
} {
	t.Helper()
	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func TestUpdateHubProviderPayoutAccountRejectsForeignOwner(t *testing.T) {
	setupHubProviderPayoutControllerTestDB(t)
	seedHubProvider(t, 42)
	seedHubProvider(t, 43)
	account := createControllerPayoutAccount(t, 42)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/provider/payout-accounts/1", map[string]any{
		"method": model.HubProviderPayoutMethodAlipay,
		"details": map[string]any{
			"recipient_name": "Mallory",
			"account":        "mallory@example.com",
		},
		"is_default": true,
	}, 43)
	ctx.Params = gin.Params{{Key: "account_id", Value: strconv.Itoa(account.Id)}}
	UpdateHubProviderPayoutAccount(ctx)

	response := decodePayoutControllerResponse(t, recorder)
	assert.False(t, response.Success)
	items, err := model.ListHubProviderPayoutAccounts(42)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, "alice@example.com", items[0].Details.Account)
}

func TestUploadHubProviderPayoutQRCodeRejectsInvalidFiles(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		data     []byte
	}{
		{name: "unsupported content", filename: "code.txt", data: []byte("not an image")},
		{name: "too large", filename: "code.png", data: bytes.Repeat([]byte{0}, hubProviderPayoutQRCodeMaxBytes+1)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupHubProviderPayoutControllerTestDB(t)
			seedHubProvider(t, 42)
			var requestBody bytes.Buffer
			writer := multipart.NewWriter(&requestBody)
			part, err := writer.CreateFormFile("file", test.filename)
			require.NoError(t, err)
			_, err = part.Write(test.data)
			require.NoError(t, err)
			require.NoError(t, writer.Close())

			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/api/hub/provider/payout-assets", &requestBody)
			ctx.Request.Header.Set("Content-Type", writer.FormDataContentType())
			ctx.Set("id", 42)
			UploadHubProviderPayoutQRCode(ctx)

			response := decodePayoutControllerResponse(t, recorder)
			assert.False(t, response.Success)
			var count int64
			require.NoError(t, model.DB.Model(&model.HubProviderPayoutAsset{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestCreateHubProviderWithdrawalRejectsForeignPayoutAccount(t *testing.T) {
	setupHubProviderPayoutControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	seedHubProvider(t, 43)
	foreignAccount := createControllerPayoutAccount(t, 43)
	_, err := model.CreateHubProviderManualAdjustment(provider.Id, 500, 1, "initial credit")
	require.NoError(t, err)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/hub/provider/withdrawals", map[string]any{
		"amount_quota":      100,
		"payout_account_id": foreignAccount.Id,
	}, 42)
	CreateHubProviderWithdrawal(ctx)

	response := decodePayoutControllerResponse(t, recorder)
	assert.False(t, response.Success)
	var count int64
	require.NoError(t, model.DB.Model(&model.HubProviderWithdrawal{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestAdminPaidWithdrawalRequiresPaymentDetails(t *testing.T) {
	setupHubProviderPayoutControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	account := createControllerPayoutAccount(t, 42)
	_, err := model.CreateHubProviderManualAdjustment(provider.Id, 500, 1, "initial credit")
	require.NoError(t, err)
	withdrawal, err := model.CreateHubProviderWithdrawal(42, 100, account.Id)
	require.NoError(t, err)
	_, err = model.UpdateHubProviderWithdrawalStatus(
		withdrawal.Id,
		model.HubProviderWithdrawalStatusApproved,
		1,
		"approved",
		nil,
	)
	require.NoError(t, err)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/withdrawals/1/status", map[string]any{
		"status":       model.HubProviderWithdrawalStatusPaid,
		"admin_remark": "transfer complete",
	}, 1)
	ctx.Params = gin.Params{{Key: "withdrawal_id", Value: strconv.Itoa(withdrawal.Id)}}
	AdminUpdateHubProviderWithdrawalStatus(ctx)

	response := decodePayoutControllerResponse(t, recorder)
	assert.False(t, response.Success)
	items, _, err := model.ListHubProviderWithdrawals(provider.Id, 0, 10)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, model.HubProviderWithdrawalStatusApproved, items[0].Status)
	assert.Empty(t, items[0].PayoutCurrency)
}

func TestAdminCanPayPendingWithdrawalDirectly(t *testing.T) {
	setupHubProviderPayoutControllerTestDB(t)
	provider := seedHubProvider(t, 42)
	account := createControllerPayoutAccount(t, 42)
	_, err := model.CreateHubProviderManualAdjustment(provider.Id, 500, 1, "initial credit")
	require.NoError(t, err)
	withdrawal, err := model.CreateHubProviderWithdrawal(42, 100, account.Id)
	require.NoError(t, err)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/withdrawals/1/status", map[string]any{
		"status":              model.HubProviderWithdrawalStatusPaid,
		"admin_remark":        "transfer complete",
		"payout_currency":     "CNY",
		"payout_amount_minor": 146,
		"exchange_rate":       "7.3",
	}, 1)
	ctx.Params = gin.Params{{Key: "withdrawal_id", Value: strconv.Itoa(withdrawal.Id)}}
	AdminUpdateHubProviderWithdrawalStatus(ctx)

	response := decodePayoutControllerResponse(t, recorder)
	assert.True(t, response.Success)
	items, _, err := model.ListHubProviderWithdrawals(provider.Id, 0, 10)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, model.HubProviderWithdrawalStatusPaid, items[0].Status)
	assert.NotZero(t, items[0].ReviewedAt)
	assert.Equal(t, items[0].ReviewedAt, items[0].PaidAt)
	assert.Equal(t, "CNY", items[0].PayoutCurrency)
	assert.Equal(t, int64(146), items[0].PayoutAmountMinor)
}
