/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateHubProviderWithManualWebsiteVerification(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{
		OwnerUserId:        7000,
		Name:               "Onboarding Verification",
		Slug:               "onboarding-verification",
		Website:            "https://onboarding.example/admin",
		Status:             HubProviderStatusPending,
		UseProvisionalSlug: true,
	}
	require.NoError(t, CreateHubProviderWithManualWebsiteVerification(
		provider,
		"image/png",
		[]byte("screenshot"),
	))
	assert.Equal(t, HubProviderWebsiteVerificationStatusPending, provider.WebsiteVerificationStatus)
	assert.Equal(t, HubProviderWebsiteVerificationMethodManual, provider.WebsiteVerificationMethod)
	require.Positive(t, provider.WebsiteEvidenceAssetId)
	assert.Equal(t, "https://onboarding.example", provider.WebsiteVerifiedOrigin)

	asset, err := GetHubProviderWebsiteEvidenceAsset(provider.WebsiteEvidenceAssetId)
	require.NoError(t, err)
	assert.Equal(t, provider.Id, asset.ProviderId)
	assert.Equal(t, []byte("screenshot"), asset.Data)
}

func TestHubProviderManualWebsiteVerificationPromotesPendingProviderSlug(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{
		OwnerUserId:        7001,
		Name:               "Skyhope",
		Slug:               "skyhope",
		Website:            "https://skyhope.example/admin",
		Status:             HubProviderStatusPending,
		UseProvisionalSlug: true,
	}
	require.NoError(t, CreateHubProvider(provider))
	assert.Regexp(t, `^skyhope-[a-z0-9]{4}$`, provider.Slug)
	assert.Equal(t, "skyhope", provider.SlugBase)

	asset, err := CreateHubProviderWebsiteEvidenceAsset(provider.Id, 7001, "image/png", []byte("screenshot"))
	require.NoError(t, err)
	verification, err := SubmitHubProviderWebsiteVerification(
		provider.Id,
		7001,
		HubProviderWebsiteVerificationMethodManual,
		asset.Id,
	)
	require.NoError(t, err)
	assert.Equal(t, HubProviderWebsiteVerificationStatusPending, verification.WebsiteVerificationStatus)
	assert.Empty(t, PublicHubProviderWebsite(*verification))

	_, err = UpdateHubProviderStatusWithReviewAndWebsite(
		provider.Id,
		HubProviderStatusActive,
		1,
		"Screenshot verified",
		true,
	)
	require.NoError(t, err)

	stored, err := GetHubProviderByOwnerUserIDWithoutTenant(7001)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, HubProviderStatusActive, stored.Status)
	assert.Equal(t, "skyhope", stored.Slug)
	assert.Empty(t, stored.SlugCode)
	assert.Equal(t, HubProviderWebsiteVerificationStatusVerified, stored.WebsiteVerificationStatus)
	assert.Equal(t, "https://skyhope.example/admin", PublicHubProviderWebsite(*stored))
}

func TestHubProviderWebsiteVerificationPromotesAlreadyApprovedSlug(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{
		OwnerUserId: 7003, Name: "Late Website Verification", Slug: "late-verified",
		Website: "https://late.example/admin", Status: HubProviderStatusPending, UseProvisionalSlug: true,
	}
	require.NoError(t, CreateHubProvider(provider))
	provisionalSlug := provider.Slug
	require.NotEmpty(t, provider.SlugCode)
	_, err := UpdateHubProviderStatusWithReviewAndWebsite(
		provider.Id, HubProviderStatusActive, 1, "Approved", false,
	)
	require.NoError(t, err)
	_, err = SubmitHubProviderWebsiteVerification(
		provider.Id, provider.OwnerUserId, HubProviderWebsiteVerificationMethodDNS, 0,
	)
	require.NoError(t, err)

	failed, err := UpdateHubProviderWebsiteVerificationResult(provider.Id, provider.OwnerUserId, false, "record missing")
	require.NoError(t, err)
	assert.Equal(t, provisionalSlug, failed.Slug)
	assert.Equal(t, HubProviderWebsiteVerificationStatusPending, failed.WebsiteVerificationStatus)

	verified, err := UpdateHubProviderWebsiteVerificationResult(provider.Id, provider.OwnerUserId, true, "")
	require.NoError(t, err)
	assert.Equal(t, "late-verified", verified.Slug)
	assert.Empty(t, verified.SlugCode)
	assert.Equal(t, HubProviderWebsiteVerificationStatusVerified, verified.WebsiteVerificationStatus)
	assert.Equal(t, "https://late.example/admin", PublicHubProviderWebsite(*verified))
	routed, found := GetHubProviderRoutingBySlug("late-verified")
	require.True(t, found)
	assert.Equal(t, provider.Id, routed.Id)
	_, found = GetHubProviderRoutingBySlug(provisionalSlug)
	assert.False(t, found)
}

func TestHubProviderWebsiteVerificationKeepsProvisionalSlugOnCollision(t *testing.T) {
	truncateTables(t)
	tenantA, tenantB := 31, 32
	claimed := &HubProvider{OwnerUserId: 7004, TenantId: &tenantA, Name: "Existing GG", Slug: "gg", Status: HubProviderStatusActive}
	require.NoError(t, CreateHubProvider(claimed))
	provider := &HubProvider{
		OwnerUserId: 7005, TenantId: &tenantB, Name: "New GG", Slug: "gg", Website: "https://gg.example",
		Status: HubProviderStatusPending, UseProvisionalSlug: true,
	}
	require.NoError(t, CreateHubProvider(provider))
	provisionalSlug := provider.Slug
	_, err := UpdateHubProviderStatusWithReviewAndWebsite(
		provider.Id, HubProviderStatusActive, 1, "Approved", false,
	)
	require.NoError(t, err)
	_, err = SubmitHubProviderWebsiteVerification(
		provider.Id, provider.OwnerUserId, HubProviderWebsiteVerificationMethodHTTP, 0,
	)
	require.NoError(t, err)

	verified, err := UpdateHubProviderWebsiteVerificationResult(provider.Id, provider.OwnerUserId, true, "")
	require.NoError(t, err)
	assert.Equal(t, provisionalSlug, verified.Slug)
	assert.NotEmpty(t, verified.SlugCode)
	assert.Equal(t, HubProviderWebsiteVerificationStatusVerified, verified.WebsiteVerificationStatus)
	routed, found := GetHubProviderRoutingBySlug("gg")
	require.True(t, found)
	assert.Equal(t, claimed.Id, routed.Id)
}

func TestHubProviderManualWebsiteApprovalPromotesAlreadyApprovedSlug(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{
		OwnerUserId: 7006, Name: "Late Manual Verification", Slug: "manual-late",
		Website: "https://manual.example", Status: HubProviderStatusPending, UseProvisionalSlug: true,
	}
	require.NoError(t, CreateHubProvider(provider))
	provisionalSlug := provider.Slug
	_, err := UpdateHubProviderStatusWithReviewAndWebsite(
		provider.Id, HubProviderStatusActive, 1, "Approved", false,
	)
	require.NoError(t, err)
	asset, err := CreateHubProviderWebsiteEvidenceAsset(provider.Id, provider.OwnerUserId, "image/png", []byte("screenshot"))
	require.NoError(t, err)
	_, err = SubmitHubProviderWebsiteVerification(
		provider.Id, provider.OwnerUserId, HubProviderWebsiteVerificationMethodManual, asset.Id,
	)
	require.NoError(t, err)

	_, err = UpdateHubProviderStatusWithReviewAndWebsite(
		provider.Id, HubProviderStatusActive, 1, "Website approved", true,
	)
	require.NoError(t, err)
	stored, err := GetHubProviderByID(provider.Id)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, "manual-late", stored.Slug)
	assert.Empty(t, stored.SlugCode)
	assert.Equal(t, HubProviderWebsiteVerificationStatusVerified, stored.WebsiteVerificationStatus)
	routed, found := GetHubProviderRoutingBySlug("manual-late")
	require.True(t, found)
	assert.Equal(t, provider.Id, routed.Id)
	_, found = GetHubProviderRoutingBySlug(provisionalSlug)
	assert.False(t, found)
}

func TestHubProviderManualWebsiteApprovalKeepsProvisionalSlugOnCollision(t *testing.T) {
	truncateTables(t)
	claimed := &HubProvider{OwnerUserId: 7007, Name: "Claimed Short Name", Slug: "shared", Status: HubProviderStatusActive}
	require.NoError(t, CreateHubProvider(claimed))
	provider := &HubProvider{
		OwnerUserId: 7008, Name: "Later Verified", Slug: "shared",
		Website: "https://later.example", Status: HubProviderStatusPending, UseProvisionalSlug: true,
	}
	require.NoError(t, CreateHubProvider(provider))
	provisionalSlug := provider.Slug
	_, err := UpdateHubProviderStatusWithReviewAndWebsite(
		provider.Id, HubProviderStatusActive, 1, "Approved", false,
	)
	require.NoError(t, err)
	asset, err := CreateHubProviderWebsiteEvidenceAsset(provider.Id, provider.OwnerUserId, "image/png", []byte("screenshot"))
	require.NoError(t, err)
	_, err = SubmitHubProviderWebsiteVerification(
		provider.Id, provider.OwnerUserId, HubProviderWebsiteVerificationMethodManual, asset.Id,
	)
	require.NoError(t, err)

	_, err = UpdateHubProviderStatusWithReviewAndWebsite(
		provider.Id, HubProviderStatusActive, 1, "Website approved", true,
	)
	require.NoError(t, err)
	stored, err := GetHubProviderByID(provider.Id)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, provisionalSlug, stored.Slug)
	assert.Equal(t, HubProviderWebsiteVerificationStatusVerified, stored.WebsiteVerificationStatus)
}

func TestHubProviderWebsiteApprovalRejectsGloballyClaimedCleanSlug(t *testing.T) {
	truncateTables(t)
	tenantA, tenantB := 31, 32
	existing := &HubProvider{
		OwnerUserId: 7101, TenantId: &tenantA, Name: "Tenant A", Slug: "shared",
		Status: HubProviderStatusActive,
	}
	require.NoError(t, CreateHubProvider(existing))
	pending := &HubProvider{
		OwnerUserId: 7102, TenantId: &tenantB, Name: "Tenant B", Slug: "shared",
		Website: "https://shared.example/admin", Status: HubProviderStatusPending, UseProvisionalSlug: true,
	}
	require.NoError(t, CreateHubProvider(pending))
	asset, err := CreateHubProviderWebsiteEvidenceAsset(pending.Id, pending.OwnerUserId, "image/png", []byte("screenshot"))
	require.NoError(t, err)
	_, err = SubmitHubProviderWebsiteVerification(
		pending.Id, pending.OwnerUserId, HubProviderWebsiteVerificationMethodManual, asset.Id,
	)
	require.NoError(t, err)

	_, err = UpdateHubProviderStatusWithReviewAndWebsite(
		pending.Id, HubProviderStatusActive, 1, "Verified", true,
	)
	require.ErrorIs(t, err, ErrHubProviderSlugAlreadyExists)
	stored, err := GetHubProviderByOwnerUserIDInTenant(pending.OwnerUserId, tenantB)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.NotEqual(t, "shared", stored.Slug)
	assert.Equal(t, HubProviderStatusPending, stored.Status)
}

func TestHubProviderApprovalCanKeepUnverifiedWebsitePrivate(t *testing.T) {
	truncateTables(t)
	provider := &HubProvider{
		OwnerUserId:        7002,
		Name:               "Borrowed Supply",
		Slug:               "borrowed-supply",
		Website:            "https://shared.example",
		Status:             HubProviderStatusPending,
		UseProvisionalSlug: true,
	}
	require.NoError(t, CreateHubProvider(provider))
	originalSlug := provider.Slug

	_, err := UpdateHubProviderStatusWithReviewAndWebsite(
		provider.Id,
		HubProviderStatusActive,
		1,
		"Approved without website ownership",
		false,
	)
	require.NoError(t, err)

	stored, err := GetHubProviderByOwnerUserIDWithoutTenant(7002)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, originalSlug, stored.Slug)
	assert.Empty(t, PublicHubProviderWebsite(*stored))
}
