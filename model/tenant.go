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

	"gorm.io/gorm"
)

var (
	ErrTenantNotFound       = errors.New("tenant not found")
	ErrTenantMemberNotFound = errors.New("active tenant member not found")
)

const (
	TenantStatusActive   = "active"
	TenantStatusDisabled = "disabled"

	TenantDomainVerificationPending  = "pending"
	TenantDomainVerificationVerified = "verified"
	TenantDomainVerificationRejected = "rejected"

	TenantDomainStatusActive   = "active"
	TenantDomainStatusDisabled = "disabled"

	TenantMemberRoleOwner = "owner"
	TenantMemberRoleAdmin = "admin"

	TenantMemberStatusActive   = "active"
	TenantMemberStatusDisabled = "disabled"
)

// Tenant is the ownership boundary for a future domain administrator.
// A nil HubProvider.TenantId is a migration-compatibility state whose actual
// historical ownership still needs to be confirmed.
type Tenant struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	Name        string `json:"name" gorm:"type:varchar(120);not null"`
	Slug        string `json:"slug" gorm:"type:varchar(63);not null;uniqueIndex:idx_tenants_slug"`
	Status      string `json:"status" gorm:"type:varchar(24);not null"`
	BrandConfig string `json:"-" gorm:"type:varchar(2048);not null;default:'{}'"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint;not null"`
	UpdatedAt   int64  `json:"updated_at" gorm:"bigint;not null"`
}

func (Tenant) TableName() string {
	return "tenants"
}

// TenantDomain maps a verified host to a tenant. Verification behavior is
// intentionally implemented in a later step; this model only stores state.
type TenantDomain struct {
	Id                 int    `json:"id" gorm:"primaryKey"`
	TenantId           int    `json:"tenant_id" gorm:"not null;index"`
	Host               string `json:"host" gorm:"type:varchar(191);not null;uniqueIndex:idx_tenant_domains_host"`
	IsPrimary          bool   `json:"is_primary" gorm:"not null"`
	VerificationStatus string `json:"verification_status" gorm:"type:varchar(24);not null"`
	Status             string `json:"status" gorm:"type:varchar(24);not null"`
	CreatedAt          int64  `json:"created_at" gorm:"bigint;not null"`
	UpdatedAt          int64  `json:"updated_at" gorm:"bigint;not null"`
}

func (TenantDomain) TableName() string {
	return "tenant_domains"
}

// TenantMember assigns a user an administrative role within one tenant.
// Authorization is deliberately not wired to this table in T1-A.
type TenantMember struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	TenantId  int    `json:"tenant_id" gorm:"not null;uniqueIndex:idx_tenant_members_tenant_user,priority:1"`
	UserId    int    `json:"user_id" gorm:"not null;uniqueIndex:idx_tenant_members_tenant_user,priority:2"`
	Role      string `json:"role" gorm:"type:varchar(24);not null"`
	Status    string `json:"status" gorm:"type:varchar(24);not null"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;not null"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint;not null"`
}

func (TenantMember) TableName() string {
	return "tenant_members"
}

func IsTenantAdminRole(role string) bool {
	return role == TenantMemberRoleOwner || role == TenantMemberRoleAdmin
}

func GetActiveTenantMember(tenantID, userID int) (*TenantMember, error) {
	if tenantID <= 0 || userID <= 0 {
		return nil, ErrTenantMemberNotFound
	}
	var member TenantMember
	err := DB.Joins("JOIN tenants ON tenants.id = tenant_members.tenant_id").Where(
		"tenant_members.tenant_id = ? AND tenant_members.user_id = ? AND tenant_members.status = ? AND tenants.status = ?",
		tenantID, userID, TenantMemberStatusActive, TenantStatusActive,
	).First(&member).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTenantMemberNotFound
	}
	if err != nil {
		return nil, err
	}
	return &member, nil
}

func GetActiveTenantByID(tenantID int) (*Tenant, error) {
	if tenantID <= 0 {
		return nil, ErrTenantNotFound
	}
	var tenant Tenant
	err := DB.Where("id = ? AND status = ?", tenantID, TenantStatusActive).First(&tenant).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTenantNotFound
	}
	if err != nil {
		return nil, err
	}
	return &tenant, nil
}

// ApplyHubProviderTenantScope applies the ownership boundary for provider
// management queries. A nil tenant ID selects only migration-compatibility
// records whose historical tenant ownership is still unresolved.
func ApplyHubProviderTenantScope(query *gorm.DB, tenantID *int) *gorm.DB {
	if tenantID == nil {
		return query.Where("tenant_id IS NULL")
	}
	return query.Where("tenant_id = ?", *tenantID)
}

func GetHubProviderByIDInTenant(providerID int, tenantID *int) (*HubProvider, error) {
	if providerID <= 0 {
		return nil, ErrHubProviderNotFound
	}
	var provider HubProvider
	err := ApplyHubProviderTenantScope(
		DB.Where("id = ?", providerID), tenantID,
	).First(&provider).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &provider, nil
}
