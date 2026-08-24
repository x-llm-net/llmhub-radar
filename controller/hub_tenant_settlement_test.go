/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
package controller

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupHubTenantSettlementControllerTestDB(t *testing.T) (*model.Tenant, *model.User, *model.User) {
	t.Helper()
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(
		&model.Tenant{}, &model.TenantMember{}, &model.User{}, &model.HubProviderEarning{},
		&model.HubTenantPayoutAsset{}, &model.HubTenantPayoutAccount{}, &model.HubTenantWithdrawal{},
	))
	tenant := &model.Tenant{Name: "Finance controller tenant", Slug: "finance-controller-tenant", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(tenant).Error)
	owner := &model.User{Id: 92101, Username: "finance-controller-owner", Password: "unused", Status: common.UserStatusEnabled, AffCode: "finance-controller-owner", Quota: 10}
	admin := &model.User{Id: 92102, Username: "finance-controller-admin", Password: "unused", Status: common.UserStatusEnabled, AffCode: "finance-controller-admin", Quota: 10}
	require.NoError(t, model.DB.Create(owner).Error)
	require.NoError(t, model.DB.Create(admin).Error)
	require.NoError(t, model.DB.Create(&model.TenantMember{TenantId: tenant.Id, UserId: owner.Id, Role: model.TenantMemberRoleOwner, Status: model.TenantMemberStatusActive}).Error)
	require.NoError(t, model.DB.Create(&model.TenantMember{TenantId: tenant.Id, UserId: admin.Id, Role: model.TenantMemberRoleAdmin, Status: model.TenantMemberStatusActive}).Error)
	require.NoError(t, model.DB.Create(&model.HubProviderEarning{
		RequestId: "tenant-controller-earning", EntryType: model.HubProviderEarningTypeUsage,
		Status: model.HubProviderEarningStatusSettled, ProviderId: 9101, TenantId: tenant.Id,
		OwnerUserId: owner.Id, ConsumerUserId: 9102, SupplyGroupId: 9103, ChannelId: 9104,
		GrossQuota: 100, ResellerGrossQuota: 100, ResellerNetIncomeQuota: 100, SettlementVersion: 2,
	}).Error)
	return tenant, owner, admin
}

func TestHubTenantFinanceControllerSeparatesReadAndOperatePermissions(t *testing.T) {
	tenant, owner, admin := setupHubTenantSettlementControllerTestDB(t)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/hub/tenant/earnings/summary", nil, admin.Id)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	GetHubTenantEarningSummary(ctx)
	var summaryResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &summaryResponse))
	assert.True(t, summaryResponse.Success, recorder.Body.String())

	ctx, recorder = newAuthenticatedContext(t, http.MethodPost, "/api/hub/tenant/earnings/balance-transfer", map[string]any{
		"amount_quota": 10, "idempotency_key": "admin-must-not-transfer",
	}, admin.Id)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	CreateHubTenantBalanceTransfer(ctx)
	var deniedResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &deniedResponse))
	assert.False(t, deniedResponse.Success, recorder.Body.String())

	ctx, recorder = newAuthenticatedContext(t, http.MethodPost, "/api/hub/tenant/earnings/balance-transfer", map[string]any{
		"amount_quota": 10, "idempotency_key": "owner-can-transfer",
	}, owner.Id)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)
	CreateHubTenantBalanceTransfer(ctx)
	var transferResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &transferResponse))
	assert.True(t, transferResponse.Success, recorder.Body.String())

	var updatedOwner model.User
	require.NoError(t, model.DB.First(&updatedOwner, owner.Id).Error)
	assert.Equal(t, 20, updatedOwner.Quota)
}

func TestAdminUpdateHubTenantWithdrawalStatusRequiresPlatformAdmin(t *testing.T) {
	tenant, owner, admin := setupHubTenantSettlementControllerTestDB(t)
	withdrawal := &model.HubTenantWithdrawal{
		TenantId:              tenant.Id,
		OwnerUserId:           owner.Id,
		AmountQuota:           50,
		Status:                model.HubTenantWithdrawalStatusApproved,
		PayoutMethod:          model.HubProviderPayoutMethodAlipay,
		PayoutAccountSnapshot: "{}",
	}
	require.NoError(t, model.DB.Create(withdrawal).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/providers/tenant-withdrawals/1/status", map[string]any{
		"status":       model.HubTenantWithdrawalStatusRejected,
		"admin_remark": "must be rejected by the platform",
	}, admin.Id)
	ctx.Params = append(ctx.Params, gin.Param{Key: "withdrawal_id", Value: strconv.Itoa(withdrawal.Id)})
	ctx.Set("role", common.RoleCommonUser)
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenant.Id)

	AdminUpdateHubTenantWithdrawalStatus(ctx)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success, recorder.Body.String())
	require.NoError(t, model.DB.First(withdrawal, withdrawal.Id).Error)
	assert.Equal(t, model.HubTenantWithdrawalStatusApproved, withdrawal.Status)
}
