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

For commercial licensing, please contact support@quantumnous.com
*/
package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHubWeeklyDigestUsesSettlementLedgerAndMergesOwnerRoles(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(
		&Tenant{}, &TenantDomain{}, &TenantMember{}, &User{}, &HubProvider{},
		&Channel{}, &HubSupplyGroup{}, &HubProviderEarning{}, &HubWeeklyDigestDelivery{},
	))
	weekStart := int64(1_800_000_000)
	weekEnd := weekStart + 7*24*60*60
	tenant := Tenant{Name: "Digest tenant", Slug: "digest-tenant", Status: TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	require.NoError(t, db.Create(&TenantDomain{
		TenantId: tenant.Id, Host: "digest.example.com", IsPrimary: true,
		VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive,
	}).Error)
	owner := User{
		Id: 91001, Username: "digest-owner", Password: "unused", Email: "owner@example.com",
		AffCode: "digest-owner", Status: common.UserStatusEnabled,
	}
	consumer := User{
		Id: 91002, Username: "digest-consumer", Password: "unused", Email: "consumer@example.com",
		AffCode: "digest-consumer", Status: common.UserStatusEnabled, RegistrationTenantId: tenant.Id,
		CreatedAt: weekStart + 10,
	}
	require.NoError(t, db.Create(&owner).Error)
	require.NoError(t, db.Create(&consumer).Error)
	require.NoError(t, db.Model(&consumer).Update("created_at", weekStart+10).Error)
	require.NoError(t, db.Create(&TenantMember{
		TenantId: tenant.Id, UserId: owner.Id, Role: TenantMemberRoleOwner, Status: TenantMemberStatusActive,
	}).Error)
	provider := HubProvider{
		OwnerUserId: owner.Id, TenantId: &tenant.Id, Name: "Digest provider", Slug: "digest-provider",
		Status: HubProviderStatusActive,
	}
	require.NoError(t, db.Create(&provider).Error)

	channelStatuses := []int{common.ChannelStatusEnabled, common.ChannelStatusManuallyDisabled}
	for index, status := range channelStatuses {
		channel := Channel{Name: fmt.Sprintf("digest-channel-%d", index), Status: status, Models: "gpt-5"}
		require.NoError(t, db.Create(&channel).Error)
		require.NoError(t, db.Create(&HubSupplyGroup{
			PublicId: fmt.Sprintf("digest-group-%d", index), ProviderId: provider.Id, NewAPIChannelId: channel.Id,
			PriceMultiplier: 0.5, TenantPublished: true, Status: HubSupplyGroupStatusAvailable,
		}).Error)
	}

	earnings := []HubProviderEarning{
		{
			RequestId: "digest-1", EntryType: HubProviderEarningTypeUsage, Status: HubProviderEarningStatusSettled,
			ProviderId: provider.Id, TenantId: tenant.Id, OwnerUserId: owner.Id, ConsumerUserId: consumer.Id,
			ModelName: "gpt-5", GrossQuota: 100, ProviderIncomeQuota: 70, ResellerNetIncomeQuota: 20, SettlementVersion: 2,
		},
		{
			RequestId: "digest-2", EntryType: HubProviderEarningTypeUsage, Status: HubProviderEarningStatusPending,
			ProviderId: provider.Id, TenantId: tenant.Id, OwnerUserId: owner.Id, ConsumerUserId: consumer.Id,
			ModelName: "claude", GrossQuota: 200, ProviderIncomeQuota: 130, ResellerNetIncomeQuota: 50, SettlementVersion: 2,
		},
		{
			RequestId: "digest-3", EntryType: HubProviderEarningTypeUsage, Status: HubProviderEarningStatusSettled,
			ProviderId: provider.Id + 100, ReferralProviderId: provider.Id, TenantId: tenant.Id,
			OwnerUserId: owner.Id + 100, ConsumerUserId: consumer.Id, ModelName: "grok",
			GrossQuota: 300, ProviderIncomeQuota: 200, ReferralIncomeQuota: 10,
			ResellerNetIncomeQuota: 40, SettlementVersion: 2, RoutingFallback: true,
		},
	}
	for index := range earnings {
		require.NoError(t, db.Create(&earnings[index]).Error)
		require.NoError(t, db.Model(&earnings[index]).Update("created_at", weekStart+int64(index)+100).Error)
	}

	recipients, err := ListHubWeeklyDigestRecipients()
	require.NoError(t, err)
	require.Len(t, recipients, 1)
	assert.Equal(t, owner.Id, recipients[0].UserId)
	assert.Equal(t, tenant.Id, recipients[0].TenantId)
	assert.Equal(t, provider.Id, recipients[0].ProviderId)
	assert.Equal(t, "digest.example.com", recipients[0].TenantHost)

	tenantSummary, err := GetHubWeeklyDigestTenantSummary(tenant.Id, weekStart, weekEnd)
	require.NoError(t, err)
	assert.Equal(t, 600, tenantSummary.ConsumptionQuota)
	assert.Equal(t, 60, tenantSummary.NetIncomeQuota)
	assert.Equal(t, int64(3), tenantSummary.SuccessCalls)
	assert.Equal(t, int64(1), tenantSummary.ActiveUsers)
	assert.Equal(t, int64(1), tenantSummary.NewUsers)
	assert.Equal(t, int64(1), tenantSummary.FallbackCalls)
	require.Len(t, tenantSummary.TopModels, 3)
	assert.Equal(t, "grok", tenantSummary.TopModels[0].ModelName)

	providerSummary, err := GetHubWeeklyDigestProviderSummary(provider.Id, weekStart, weekEnd)
	require.NoError(t, err)
	assert.Equal(t, 80, providerSummary.SettledIncomeQuota)
	assert.Equal(t, 130, providerSummary.PendingIncomeQuota)
	assert.Equal(t, int64(2), providerSummary.SuccessCalls)
	assert.Equal(t, int64(2), providerSummary.TotalChannels)
	assert.Equal(t, int64(1), providerSummary.AbnormalChannels)

	first, err := EnsureHubWeeklyDigestDelivery(weekStart, weekEnd, recipients[0], owner.Email)
	require.NoError(t, err)
	second, err := EnsureHubWeeklyDigestDelivery(weekStart, weekEnd, recipients[0], owner.Email)
	require.NoError(t, err)
	assert.Equal(t, first.Id, second.Id)
	var deliveryCount int64
	require.NoError(t, db.Model(&HubWeeklyDigestDelivery{}).Count(&deliveryCount).Error)
	assert.Equal(t, int64(1), deliveryCount)
}
