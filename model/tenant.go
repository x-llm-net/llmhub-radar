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
// A nil HubProvider.TenantId still represents platform-direct ownership.
type Tenant struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	Name      string `json:"name" gorm:"type:varchar(120);not null"`
	Slug      string `json:"slug" gorm:"type:varchar(63);not null;uniqueIndex:idx_tenants_slug"`
	Status    string `json:"status" gorm:"type:varchar(24);not null"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;not null"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint;not null"`
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
