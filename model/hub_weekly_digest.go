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
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	HubWeeklyDigestDeliveryStatusPending = "pending"
	HubWeeklyDigestDeliveryStatusSending = "sending"
	HubWeeklyDigestDeliveryStatusSent    = "sent"
	HubWeeklyDigestDeliveryStatusSkipped = "skipped"
	HubWeeklyDigestDeliveryStatusFailed  = "failed"
)

type HubWeeklyDigestDelivery struct {
	Id              int    `json:"id" gorm:"primaryKey"`
	WeekStart       int64  `json:"week_start" gorm:"bigint;not null;uniqueIndex:idx_hub_weekly_digest_week_recipient,priority:1"`
	WeekEnd         int64  `json:"week_end" gorm:"bigint;not null"`
	RecipientUserId int    `json:"recipient_user_id" gorm:"not null;uniqueIndex:idx_hub_weekly_digest_week_recipient,priority:2;index"`
	TenantId        int    `json:"tenant_id" gorm:"not null;default:0;index"`
	ProviderId      int    `json:"provider_id" gorm:"not null;default:0;index"`
	RecipientEmail  string `json:"recipient_email" gorm:"type:varchar(255);not null;default:''"`
	Status          string `json:"status" gorm:"type:varchar(24);not null;index"`
	Attempts        int    `json:"attempts" gorm:"not null;default:0"`
	Error           string `json:"error" gorm:"type:text;not null"`
	SentAt          int64  `json:"sent_at" gorm:"bigint;not null;default:0"`
	CreatedAt       int64  `json:"created_at" gorm:"bigint;not null"`
	UpdatedAt       int64  `json:"updated_at" gorm:"bigint;not null"`
}

func (HubWeeklyDigestDelivery) TableName() string {
	return "hub_weekly_digest_deliveries"
}

func (delivery *HubWeeklyDigestDelivery) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	if delivery.Status == "" {
		delivery.Status = HubWeeklyDigestDeliveryStatusPending
	}
	if delivery.CreatedAt == 0 {
		delivery.CreatedAt = now
	}
	delivery.UpdatedAt = now
	return nil
}

type HubWeeklyDigestRecipient struct {
	UserId           int
	Email            string
	Setting          string
	TenantId         int
	TenantName       string
	TenantHost       string
	ProviderId       int
	ProviderName     string
	ProviderTenantId int
}

type HubWeeklyDigestTopModel struct {
	ModelName string `gorm:"column:model_name"`
	CallCount int64  `gorm:"column:call_count"`
	Quota     int    `gorm:"column:quota"`
}

type HubWeeklyDigestTenantSummary struct {
	ConsumptionQuota int
	NetIncomeQuota   int
	ActiveUsers      int64
	NewUsers         int64
	SuccessCalls     int64
	FallbackCalls    int64
	TopModels        []HubWeeklyDigestTopModel
}

type HubWeeklyDigestProviderSummary struct {
	SettledIncomeQuota int
	PendingIncomeQuota int
	SuccessCalls       int64
	TotalChannels      int64
	AbnormalChannels   int64
	TopModels          []HubWeeklyDigestTopModel
}

func ListHubWeeklyDigestRecipients() ([]HubWeeklyDigestRecipient, error) {
	type tenantOwner struct {
		UserId     int    `gorm:"column:user_id"`
		Email      string `gorm:"column:email"`
		Setting    string `gorm:"column:setting"`
		TenantId   int    `gorm:"column:tenant_id"`
		TenantName string `gorm:"column:tenant_name"`
	}
	tenantOwners := make([]tenantOwner, 0)
	if err := DB.Table("tenant_members AS members").
		Select("members.user_id, COALESCE(users.email, '') AS email, COALESCE(users.setting, '') AS setting, tenants.id AS tenant_id, tenants.name AS tenant_name").
		Joins("JOIN tenants ON tenants.id = members.tenant_id").
		Joins("JOIN users ON users.id = members.user_id").
		Where("members.role = ? AND members.status = ? AND tenants.status = ?", TenantMemberRoleOwner, TenantMemberStatusActive, TenantStatusActive).
		Where("users.status = ? AND users.deleted_at IS NULL", common.UserStatusEnabled).
		Order("members.user_id ASC, tenants.id ASC").
		Scan(&tenantOwners).Error; err != nil {
		return nil, err
	}

	type providerOwner struct {
		UserId     int    `gorm:"column:user_id"`
		Email      string `gorm:"column:email"`
		Setting    string `gorm:"column:setting"`
		ProviderId int    `gorm:"column:provider_id"`
		Name       string `gorm:"column:provider_name"`
		TenantId   int    `gorm:"column:tenant_id"`
	}
	providerOwners := make([]providerOwner, 0)
	activeTenantIDs := DB.Model(&Tenant{}).Select("id").Where("status = ?", TenantStatusActive)
	if err := DB.Table("hub_providers AS providers").
		Select("providers.owner_user_id AS user_id, COALESCE(users.email, '') AS email, COALESCE(users.setting, '') AS setting, providers.id AS provider_id, providers.name AS provider_name, COALESCE(providers.tenant_id, 0) AS tenant_id").
		Joins("JOIN users ON users.id = providers.owner_user_id").
		Where("providers.status = ?", HubProviderStatusActive).
		Where("providers.tenant_id IS NULL OR providers.tenant_id IN (?)", activeTenantIDs).
		Where("users.status = ? AND users.deleted_at IS NULL", common.UserStatusEnabled).
		Order("providers.owner_user_id ASC, providers.id ASC").
		Scan(&providerOwners).Error; err != nil {
		return nil, err
	}

	recipientsByUser := make(map[int]*HubWeeklyDigestRecipient, len(tenantOwners)+len(providerOwners))
	orderedUserIDs := make([]int, 0, len(tenantOwners)+len(providerOwners))
	ensureRecipient := func(userID int, email string, setting string) *HubWeeklyDigestRecipient {
		if recipient := recipientsByUser[userID]; recipient != nil {
			return recipient
		}
		recipient := &HubWeeklyDigestRecipient{UserId: userID, Email: email, Setting: setting}
		recipientsByUser[userID] = recipient
		orderedUserIDs = append(orderedUserIDs, userID)
		return recipient
	}
	for _, owner := range tenantOwners {
		recipient := ensureRecipient(owner.UserId, owner.Email, owner.Setting)
		if recipient.TenantId == 0 {
			recipient.TenantId = owner.TenantId
			recipient.TenantName = owner.TenantName
		}
	}
	for _, owner := range providerOwners {
		recipient := ensureRecipient(owner.UserId, owner.Email, owner.Setting)
		if recipient.ProviderId == 0 {
			recipient.ProviderId = owner.ProviderId
			recipient.ProviderName = owner.Name
			recipient.ProviderTenantId = owner.TenantId
		}
	}

	tenantIDs := make([]int, 0, len(recipientsByUser)*2)
	for _, recipient := range recipientsByUser {
		if recipient.TenantId > 0 {
			tenantIDs = append(tenantIDs, recipient.TenantId)
		}
		if recipient.ProviderTenantId > 0 {
			tenantIDs = append(tenantIDs, recipient.ProviderTenantId)
		}
	}
	hosts, err := loadPrimaryTenantDomainHosts(tenantIDs)
	if err != nil {
		return nil, err
	}

	recipients := make([]HubWeeklyDigestRecipient, 0, len(orderedUserIDs))
	for _, userID := range orderedUserIDs {
		recipient := recipientsByUser[userID]
		tenantID := recipient.TenantId
		if tenantID == 0 {
			tenantID = recipient.ProviderTenantId
		}
		recipient.TenantHost = hosts[tenantID]
		recipients = append(recipients, *recipient)
	}
	return recipients, nil
}

func GetHubWeeklyDigestTenantSummary(tenantID int, weekStart, weekEnd int64) (HubWeeklyDigestTenantSummary, error) {
	summary := HubWeeklyDigestTenantSummary{TopModels: make([]HubWeeklyDigestTopModel, 0)}
	if tenantID <= 0 || weekStart <= 0 || weekEnd <= weekStart {
		return summary, errors.New("invalid tenant weekly digest window")
	}

	type usageSummary struct {
		ConsumptionQuota int   `gorm:"column:consumption_quota"`
		ActiveUsers      int64 `gorm:"column:active_users"`
		SuccessCalls     int64 `gorm:"column:success_calls"`
		FallbackCalls    int64 `gorm:"column:fallback_calls"`
	}
	var usage usageSummary
	baseUsage := DB.Table("hub_provider_earnings AS earnings").
		Joins("JOIN users ON users.id = earnings.consumer_user_id").
		Where("users.registration_tenant_id = ?", tenantID).
		Where("earnings.entry_type = ? AND earnings.status IN ?", HubProviderEarningTypeUsage, []string{HubProviderEarningStatusPending, HubProviderEarningStatusSettled}).
		Where("earnings.created_at >= ? AND earnings.created_at < ?", weekStart, weekEnd)
	if err := baseUsage.Select(
		"COALESCE(SUM(earnings.gross_quota), 0) AS consumption_quota, "+
			"COUNT(DISTINCT earnings.consumer_user_id) AS active_users, "+
			"COUNT(*) AS success_calls, "+
			"COALESCE(SUM(CASE WHEN earnings.routing_fallback = ? THEN 1 ELSE 0 END), 0) AS fallback_calls",
		commonTrueVal,
	).Scan(&usage).Error; err != nil {
		return summary, err
	}
	summary.ConsumptionQuota = usage.ConsumptionQuota
	summary.ActiveUsers = usage.ActiveUsers
	summary.SuccessCalls = usage.SuccessCalls
	summary.FallbackCalls = usage.FallbackCalls

	if err := DB.Model(&User{}).
		Where("registration_tenant_id = ? AND created_at >= ? AND created_at < ?", tenantID, weekStart, weekEnd).
		Count(&summary.NewUsers).Error; err != nil {
		return summary, err
	}
	if err := DB.Model(&HubProviderEarning{}).
		Select("COALESCE(SUM(reseller_net_income_quota), 0)").
		Where("tenant_id = ? AND entry_type = ? AND status = ? AND settlement_version >= 2", tenantID, HubProviderEarningTypeUsage, HubProviderEarningStatusSettled).
		Where("created_at >= ? AND created_at < ?", weekStart, weekEnd).
		Scan(&summary.NetIncomeQuota).Error; err != nil {
		return summary, err
	}
	if err := baseUsage.Select(
		"earnings.model_name, COUNT(*) AS call_count, COALESCE(SUM(earnings.gross_quota), 0) AS quota",
	).Where("earnings.model_name <> ?", "").Group("earnings.model_name").Order("quota DESC, call_count DESC, earnings.model_name ASC").Limit(3).Scan(&summary.TopModels).Error; err != nil {
		return summary, err
	}
	return summary, nil
}

func GetHubWeeklyDigestProviderSummary(providerID int, weekStart, weekEnd int64) (HubWeeklyDigestProviderSummary, error) {
	summary := HubWeeklyDigestProviderSummary{TopModels: make([]HubWeeklyDigestTopModel, 0)}
	if providerID <= 0 || weekStart <= 0 || weekEnd <= weekStart {
		return summary, errors.New("invalid provider weekly digest window")
	}

	type incomeSummary struct {
		Settled int `gorm:"column:settled"`
		Pending int `gorm:"column:pending"`
	}
	var income incomeSummary
	if err := DB.Model(&HubProviderEarning{}).Select(
		"COALESCE(SUM(CASE WHEN status = ? THEN "+
			"(CASE WHEN provider_id = ? THEN provider_income_quota ELSE 0 END + CASE WHEN referral_provider_id = ? THEN referral_income_quota ELSE 0 END) ELSE 0 END), 0) AS settled, "+
			"COALESCE(SUM(CASE WHEN status = ? THEN "+
			"(CASE WHEN provider_id = ? THEN provider_income_quota ELSE 0 END + CASE WHEN referral_provider_id = ? THEN referral_income_quota ELSE 0 END) ELSE 0 END), 0) AS pending",
		HubProviderEarningStatusSettled, providerID, providerID,
		HubProviderEarningStatusPending, providerID, providerID,
	).
		Where("entry_type = ? AND created_at >= ? AND created_at < ?", HubProviderEarningTypeUsage, weekStart, weekEnd).
		Where("provider_id = ? OR referral_provider_id = ?", providerID, providerID).
		Scan(&income).Error; err != nil {
		return summary, err
	}
	summary.SettledIncomeQuota = income.Settled
	summary.PendingIncomeQuota = income.Pending

	served := DB.Model(&HubProviderEarning{}).
		Where("provider_id = ? AND entry_type = ? AND status IN ?", providerID, HubProviderEarningTypeUsage, []string{HubProviderEarningStatusPending, HubProviderEarningStatusSettled}).
		Where("created_at >= ? AND created_at < ?", weekStart, weekEnd)
	if err := served.Count(&summary.SuccessCalls).Error; err != nil {
		return summary, err
	}
	if err := served.Select("model_name, COUNT(*) AS call_count, COALESCE(SUM(gross_quota), 0) AS quota").
		Where("model_name <> ?", "").Group("model_name").Order("quota DESC, call_count DESC, model_name ASC").Limit(3).Scan(&summary.TopModels).Error; err != nil {
		return summary, err
	}

	channels := DB.Table("hub_supply_groups AS groups").
		Joins("JOIN channels ON channels.id = groups.new_api_channel_id").
		Where("groups.provider_id = ?", providerID)
	if err := channels.Count(&summary.TotalChannels).Error; err != nil {
		return summary, err
	}
	if err := channels.Where(
		"channels.status <> ? OR groups.tenant_published = ? OR groups.status NOT IN ? OR groups.error_model_count > 0",
		common.ChannelStatusEnabled,
		commonFalseVal,
		[]string{HubSupplyGroupStatusAvailable, HubSupplyGroupStatusPartial},
	).Count(&summary.AbnormalChannels).Error; err != nil {
		return summary, err
	}
	return summary, nil
}

func EnsureHubWeeklyDigestDelivery(weekStart, weekEnd int64, recipient HubWeeklyDigestRecipient, email string) (*HubWeeklyDigestDelivery, error) {
	tenantID := recipient.TenantId
	if tenantID == 0 {
		tenantID = recipient.ProviderTenantId
	}
	delivery := &HubWeeklyDigestDelivery{
		WeekStart:       weekStart,
		WeekEnd:         weekEnd,
		RecipientUserId: recipient.UserId,
		TenantId:        tenantID,
		ProviderId:      recipient.ProviderId,
		RecipientEmail:  strings.TrimSpace(email),
		Status:          HubWeeklyDigestDeliveryStatusPending,
	}
	if err := DB.Create(delivery).Error; err == nil {
		return delivery, nil
	}
	var existing HubWeeklyDigestDelivery
	if err := DB.Where("week_start = ? AND recipient_user_id = ?", weekStart, recipient.UserId).First(&existing).Error; err != nil {
		return nil, err
	}
	return &existing, nil
}

func GetHubWeeklyDigestDelivery(weekStart int64, recipientUserID int) (*HubWeeklyDigestDelivery, error) {
	var delivery HubWeeklyDigestDelivery
	err := DB.Where("week_start = ? AND recipient_user_id = ?", weekStart, recipientUserID).First(&delivery).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &delivery, nil
}

func ResetFailedHubWeeklyDigestDelivery(id int) error {
	return DB.Model(&HubWeeklyDigestDelivery{}).
		Where("id = ? AND status = ?", id, HubWeeklyDigestDeliveryStatusFailed).
		Updates(map[string]any{
			"status":     HubWeeklyDigestDeliveryStatusPending,
			"attempts":   0,
			"error":      "",
			"updated_at": common.GetTimestamp(),
		}).Error
}

func StartHubWeeklyDigestDeliveryAttempt(id int, email string) error {
	return DB.Model(&HubWeeklyDigestDelivery{}).Where("id = ?", id).Updates(map[string]any{
		"recipient_email": strings.TrimSpace(email),
		"status":          HubWeeklyDigestDeliveryStatusSending,
		"attempts":        gorm.Expr("attempts + 1"),
		"error":           "",
		"updated_at":      common.GetTimestamp(),
	}).Error
}

func FinishHubWeeklyDigestDelivery(id int, status string, errorMessage string) error {
	updates := map[string]any{
		"status":     status,
		"error":      errorMessage,
		"updated_at": common.GetTimestamp(),
	}
	if status == HubWeeklyDigestDeliveryStatusSent {
		updates["sent_at"] = common.GetTimestamp()
	}
	return DB.Model(&HubWeeklyDigestDelivery{}).Where("id = ?", id).Updates(updates).Error
}
