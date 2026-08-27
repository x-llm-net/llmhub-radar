/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHydrateHubProviderPublicURLUsesTenantPrimaryDomain(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&Tenant{}, &TenantDomain{}, &HubProvider{}))
	tenant := Tenant{Name: "Custom tenant", Slug: "custom-tenant", Status: TenantStatusActive}
	require.NoError(t, DB.Create(&tenant).Error)
	require.NoError(t, DB.Create(&[]TenantDomain{
		{TenantId: tenant.Id, Host: "secondary.example", VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive},
		{TenantId: tenant.Id, Host: "343246113.xyz", IsPrimary: true, VerificationStatus: TenantDomainVerificationVerified, Status: TenantDomainStatusActive},
	}).Error)
	provider := HubProvider{TenantId: &tenant.Id, Slug: "shared"}

	require.NoError(t, HydrateHubProviderPublicURL(&provider))
	assert.Equal(t, "https://shared.343246113.xyz/", provider.PublicURL)
}
