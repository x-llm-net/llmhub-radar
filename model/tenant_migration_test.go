package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type legacyHubProviderWithoutTenant struct {
	Id                           int    `gorm:"primaryKey"`
	OwnerUserId                  int    `gorm:"not null;uniqueIndex:idx_hub_provider_owner_slot,priority:1"`
	Slot                         int    `gorm:"not null;uniqueIndex:idx_hub_provider_owner_slot,priority:2"`
	Name                         string `gorm:"type:varchar(80);not null"`
	Slug                         string `gorm:"type:varchar(63)"`
	SlugBase                     string `gorm:"type:varchar(63);not null;default:''"`
	SlugCode                     string `gorm:"type:varchar(8);not null;default:''"`
	Website                      string `gorm:"type:varchar(512);not null"`
	WebsiteVerifiedOrigin        string `gorm:"type:varchar(191);not null;default:''"`
	WebsiteVerificationStatus    string `gorm:"type:varchar(24);not null;default:'unverified'"`
	WebsiteVerificationMethod    string `gorm:"type:varchar(16);not null;default:''"`
	WebsiteVerificationToken     string `gorm:"type:varchar(128);not null;default:''"`
	WebsiteEvidenceAssetId       int    `gorm:"not null;default:0;index"`
	WebsiteVerificationRemark    string `gorm:"type:varchar(1000);not null;default:''"`
	WebsiteVerificationLastError string `gorm:"type:varchar(1000);not null;default:''"`
	WebsiteVerifiedAt            int64  `gorm:"bigint;not null;default:0"`
	Description                  string `gorm:"type:varchar(1000);not null"`
	LogoURL                      string `gorm:"type:varchar(1024);not null"`
	LogoAssetId                  int    `gorm:"not null;default:0;index"`
	ContactType                  string `gorm:"type:varchar(32);not null;default:''"`
	ContactValue                 string `gorm:"type:varchar(256);not null;default:''"`
	SupportType                  string `gorm:"type:varchar(32);not null;default:''"`
	SupportValue                 string `gorm:"type:varchar(512);not null;default:''"`
	PlatformFeeBasisPoints       *int   `gorm:"column:platform_fee_basis_points"`
	Status                       string `gorm:"type:varchar(24);not null;index"`
	ReviewRemark                 string `gorm:"type:varchar(1000);not null;default:''"`
	ReviewedByUserId             int    `gorm:"not null;default:0"`
	ReviewedAt                   int64  `gorm:"bigint;not null;default:0"`
	CreatedAt                    int64  `gorm:"bigint"`
	UpdatedAt                    int64  `gorm:"bigint"`
}

func (legacyHubProviderWithoutTenant) TableName() string {
	return "hub_providers"
}

func TestTenantMigrationPreservesPlatformDirectProviderOwnership(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&legacyHubProviderWithoutTenant{}))
	require.NoError(t, db.Create(&legacyHubProviderWithoutTenant{
		Id:          1,
		OwnerUserId: 11,
		Slot:        1,
		Name:        "Platform provider",
		Slug:        "platform-provider",
		Website:     "https://provider.example",
		Description: "legacy",
		LogoURL:     "https://provider.example/logo.png",
		Status:      HubProviderStatusActive,
	}).Error)

	require.NoError(t, db.AutoMigrate(&Tenant{}, &TenantDomain{}, &TenantMember{}, &HubProvider{}))

	var provider HubProvider
	require.NoError(t, db.First(&provider, 1).Error)
	assert.Nil(t, provider.TenantId)
	assert.True(t, db.Migrator().HasColumn(&HubProvider{}, "tenant_id"))
}

func TestTenantBaseModelsHaveExpectedOwnershipConstraints(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&Tenant{}, &TenantDomain{}, &TenantMember{}))

	tenant := Tenant{Name: "Tenant A", Slug: "tenant-a", Status: TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	require.NoError(t, db.Create(&TenantDomain{
		TenantId:           tenant.Id,
		Host:               "a.example.com",
		VerificationStatus: TenantDomainVerificationPending,
		Status:             TenantDomainStatusActive,
	}).Error)
	require.NoError(t, db.Create(&TenantMember{
		TenantId: tenant.Id,
		UserId:   11,
		Role:     TenantMemberRoleOwner,
		Status:   TenantMemberStatusActive,
	}).Error)

	assert.Error(t, db.Create(&TenantDomain{
		TenantId:           tenant.Id,
		Host:               "a.example.com",
		VerificationStatus: TenantDomainVerificationPending,
		Status:             TenantDomainStatusActive,
	}).Error)
	assert.Error(t, db.Create(&TenantMember{
		TenantId: tenant.Id,
		UserId:   11,
		Role:     TenantMemberRoleAdmin,
		Status:   TenantMemberStatusActive,
	}).Error)
}
