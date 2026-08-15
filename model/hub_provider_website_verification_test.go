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

	asset, err := CreateHubProviderWebsiteEvidenceAsset(7001, "image/png", []byte("screenshot"))
	require.NoError(t, err)
	verification, err := SubmitHubProviderWebsiteVerification(
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

	stored, err := GetHubProviderByOwnerUserID(7001)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, HubProviderStatusActive, stored.Status)
	assert.Equal(t, "skyhope", stored.Slug)
	assert.Equal(t, HubProviderWebsiteVerificationStatusVerified, stored.WebsiteVerificationStatus)
	assert.Equal(t, "https://skyhope.example/admin", PublicHubProviderWebsite(*stored))
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

	stored, err := GetHubProviderByOwnerUserID(7002)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, originalSlug, stored.Slug)
	assert.Empty(t, PublicHubProviderWebsite(*stored))
}
