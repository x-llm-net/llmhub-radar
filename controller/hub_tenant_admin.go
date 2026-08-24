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
package controller

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var tenantSlugPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

type adminCreateTenantRequest struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type adminUpdateTenantStatusRequest struct {
	Status string `json:"status"`
}

type adminCreateTenantDomainRequest struct {
	Host      string `json:"host"`
	IsPrimary bool   `json:"is_primary"`
	Trusted   bool   `json:"trusted"`
}

type adminUpdateTenantDomainRequest struct {
	Status             string `json:"status"`
	VerificationStatus string `json:"verification_status"`
	IsPrimary          *bool  `json:"is_primary"`
}

type adminUpsertTenantMemberRequest struct {
	UserID int    `json:"user_id"`
	Role   string `json:"role"`
}

type adminUpdateTenantMemberRequest struct {
	Role   string `json:"role"`
	Status string `json:"status"`
}

type hubAdminTenantMemberItem struct {
	ID          int    `json:"id"`
	TenantID    int    `json:"tenant_id"`
	UserID      int    `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Role        string `json:"role"`
	Status      string `json:"status"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

type hubAdminTenantItem struct {
	model.Tenant
	Domains []model.TenantDomain       `json:"domains"`
	Members []hubAdminTenantMemberItem `json:"members"`
	Brand   model.TenantBrandConfig    `json:"brand"`
}

func normalizeTenantSlug(slug string) (string, error) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if slug == "" || !tenantSlugPattern.MatchString(slug) {
		return "", errors.New("slug must contain 1-63 lowercase letters, numbers, or hyphens")
	}
	return slug, nil
}

func adminTenantByID(id int) (*model.Tenant, error) {
	if id <= 0 {
		return nil, errors.New("invalid tenant id")
	}
	var tenant model.Tenant
	if err := model.DB.First(&tenant, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, model.ErrTenantNotFound
		}
		return nil, err
	}
	return &tenant, nil
}

func adminTenantMembers(tenantID int) ([]hubAdminTenantMemberItem, error) {
	items := make([]hubAdminTenantMemberItem, 0)
	err := model.DB.Table("tenant_members").
		Select("tenant_members.id, tenant_members.tenant_id, tenant_members.user_id, tenant_members.role, tenant_members.status, tenant_members.created_at, tenant_members.updated_at, users.username, users.display_name, users.email").
		Joins("JOIN users ON users.id = tenant_members.user_id").
		Where("tenant_members.tenant_id = ?", tenantID).
		Order("tenant_members.id ASC").
		Scan(&items).Error
	return items, err
}

func adminTenantItem(tenant model.Tenant) (hubAdminTenantItem, error) {
	item := hubAdminTenantItem{Tenant: tenant, Domains: make([]model.TenantDomain, 0), Members: make([]hubAdminTenantMemberItem, 0), Brand: tenant.Brand()}
	if err := model.DB.Where("tenant_id = ?", tenant.Id).Order("id ASC").Find(&item.Domains).Error; err != nil {
		return item, err
	}
	members, err := adminTenantMembers(tenant.Id)
	if err != nil {
		return item, err
	}
	item.Members = members
	return item, nil
}

func AdminListHubTenants(c *gin.Context) {
	var tenants []model.Tenant
	if err := model.DB.Order("id ASC").Find(&tenants).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]hubAdminTenantItem, 0, len(tenants))
	for _, tenant := range tenants {
		item, err := adminTenantItem(tenant)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		items = append(items, item)
	}
	common.ApiSuccess(c, gin.H{"items": items})
}

func AdminCreateHubTenant(c *gin.Context) {
	var request adminCreateTenantRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, errors.New("invalid tenant payload"))
		return
	}
	name := strings.TrimSpace(request.Name)
	slug, err := normalizeTenantSlug(request.Slug)
	if err != nil || name == "" || len([]rune(name)) > 120 {
		if err == nil {
			err = errors.New("tenant name is required and must be at most 120 characters")
		}
		common.ApiError(c, err)
		return
	}
	now := time.Now().Unix()
	tenant := model.Tenant{Name: name, Slug: slug, Status: model.TenantStatusActive, CreatedAt: now, UpdatedAt: now}
	if err := model.DB.Create(&tenant).Error; err != nil {
		common.ApiError(c, fmt.Errorf("failed to create tenant: %w", err))
		return
	}
	common.ApiSuccess(c, tenant)
}

func AdminUpdateHubTenantStatus(c *gin.Context) {
	var request adminUpdateTenantStatusRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || (request.Status != model.TenantStatusActive && request.Status != model.TenantStatusDisabled) {
		common.ApiError(c, errors.New("invalid tenant status"))
		return
	}
	id := parseIDParam(c, "id")
	tenant, err := adminTenantByID(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	tenant.Status = request.Status
	tenant.UpdatedAt = time.Now().Unix()
	if err := model.DB.Save(tenant).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tenant)
}

func AdminCreateHubTenantDomain(c *gin.Context) {
	var request adminCreateTenantDomainRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, errors.New("invalid domain payload"))
		return
	}
	if _, err := adminTenantByID(parseIDParam(c, "id")); err != nil {
		common.ApiError(c, err)
		return
	}
	host, err := model.NormalizeTenantHost(request.Host)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	now := time.Now().Unix()
	domain := model.TenantDomain{
		TenantId:           parseIDParam(c, "id"),
		Host:               host,
		IsPrimary:          request.IsPrimary,
		VerificationStatus: model.TenantDomainVerificationPending,
		Status:             model.TenantDomainStatusActive,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if request.Trusted {
		domain.VerificationStatus = model.TenantDomainVerificationVerified
	}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&model.TenantDomain{}).Where("tenant_id = ?", domain.TenantId).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			domain.IsPrimary = true
		}
		if domain.IsPrimary {
			if err := tx.Model(&model.TenantDomain{}).Where("tenant_id = ?", domain.TenantId).Update("is_primary", false).Error; err != nil {
				return err
			}
		}
		return tx.Create(&domain).Error
	})
	if err != nil {
		common.ApiError(c, fmt.Errorf("failed to add domain: %w", err))
		return
	}
	common.ApiSuccess(c, domain)
}

func AdminUpdateHubTenantDomain(c *gin.Context) {
	var request adminUpdateTenantDomainRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, errors.New("invalid domain payload"))
		return
	}
	tenantID := parseIDParam(c, "id")
	if _, err := adminTenantByID(tenantID); err != nil {
		common.ApiError(c, err)
		return
	}
	var domain model.TenantDomain
	if err := model.DB.Where("id = ? AND tenant_id = ?", parseIDParam(c, "domain_id"), tenantID).First(&domain).Error; err != nil {
		common.ApiError(c, model.ErrTenantNotFound)
		return
	}
	if request.Status != "" && request.Status != model.TenantDomainStatusActive && request.Status != model.TenantDomainStatusDisabled {
		common.ApiError(c, errors.New("invalid domain status"))
		return
	}
	if request.VerificationStatus != "" && request.VerificationStatus != model.TenantDomainVerificationPending && request.VerificationStatus != model.TenantDomainVerificationVerified && request.VerificationStatus != model.TenantDomainVerificationRejected {
		common.ApiError(c, errors.New("invalid domain verification status"))
		return
	}
	domain.Status = firstNonEmpty(request.Status, domain.Status)
	domain.VerificationStatus = firstNonEmpty(request.VerificationStatus, domain.VerificationStatus)
	domain.UpdatedAt = time.Now().Unix()
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		if request.IsPrimary != nil && *request.IsPrimary {
			if err := tx.Model(&model.TenantDomain{}).Where("tenant_id = ?", tenantID).Update("is_primary", false).Error; err != nil {
				return err
			}
			domain.IsPrimary = true
		} else if request.IsPrimary != nil {
			domain.IsPrimary = false
		}
		return tx.Save(&domain).Error
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, domain)
}

func AdminUpsertHubTenantMember(c *gin.Context) {
	var request adminUpsertTenantMemberRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || !model.IsTenantAdminRole(request.Role) || request.UserID <= 0 {
		common.ApiError(c, errors.New("user id and role owner/admin are required"))
		return
	}
	tenantID := parseIDParam(c, "id")
	if _, err := adminTenantByID(tenantID); err != nil {
		common.ApiError(c, err)
		return
	}
	var user model.User
	if err := model.DB.Where("id = ? AND status = ?", request.UserID, common.UserStatusEnabled).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			err = errors.New("enabled user not found")
		}
		common.ApiError(c, err)
		return
	}
	now := time.Now().Unix()
	member := model.TenantMember{TenantId: tenantID, UserId: request.UserID, Role: request.Role, Status: model.TenantMemberStatusActive, CreatedAt: now, UpdatedAt: now}
	if err := model.DB.Where("tenant_id = ? AND user_id = ?", tenantID, request.UserID).Assign(map[string]any{
		"role":       member.Role,
		"status":     member.Status,
		"updated_at": now,
	}).FirstOrCreate(&member).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"tenant_id": tenantID, "user_id": user.Id, "role": member.Role, "status": member.Status})
}

func AdminUpdateHubTenantMember(c *gin.Context) {
	var request adminUpdateTenantMemberRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, errors.New("invalid member payload"))
		return
	}
	if request.Role != "" && !model.IsTenantAdminRole(request.Role) {
		common.ApiError(c, errors.New("invalid tenant member role"))
		return
	}
	if request.Status != "" && request.Status != model.TenantMemberStatusActive && request.Status != model.TenantMemberStatusDisabled {
		common.ApiError(c, errors.New("invalid tenant member status"))
		return
	}
	tenantID := parseIDParam(c, "id")
	userID := parseIDParam(c, "user_id")
	if _, err := adminTenantByID(tenantID); err != nil {
		common.ApiError(c, err)
		return
	}
	var member model.TenantMember
	if err := model.DB.Where("tenant_id = ? AND user_id = ?", tenantID, userID).First(&member).Error; err != nil {
		common.ApiError(c, model.ErrTenantMemberNotFound)
		return
	}
	if request.Status == model.TenantMemberStatusDisabled && member.Status == model.TenantMemberStatusActive && member.Role == model.TenantMemberRoleOwner {
		var ownerCount int64
		if err := model.DB.Model(&model.TenantMember{}).Where("tenant_id = ? AND role = ? AND status = ?", tenantID, model.TenantMemberRoleOwner, model.TenantMemberStatusActive).Count(&ownerCount).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		if ownerCount <= 1 {
			common.ApiError(c, errors.New("tenant must keep at least one active owner"))
			return
		}
	}
	if request.Role != "" {
		member.Role = request.Role
	}
	if request.Status != "" {
		member.Status = request.Status
	}
	member.UpdatedAt = time.Now().Unix()
	if err := model.DB.Save(&member).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, member)
}

func parseIDParam(c *gin.Context, name string) int {
	var id int
	if _, err := fmt.Sscan(c.Param(name), &id); err != nil {
		return 0
	}
	return id
}

func firstNonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
