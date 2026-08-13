/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeHubProviderOrigin(t *testing.T) {
	tests := []struct {
		name         string
		rawURL       string
		wantOrigin   string
		wantHostname string
		wantError    bool
	}{
		{name: "path is ignored", rawURL: "HTTPS://Example.COM/v1/models?key=x", wantOrigin: "https://example.com", wantHostname: "example.com"},
		{name: "default port is removed", rawURL: "https://example.com:443/v1", wantOrigin: "https://example.com", wantHostname: "example.com"},
		{name: "numeric default port is normalized", rawURL: "https://example.com:0443/v1", wantOrigin: "https://example.com", wantHostname: "example.com"},
		{name: "non-default port is preserved", rawURL: "https://example.com:8443/v1", wantOrigin: "https://example.com:8443", wantHostname: "example.com"},
		{name: "unicode hostname is normalized", rawURL: "https://例子.测试/v1", wantOrigin: "https://xn--fsqu00a.xn--0zwm56d", wantHostname: "xn--fsqu00a.xn--0zwm56d"},
		{name: "unicode trailing dot is removed after IDNA", rawURL: "https://example.com。/v1", wantOrigin: "https://example.com", wantHostname: "example.com"},
		{name: "credentials rejected", rawURL: "https://user:pass@example.com", wantError: true},
		{name: "IP rejected", rawURL: "https://127.0.0.1", wantError: true},
		{name: "localhost rejected", rawURL: "http://localhost:3000", wantError: true},
		{name: "non-http rejected", rawURL: "ftp://example.com", wantError: true},
		{name: "origin longer than indexed limit is rejected", rawURL: "https://" + strings.Repeat("a", 184) + ".com", wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			origin, hostname, err := NormalizeHubProviderOrigin(test.rawURL)
			if test.wantError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, test.wantOrigin, origin)
			assert.Equal(t, test.wantHostname, hostname)
		})
	}
}

func TestHubProviderChannelOriginRequiresClaim(t *testing.T) {
	required, origin, _, err := HubProviderChannelOriginRequiresClaim(
		constant.ChannelTypeOpenAI,
		"https://api.openai.com/v1",
	)
	require.NoError(t, err)
	assert.False(t, required)
	assert.Equal(t, "https://api.openai.com", origin)

	required, _, _, err = HubProviderChannelOriginRequiresClaim(
		constant.ChannelTypeAnthropic,
		"https://api.openai.com/v1",
	)
	require.NoError(t, err)
	assert.False(t, required)

	required, origin, _, err = HubProviderChannelOriginRequiresClaim(
		constant.ChannelTypeOpenAI,
		"https://relay.example/v1",
	)
	require.NoError(t, err)
	assert.True(t, required)
	assert.Equal(t, "https://relay.example", origin)

	required, _, _, err = HubProviderChannelOriginRequiresClaim(
		0,
		"https://resource.openai.azure.com",
	)
	require.NoError(t, err)
	assert.False(t, required)

	for _, rawURL := range []string{
		"http://resource.openai.azure.com",
		"https://resource.openai.azure.com:8443",
	} {
		required, _, _, err = HubProviderChannelOriginRequiresClaim(constant.ChannelTypeAzure, rawURL)
		require.NoError(t, err)
		assert.True(t, required, rawURL)
	}

	required, origin, _, err = HubProviderChannelOriginRequiresClaim(
		constant.ChannelTypeAzure,
		"https://relay.example/v1",
	)
	require.NoError(t, err)
	assert.True(t, required)
	assert.Equal(t, "https://relay.example", origin)
}

func TestGenerateHubProviderOriginVerificationToken(t *testing.T) {
	first, err := GenerateHubProviderOriginVerificationToken()
	require.NoError(t, err)
	second, err := GenerateHubProviderOriginVerificationToken()
	require.NoError(t, err)
	assert.Len(t, first, 48)
	assert.NotEqual(t, first, second)
}

func TestExpiredPendingOriginClaimCanBeReleased(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&HubProviderOriginClaim{}))
	now := int64(2 * HubProviderOriginClaimPendingTTL)
	claim := &HubProviderOriginClaim{
		ProviderId: 1, Origin: "https://relay.example", Hostname: "relay.example",
		VerificationMethod: HubProviderOriginClaimMethodDNS, VerificationToken: "token",
		Status: HubProviderOriginClaimStatusPending,
	}
	require.NoError(t, db.Create(claim).Error)
	require.NoError(t, db.Model(claim).Updates(map[string]any{
		"created_at": now - HubProviderOriginClaimPendingTTL,
		"updated_at": now,
	}).Error)

	require.NoError(t, DeleteExpiredHubProviderOriginClaims(now))
	var count int64
	require.NoError(t, db.Model(&HubProviderOriginClaim{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestHubProviderOriginClaimIsUniqueAcrossProviders(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&HubProviderOriginClaim{}))

	first := &HubProviderOriginClaim{
		ProviderId:         1,
		Origin:             "https://relay.example",
		Hostname:           "relay.example",
		VerificationMethod: HubProviderOriginClaimMethodDNS,
		VerificationToken:  "first-token",
	}
	require.NoError(t, CreateHubProviderOriginClaim(first))

	second := &HubProviderOriginClaim{
		ProviderId:         2,
		Origin:             "https://relay.example",
		Hostname:           "relay.example",
		VerificationMethod: HubProviderOriginClaimMethodHTTP,
		VerificationToken:  "second-token",
	}
	assert.ErrorIs(t, CreateHubProviderOriginClaim(second), ErrHubProviderOriginAlreadyClaimed)
}

func TestMigrateHubProviderOriginClaimsRejectsMultiProviderConflict(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&HubProviderOriginClaim{}, &HubSupplyGroup{}, &Channel{}))
	baseURL := "https://relay.example/v1"
	for providerID := 1; providerID <= 2; providerID++ {
		channel := &Channel{Type: constant.ChannelTypeOpenAI, BaseURL: &baseURL, Name: "relay", Key: "key", Models: "gpt-5"}
		require.NoError(t, db.Create(channel).Error)
		require.NoError(t, db.Create(&HubSupplyGroup{
			PublicId: "supply-" + string(rune('0'+providerID)), ProviderId: providerID,
			NewAPIChannelId: channel.Id, PriceMultiplier: 1, Status: HubSupplyGroupStatusPending,
		}).Error)
	}

	err := migrateHubProviderOriginClaims()
	require.ErrorContains(t, err, "conflicting provider upstream origin claim")
	var claim HubProviderOriginClaim
	require.NoError(t, db.Where("origin = ?", "https://relay.example").First(&claim).Error)
	assert.Equal(t, HubProviderOriginClaimStatusConflict, claim.Status)
	assert.Zero(t, claim.ProviderId)
}

func TestMigrateHubProviderOriginClaimsRejectsMismatchedExistingClaim(t *testing.T) {
	db := useHubSupplyGroupMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&HubProviderOriginClaim{}, &HubSupplyGroup{}, &Channel{}))
	baseURL := "https://relay.example/v1"
	channel := &Channel{Type: constant.ChannelTypeOpenAI, BaseURL: &baseURL, Name: "relay", Key: "key", Models: "gpt-5"}
	require.NoError(t, db.Create(channel).Error)
	require.NoError(t, db.Create(&HubSupplyGroup{
		PublicId: "supply-existing-claim", ProviderId: 1,
		NewAPIChannelId: channel.Id, PriceMultiplier: 1, Status: HubSupplyGroupStatusPending,
	}).Error)
	require.NoError(t, db.Create(&HubProviderOriginClaim{
		ProviderId: 2, Origin: "https://relay.example", Hostname: "relay.example",
		VerificationMethod: HubProviderOriginClaimMethodDNS, VerificationToken: "token",
		Status: HubProviderOriginClaimStatusVerified,
	}).Error)

	err := migrateHubProviderOriginClaims()
	require.ErrorContains(t, err, "conflicting provider upstream origin claim")
	var claim HubProviderOriginClaim
	require.NoError(t, db.Where("origin = ?", "https://relay.example").First(&claim).Error)
	assert.Equal(t, HubProviderOriginClaimStatusConflict, claim.Status)
	assert.Zero(t, claim.ProviderId)
}
