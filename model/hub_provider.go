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
package model

import (
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_provider_settlement_setting"
	"gorm.io/gorm"
)

const (
	HubProviderStatusPending  = "pending"
	HubProviderStatusActive   = "active"
	HubProviderStatusRejected = "rejected"
	HubProviderStatusDisabled = "disabled"
	hubProviderSlugMinLength  = 3
	hubProviderSlugMaxLength  = 63
)

var ErrHubProviderAlreadyExists = errors.New("hub provider already exists")
var ErrHubProviderNotFound = errors.New("hub provider not found")
var ErrHubProviderSlugInvalid = errors.New("hub provider slug is invalid")
var ErrHubProviderSlugAlreadyExists = errors.New("hub provider slug already exists")

var hubProviderReservedSlugs = map[string]struct{}{
	"admin": {}, "api": {}, "app": {}, "auth": {}, "billing": {},
	"cdn": {}, "console": {}, "dashboard": {}, "docs": {}, "mail": {},
	"oauth": {}, "provider": {}, "providers": {}, "static": {},
	"status": {}, "support": {}, "www": {},
}

// HubProvider is the provider profile owned by a New API user. Supply groups
// and their New API channels will reference this profile in later steps.
type HubProvider struct {
	Id                           int    `json:"id" gorm:"primaryKey"`
	OwnerUserId                  int    `json:"-" gorm:"not null;uniqueIndex:idx_hub_provider_owner_slot,priority:1"`
	Slot                         int    `json:"-" gorm:"not null;uniqueIndex:idx_hub_provider_owner_slot,priority:2"`
	Name                         string `json:"name" gorm:"type:varchar(80);not null"`
	Slug                         string `json:"slug" gorm:"type:varchar(63)"`
	SlugBase                     string `json:"slug_base" gorm:"type:varchar(63);not null;default:''"`
	SlugCode                     string `json:"-" gorm:"type:varchar(8);not null;default:''"`
	Website                      string `json:"website" gorm:"type:varchar(512);not null"`
	WebsiteVerifiedOrigin        string `json:"website_verified_origin" gorm:"type:varchar(191);not null;default:''"`
	WebsiteVerificationStatus    string `json:"website_verification_status" gorm:"type:varchar(24);not null;default:'unverified';index"`
	WebsiteVerificationMethod    string `json:"website_verification_method" gorm:"type:varchar(16);not null;default:''"`
	WebsiteVerificationToken     string `json:"-" gorm:"type:varchar(128);not null;default:''"`
	WebsiteEvidenceAssetId       int    `json:"website_evidence_asset_id" gorm:"not null;default:0;index"`
	WebsiteVerificationRemark    string `json:"website_verification_remark" gorm:"type:varchar(1000);not null;default:''"`
	WebsiteVerificationLastError string `json:"website_verification_last_error" gorm:"type:varchar(1000);not null;default:''"`
	WebsiteVerifiedAt            int64  `json:"website_verified_at" gorm:"bigint;not null;default:0"`
	Description                  string `json:"description" gorm:"type:varchar(1000);not null"`
	LogoURL                      string `json:"logo_url" gorm:"type:varchar(1024);not null"`
	LogoAssetId                  int    `json:"logo_asset_id" gorm:"not null;default:0;index"`
	ContactType                  string `json:"contact_type" gorm:"type:varchar(32);not null;default:''"`
	ContactValue                 string `json:"contact_value" gorm:"type:varchar(256);not null;default:''"`
	SupportType                  string `json:"support_type" gorm:"type:varchar(32);not null;default:''"`
	SupportValue                 string `json:"support_value" gorm:"type:varchar(512);not null;default:''"`
	PlatformFeeBasisPoints       *int   `json:"-" gorm:"column:platform_fee_basis_points"`
	Status                       string `json:"status" gorm:"type:varchar(24);not null;index"`
	ReviewRemark                 string `json:"review_remark" gorm:"type:varchar(1000);not null;default:''"`
	ReviewedByUserId             int    `json:"reviewed_by_user_id" gorm:"not null;default:0"`
	ReviewedAt                   int64  `json:"reviewed_at" gorm:"bigint;not null;default:0"`
	CreatedAt                    int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt                    int64  `json:"updated_at" gorm:"bigint"`
	OriginVerificationEnabled    bool   `json:"origin_verification_enabled" gorm:"-"`
	WebsiteVerificationDNSRecord string `json:"website_verification_dns_record" gorm:"-"`
	WebsiteVerificationDNSValue  string `json:"website_verification_dns_value" gorm:"-"`
	WebsiteVerificationHTTPURL   string `json:"website_verification_http_url" gorm:"-"`
	WebsiteVerificationHTTPBody  string `json:"website_verification_http_body" gorm:"-"`
	UseProvisionalSlug           bool   `json:"-" gorm:"-"`
}

type HubProviderAdminListItem struct {
	HubProvider
	OwnerID                         int                        `json:"owner_user_id" gorm:"column:owner_id"`
	OwnerUsername                   string                     `json:"owner_username" gorm:"column:owner_username"`
	OwnerDisplayName                string                     `json:"owner_display_name" gorm:"column:owner_display_name"`
	OwnerEmail                      string                     `json:"owner_email" gorm:"column:owner_email"`
	OwnerStatus                     int                        `json:"owner_status" gorm:"column:owner_status"`
	ChannelCount                    int64                      `json:"channel_count" gorm:"-"`
	OnlineChannelCount              int64                      `json:"online_channel_count" gorm:"-"`
	AvailableModelCount             int64                      `json:"available_model_count" gorm:"-"`
	ErrorModelCount                 int64                      `json:"error_model_count" gorm:"-"`
	LastProbeAt                     int64                      `json:"last_probe_at" gorm:"-"`
	UpstreamUsages                  []HubProviderUpstreamUsage `json:"upstream_usages" gorm:"-"`
	PlatformFeeOverrideBasisPoints  *int                       `json:"platform_fee_basis_points" gorm:"column:platform_fee_override_basis_points"`
	GlobalPlatformFeeBasisPoints    int                        `json:"global_platform_fee_basis_points" gorm:"-"`
	EffectivePlatformFeeBasisPoints int                        `json:"effective_platform_fee_basis_points" gorm:"-"`
}

type HubProviderUpstreamUsage struct {
	Origin        string `json:"origin"`
	ProviderCount int64  `json:"provider_count"`
	ChannelCount  int64  `json:"channel_count"`
}

func (HubProvider) TableName() string {
	return "hub_providers"
}

func (p *HubProvider) BeforeCreate(tx *gorm.DB) error {
	slug, err := NormalizeHubProviderSlug(p.Slug)
	if err != nil {
		return err
	}
	p.Slug = slug
	now := common.GetTimestamp()
	if p.Slot == 0 {
		p.Slot = 1
	}
	if p.Status == "" {
		p.Status = HubProviderStatusActive
	}
	if p.SlugBase == "" {
		p.SlugBase = p.Slug
	}
	if p.WebsiteVerificationStatus == "" {
		p.WebsiteVerificationStatus = HubProviderWebsiteVerificationStatusUnverified
	}
	p.CreatedAt = now
	p.UpdatedAt = now
	return nil
}

func (p *HubProvider) BeforeUpdate(tx *gorm.DB) error {
	p.UpdatedAt = common.GetTimestamp()
	return nil
}

func GetHubProviderByOwnerUserID(ownerUserID int) (*HubProvider, error) {
	var provider HubProvider
	err := DB.Where("owner_user_id = ?", ownerUserID).Order("slot asc").First(&provider).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &provider, nil
}

func NormalizeHubProviderSlug(value string) (string, error) {
	slug := strings.ToLower(strings.TrimSpace(value))
	if len(slug) < hubProviderSlugMinLength || len(slug) > hubProviderSlugMaxLength {
		return "", ErrHubProviderSlugInvalid
	}
	if slug[0] == '-' || slug[len(slug)-1] == '-' || strings.HasPrefix(slug, "xn--") {
		return "", ErrHubProviderSlugInvalid
	}
	if _, reserved := hubProviderReservedSlugs[slug]; reserved {
		return "", ErrHubProviderSlugInvalid
	}
	for _, char := range slug {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' {
			continue
		}
		return "", ErrHubProviderSlugInvalid
	}
	return slug, nil
}

func hubProviderSlugFromName(name string) string {
	var builder strings.Builder
	lastWasHyphen := false
	for _, char := range strings.ToLower(strings.TrimSpace(name)) {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
			lastWasHyphen = false
			continue
		}
		if builder.Len() > 0 && !lastWasHyphen {
			builder.WriteByte('-')
			lastWasHyphen = true
		}
	}
	slug := strings.Trim(builder.String(), "-")
	if len(slug) > hubProviderSlugMaxLength {
		slug = strings.TrimRight(slug[:hubProviderSlugMaxLength], "-")
	}
	if normalized, err := NormalizeHubProviderSlug(slug); err == nil {
		return normalized
	}
	return "provider-" + strings.ToLower(common.GetRandomString(8))
}

func hubProviderSlugFromWebsite(website string) string {
	parsed, err := url.Parse(strings.TrimSpace(website))
	if err != nil || parsed.Hostname() == "" {
		return ""
	}
	labels := strings.Split(strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www."), ".")
	if len(labels) < 2 {
		return ""
	}
	twoLevelSuffixes := map[string]struct{}{
		"com.au": {}, "com.cn": {}, "com.hk": {}, "com.sg": {},
		"co.jp": {}, "co.uk": {}, "net.cn": {}, "org.cn": {},
	}
	suffix := strings.Join(labels[len(labels)-2:], ".")
	index := len(labels) - 2
	if _, ok := twoLevelSuffixes[suffix]; ok {
		index = len(labels) - 3
	}
	if index < 0 {
		return ""
	}
	return hubProviderSlugFromName(labels[index])
}

func hubProviderSlugWithSuffix(base, suffix string) string {
	maxBaseLength := hubProviderSlugMaxLength - len(suffix) - 1
	if maxBaseLength < hubProviderSlugMinLength {
		return "provider-" + strings.ToLower(common.GetRandomString(8))
	}
	base = strings.TrimRight(base[:min(len(base), maxBaseLength)], "-")
	return fmt.Sprintf("%s-%s", base, suffix)
}

func hubProviderSlugTaken(slug string, excludeProviderID int) (bool, error) {
	query := DB.Model(&HubProvider{}).Where("slug = ?", slug)
	if excludeProviderID > 0 {
		query = query.Where("id <> ?", excludeProviderID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func prepareHubProviderSlug(requestedSlug, providerName, website string, excludeProviderID int) (string, error) {
	requestedSlug = strings.TrimSpace(requestedSlug)
	candidate := requestedSlug
	if candidate == "" {
		candidate = hubProviderSlugFromWebsite(website)
		if candidate == "" {
			candidate = hubProviderSlugFromName(providerName)
		}
	}
	normalized, err := NormalizeHubProviderSlug(candidate)
	if err != nil {
		return "", err
	}
	taken, err := hubProviderSlugTaken(normalized, excludeProviderID)
	if err != nil {
		return "", err
	}
	if !taken {
		return normalized, nil
	}
	if requestedSlug != "" {
		return "", ErrHubProviderSlugAlreadyExists
	}
	for range 10 {
		candidate = hubProviderSlugWithSuffix(normalized, strings.ToLower(common.GetRandomString(5)))
		taken, err = hubProviderSlugTaken(candidate, excludeProviderID)
		if err != nil {
			return "", err
		}
		if !taken {
			return candidate, nil
		}
	}
	return "", ErrHubProviderSlugAlreadyExists
}

func prepareProvisionalHubProviderSlug(requestedSlug, providerName, website string) (string, string, string, error) {
	candidate := strings.TrimSpace(requestedSlug)
	if candidate == "" {
		candidate = hubProviderSlugFromWebsite(website)
		if candidate == "" {
			candidate = hubProviderSlugFromName(providerName)
		}
	}
	base, err := NormalizeHubProviderSlug(candidate)
	if err != nil {
		return "", "", "", err
	}
	for range 10 {
		code := strings.ToLower(common.GetRandomString(4))
		slug := hubProviderSlugWithSuffix(base, code)
		taken, lookupErr := hubProviderSlugTaken(slug, 0)
		if lookupErr != nil {
			return "", "", "", lookupErr
		}
		if !taken {
			return slug, base, code, nil
		}
	}
	return "", "", "", ErrHubProviderSlugAlreadyExists
}

func prepareHubProviderForCreate(provider *HubProvider) error {
	if provider == nil || provider.OwnerUserId <= 0 {
		return errors.New("invalid hub provider")
	}

	existing, err := GetHubProviderByOwnerUserID(provider.OwnerUserId)
	if err != nil {
		return err
	}
	if existing != nil {
		return ErrHubProviderAlreadyExists
	}
	var slug string
	if provider.UseProvisionalSlug {
		var base, code string
		slug, base, code, err = prepareProvisionalHubProviderSlug(provider.Slug, provider.Name, provider.Website)
		provider.SlugBase = base
		provider.SlugCode = code
	} else {
		slug, err = prepareHubProviderSlug(provider.Slug, provider.Name, provider.Website, 0)
		provider.SlugBase = slug
	}
	if err != nil {
		return err
	}
	provider.Slug = slug
	provider.Slot = 1
	return nil
}

func mapHubProviderCreateError(provider *HubProvider, createErr error) error {
	if provider == nil {
		return createErr
	}
	existing, lookupErr := GetHubProviderByOwnerUserID(provider.OwnerUserId)
	if lookupErr == nil && existing != nil {
		return ErrHubProviderAlreadyExists
	}
	slugTaken, lookupErr := hubProviderSlugTaken(provider.Slug, 0)
	if lookupErr == nil && slugTaken {
		return ErrHubProviderSlugAlreadyExists
	}
	return createErr
}

func refreshHubProviderRoutingCache() {
	if err := RefreshHubSupplyPricingCache(); err != nil {
		common.SysError("failed to refresh hub provider routing cache: " + err.Error())
	}
}

func CreateHubProvider(provider *HubProvider) error {
	if err := prepareHubProviderForCreate(provider); err != nil {
		return err
	}
	if err := DB.Create(provider).Error; err != nil {
		return mapHubProviderCreateError(provider, err)
	}
	refreshHubProviderRoutingCache()
	return nil
}

// UpdateHubProviderProfile changes the provider profile owned by the user. A
// rejected application returns to pending review when the user resubmits it.
func updateHubProviderProfile(
	db *gorm.DB,
	ownerUserID int,
	name, website, description, logoURL string,
	contactType, contactValue, supportType, supportValue string,
) (*HubProvider, error) {
	if ownerUserID <= 0 {
		return nil, errors.New("invalid hub provider owner")
	}

	var provider HubProvider
	if err := db.Where("owner_user_id = ?", ownerUserID).First(&provider).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrHubProviderNotFound
		}
		return nil, err
	}
	updates := map[string]any{
		"name":          name,
		"website":       website,
		"description":   description,
		"logo_url":      logoURL,
		"contact_type":  contactType,
		"contact_value": contactValue,
		"support_type":  supportType,
		"support_value": supportValue,
		"updated_at":    common.GetTimestamp(),
	}
	oldOrigin, _, oldOriginErr := NormalizeHubProviderOrigin(provider.Website)
	newOrigin, _, newOriginErr := NormalizeHubProviderOrigin(website)
	if website == "" || oldOriginErr != nil || newOriginErr != nil || oldOrigin != newOrigin {
		updates["website_verified_origin"] = ""
		updates["website_verification_status"] = HubProviderWebsiteVerificationStatusUnverified
		updates["website_verification_method"] = ""
		updates["website_verification_token"] = ""
		updates["website_evidence_asset_id"] = 0
		updates["website_verification_remark"] = ""
		updates["website_verification_last_error"] = ""
		updates["website_verified_at"] = 0
	}
	if provider.Status == HubProviderStatusRejected {
		updates["status"] = HubProviderStatusPending
		updates["review_remark"] = ""
		updates["reviewed_by_user_id"] = 0
		updates["reviewed_at"] = 0
	}

	result := db.Model(&HubProvider{}).
		Where("id = ? AND owner_user_id = ?", provider.Id, ownerUserID).
		Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, ErrHubProviderNotFound
	}
	if err := db.First(&provider, provider.Id).Error; err != nil {
		return nil, err
	}
	return &provider, nil
}

func UpdateHubProviderProfile(
	ownerUserID int,
	name, website, description, logoURL string,
	contactType, contactValue, supportType, supportValue string,
) (*HubProvider, error) {
	provider, err := updateHubProviderProfile(
		DB, ownerUserID, name, website, description, logoURL,
		contactType, contactValue, supportType, supportValue,
	)
	if err != nil {
		return nil, err
	}
	if err := RefreshHubSupplyPricingCache(); err != nil {
		common.SysError("failed to refresh hub provider routing cache: " + err.Error())
	}
	return provider, nil
}

func IsValidHubProviderStatus(status string) bool {
	return status == HubProviderStatusPending ||
		status == HubProviderStatusActive ||
		status == HubProviderStatusRejected ||
		status == HubProviderStatusDisabled
}

func ListHubProviders(keyword, status string, offset, limit int) ([]HubProviderAdminListItem, int64, error) {
	query := DB.Table("hub_providers AS providers").
		Joins("JOIN users ON users.id = providers.owner_user_id")
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		pattern := "%" + strings.ToLower(keyword) + "%"
		query = query.Where(
			"LOWER(providers.name) LIKE ? OR LOWER(providers.website) LIKE ? OR LOWER(users.username) LIKE ? OR LOWER(users.display_name) LIKE ? OR LOWER(users.email) LIKE ?",
			pattern, pattern, pattern, pattern, pattern,
		)
	}
	if IsValidHubProviderStatus(status) {
		query = query.Where("providers.status = ?", status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	providers := make([]HubProviderAdminListItem, 0)
	listQuery := query.Select(
		"providers.*, providers.platform_fee_basis_points AS platform_fee_override_basis_points, providers.owner_user_id AS owner_id, users.username AS owner_username, users.display_name AS owner_display_name, users.email AS owner_email, users.status AS owner_status",
	).Order("providers.id DESC")
	if limit > 0 {
		listQuery = listQuery.Limit(limit).Offset(offset)
	}
	if err := listQuery.Scan(&providers).Error; err != nil {
		return nil, 0, err
	}
	if len(providers) == 0 {
		return providers, total, nil
	}

	providerIDs := make([]int, 0, len(providers))
	for i := range providers {
		providerIDs = append(providerIDs, providers[i].Id)
	}
	type providerMetrics struct {
		ProviderId          int   `gorm:"column:provider_id"`
		ChannelCount        int64 `gorm:"column:channel_count"`
		OnlineChannelCount  int64 `gorm:"column:online_channel_count"`
		AvailableModelCount int64 `gorm:"column:available_model_count"`
		ErrorModelCount     int64 `gorm:"column:error_model_count"`
		LastProbeAt         int64 `gorm:"column:last_probe_at"`
	}
	metrics := make([]providerMetrics, 0, len(providers))
	if err := DB.Table("hub_supply_groups AS supply_groups").
		Select(
			"supply_groups.provider_id, COUNT(*) AS channel_count, "+
				"SUM(CASE WHEN channels.status = ? THEN 1 ELSE 0 END) AS online_channel_count, "+
				"SUM(supply_groups.available_model_count) AS available_model_count, "+
				"SUM(supply_groups.error_model_count) AS error_model_count, "+
				"MAX(supply_groups.last_probe_at) AS last_probe_at",
			common.ChannelStatusEnabled,
		).
		Joins("JOIN channels ON channels.id = supply_groups.new_api_channel_id").
		Where("supply_groups.provider_id IN ?", providerIDs).
		Group("supply_groups.provider_id").
		Scan(&metrics).Error; err != nil {
		return nil, 0, err
	}
	metricsByProvider := make(map[int]providerMetrics, len(metrics))
	for _, item := range metrics {
		metricsByProvider[item.ProviderId] = item
	}
	for i := range providers {
		item := metricsByProvider[providers[i].Id]
		providers[i].ChannelCount = item.ChannelCount
		providers[i].OnlineChannelCount = item.OnlineChannelCount
		providers[i].AvailableModelCount = item.AvailableModelCount
		providers[i].ErrorModelCount = item.ErrorModelCount
		providers[i].LastProbeAt = item.LastProbeAt
		providers[i].GlobalPlatformFeeBasisPoints = hub_provider_settlement_setting.PlatformFeeBasisPoints()
		providers[i].EffectivePlatformFeeBasisPoints = providers[i].GlobalPlatformFeeBasisPoints
		if override := providers[i].PlatformFeeOverrideBasisPoints; override != nil && *override >= 0 && *override <= 10000 {
			providers[i].EffectivePlatformFeeBasisPoints = *override
		}
		HydrateHubProviderVerificationFields(&providers[i].HubProvider)
	}
	if err := populateHubProviderUpstreamUsages(providers); err != nil {
		return nil, 0, err
	}

	return providers, total, nil
}

func UpdateHubProviderPlatformFeeBasisPoints(providerID int, override *int) (*HubProvider, error) {
	if providerID <= 0 || (override != nil && (*override < 0 || *override > 10000)) {
		return nil, errors.New("invalid hub provider platform fee")
	}
	updates := map[string]any{
		"platform_fee_basis_points": override,
		"updated_at":                common.GetTimestamp(),
	}
	result := DB.Model(&HubProvider{}).Where("id = ?", providerID).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, ErrHubProviderNotFound
	}
	var provider HubProvider
	if err := DB.First(&provider, providerID).Error; err != nil {
		return nil, err
	}
	refreshHubProviderRoutingCache()
	return &provider, nil
}

func populateHubProviderUpstreamUsages(providers []HubProviderAdminListItem) error {
	if len(providers) == 0 {
		return nil
	}
	type supplyOriginRow struct {
		ProviderID  int     `gorm:"column:provider_id"`
		ChannelType int     `gorm:"column:channel_type"`
		BaseURL     *string `gorm:"column:base_url"`
	}
	type originUsage struct {
		providerIDs  map[int]struct{}
		channelCount int64
	}
	rows := make([]supplyOriginRow, 0)
	if err := DB.Table("hub_supply_groups AS supply_groups").
		Select("supply_groups.provider_id, channels.type AS channel_type, channels.base_url").
		Joins("JOIN channels ON channels.id = supply_groups.new_api_channel_id").
		Scan(&rows).Error; err != nil {
		return err
	}

	usageByOrigin := make(map[string]*originUsage)
	originsByProvider := make(map[int]map[string]struct{})
	for _, row := range rows {
		baseURL := ""
		if row.BaseURL != nil {
			baseURL = *row.BaseURL
		}
		required, origin, _, err := HubProviderChannelOriginRequiresClaim(row.ChannelType, baseURL)
		if err != nil || !required {
			continue
		}
		usage := usageByOrigin[origin]
		if usage == nil {
			usage = &originUsage{providerIDs: make(map[int]struct{})}
			usageByOrigin[origin] = usage
		}
		usage.providerIDs[row.ProviderID] = struct{}{}
		usage.channelCount++
		if originsByProvider[row.ProviderID] == nil {
			originsByProvider[row.ProviderID] = make(map[string]struct{})
		}
		originsByProvider[row.ProviderID][origin] = struct{}{}
	}

	for i := range providers {
		origins := originsByProvider[providers[i].Id]
		if len(origins) == 0 {
			providers[i].UpstreamUsages = []HubProviderUpstreamUsage{}
			continue
		}
		originNames := make([]string, 0, len(origins))
		for origin := range origins {
			originNames = append(originNames, origin)
		}
		sort.Strings(originNames)
		usages := make([]HubProviderUpstreamUsage, 0, len(originNames))
		for _, origin := range originNames {
			usage := usageByOrigin[origin]
			usages = append(usages, HubProviderUpstreamUsage{
				Origin:        origin,
				ProviderCount: int64(len(usage.providerIDs)),
				ChannelCount:  usage.channelCount,
			})
		}
		providers[i].UpstreamUsages = usages
	}
	return nil
}

func UpdateHubProviderStatus(providerID int, status string) ([]int, error) {
	return updateHubProviderStatus(providerID, status, 0, "", false)
}

func UpdateHubProviderStatusWithReview(providerID int, status string, reviewerUserID int, reviewRemark string) ([]int, error) {
	return updateHubProviderStatus(providerID, status, reviewerUserID, strings.TrimSpace(reviewRemark), false)
}

func UpdateHubProviderStatusWithReviewAndWebsite(providerID int, status string, reviewerUserID int, reviewRemark string, approveWebsite bool) ([]int, error) {
	return updateHubProviderStatus(providerID, status, reviewerUserID, strings.TrimSpace(reviewRemark), approveWebsite)
}

func updateHubProviderStatus(providerID int, status string, reviewerUserID int, reviewRemark string, approveWebsite bool) ([]int, error) {
	if providerID <= 0 || !IsValidHubProviderStatus(status) {
		return nil, errors.New("invalid hub provider status update")
	}
	var groupIDs []int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var provider HubProvider
		if err := tx.First(&provider, providerID).Error; err != nil {
			return err
		}
		updates := map[string]any{
			"status":              status,
			"review_remark":       reviewRemark,
			"reviewed_by_user_id": reviewerUserID,
			"reviewed_at":         common.GetTimestamp(),
			"updated_at":          common.GetTimestamp(),
		}
		if status == HubProviderStatusActive && approveWebsite {
			verificationReady := provider.WebsiteVerificationStatus == HubProviderWebsiteVerificationStatusVerified ||
				(provider.WebsiteVerificationStatus == HubProviderWebsiteVerificationStatusPending &&
					provider.WebsiteVerificationMethod == HubProviderWebsiteVerificationMethodManual &&
					provider.WebsiteEvidenceAssetId > 0)
			if !verificationReady {
				return ErrHubProviderWebsiteVerificationInvalid
			}
			origin, _, err := NormalizeHubProviderOrigin(provider.Website)
			if err != nil || origin != provider.WebsiteVerifiedOrigin {
				return ErrHubProviderWebsiteVerificationInvalid
			}
			if provider.Status != HubProviderStatusActive {
				cleanSlug := provider.SlugBase
				if cleanSlug == "" {
					cleanSlug = provider.Slug
				}
				cleanSlug, err = NormalizeHubProviderSlug(cleanSlug)
				if err != nil {
					return err
				}
				var count int64
				if err := tx.Model(&HubProvider{}).
					Where("slug = ? AND id <> ?", cleanSlug, providerID).
					Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					return ErrHubProviderSlugAlreadyExists
				}
				updates["slug"] = cleanSlug
			}
			updates["website_verification_status"] = HubProviderWebsiteVerificationStatusVerified
			updates["website_verification_remark"] = reviewRemark
			updates["website_verification_last_error"] = ""
			updates["website_verified_at"] = common.GetTimestamp()
		}
		if status == HubProviderStatusRejected &&
			provider.WebsiteVerificationStatus == HubProviderWebsiteVerificationStatusPending &&
			provider.WebsiteVerificationMethod == HubProviderWebsiteVerificationMethodManual {
			updates["website_verification_status"] = HubProviderWebsiteVerificationStatusRejected
			updates["website_verification_remark"] = reviewRemark
		}
		result := tx.Model(&HubProvider{}).
			Where("id = ?", providerID).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&HubSupplyGroup{}).
			Where("provider_id = ?", providerID).
			Pluck("id", &groupIDs).Error
	})
	if err == nil {
		if refreshErr := RefreshHubSupplyPricingCache(); refreshErr != nil {
			common.SysError("failed to refresh hub provider routing cache: " + refreshErr.Error())
		}
	}
	return groupIDs, err
}
