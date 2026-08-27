/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
package model

import (
	"sort"
	"strings"
)

func buildHubProviderPublicURL(slug, tenantDomain string) string {
	slug = strings.TrimSpace(strings.ToLower(slug))
	tenantDomain = strings.TrimSpace(strings.ToLower(tenantDomain))
	if slug == "" || tenantDomain == "" {
		return ""
	}
	return "https://" + slug + "." + tenantDomain + "/"
}

func loadPrimaryTenantDomainHosts(tenantIDs []int) (map[int]string, error) {
	hosts := make(map[int]string)
	if len(tenantIDs) == 0 || DB == nil || !DB.Migrator().HasTable(&TenantDomain{}) {
		return hosts, nil
	}
	sort.Ints(tenantIDs)
	uniqueIDs := tenantIDs[:0]
	for _, tenantID := range tenantIDs {
		if tenantID <= 0 || (len(uniqueIDs) > 0 && uniqueIDs[len(uniqueIDs)-1] == tenantID) {
			continue
		}
		uniqueIDs = append(uniqueIDs, tenantID)
	}
	if len(uniqueIDs) == 0 {
		return hosts, nil
	}

	domains := make([]TenantDomain, 0)
	if err := DB.Where(
		"tenant_id IN ? AND verification_status = ? AND status = ?",
		uniqueIDs, TenantDomainVerificationVerified, TenantDomainStatusActive,
	).Order("tenant_id ASC, is_primary DESC, id ASC").Find(&domains).Error; err != nil {
		return nil, err
	}
	for _, domain := range domains {
		if _, found := hosts[domain.TenantId]; !found {
			hosts[domain.TenantId] = domain.Host
		}
	}
	return hosts, nil
}

func hydrateHubProvidersPublicURLs(providers []HubProvider) error {
	tenantIDs := make([]int, 0, len(providers))
	for i := range providers {
		if providers[i].TenantId != nil {
			tenantIDs = append(tenantIDs, *providers[i].TenantId)
		}
	}
	hosts, err := loadPrimaryTenantDomainHosts(tenantIDs)
	if err != nil {
		return err
	}
	for i := range providers {
		domain := HubProviderRootDomain()
		if providers[i].TenantId != nil {
			domain = hosts[*providers[i].TenantId]
		}
		providers[i].PublicURL = buildHubProviderPublicURL(providers[i].Slug, domain)
	}
	return nil
}

func hydrateHubProviderAdminPublicURLs(providers []HubProviderAdminListItem) error {
	tenantIDs := make([]int, 0, len(providers))
	for i := range providers {
		if providers[i].TenantId != nil {
			tenantIDs = append(tenantIDs, *providers[i].TenantId)
		}
	}
	hosts, err := loadPrimaryTenantDomainHosts(tenantIDs)
	if err != nil {
		return err
	}
	for i := range providers {
		domain := HubProviderRootDomain()
		if providers[i].TenantId != nil {
			domain = hosts[*providers[i].TenantId]
		}
		providers[i].PublicURL = buildHubProviderPublicURL(providers[i].Slug, domain)
	}
	return nil
}

func HydrateHubProviderPublicURL(provider *HubProvider) error {
	if provider == nil {
		return nil
	}
	providers := []HubProvider{*provider}
	if err := hydrateHubProvidersPublicURLs(providers); err != nil {
		return err
	}
	provider.PublicURL = providers[0].PublicURL
	return nil
}

func hubProviderPublicAssetURL(provider HubProvider, path string) string {
	if provider.TenantId == nil || provider.PublicURL == "" {
		return path
	}
	return strings.TrimSuffix(provider.PublicURL, "/") + path
}
