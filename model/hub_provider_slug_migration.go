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
	"fmt"
	"strconv"
)

const (
	hubProviderLegacySlugIndexName = "idx_hub_providers_slug"
	hubProviderTenantSlugIndexName = "idx_hub_provider_tenant_slug"
	hubProviderSlugIndexName       = "idx_hub_provider_slug"
	hubProviderNameIndexName       = "idx_hub_provider_name_key"
)

func migrateHubProviderSlugs() error {
	providers := make([]HubProvider, 0)
	if err := DB.Select("id", "name", "name_key", "slug", "slug_base").Order("id ASC").Find(&providers).Error; err != nil {
		return err
	}

	usedNames := make(map[string]int, len(providers))
	usedSlugs := make(map[string]int, len(providers))
	for i := range providers {
		provider := &providers[i]
		nameKey := normalizeHubProviderNameKey(provider.Name)
		if existingID, duplicate := usedNames[nameKey]; duplicate {
			return fmt.Errorf("hub provider name %q is used by providers %d and %d", provider.Name, existingID, provider.Id)
		}
		usedNames[nameKey] = provider.Id

		slug, err := NormalizeHubProviderSlug(provider.Slug)
		if err != nil {
			slug = hubProviderSlugFromName(provider.Name)
			baseSlug := slug
			for attempt := 0; ; attempt++ {
				if _, duplicate := usedSlugs[slug]; !duplicate {
					break
				}
				slug = hubProviderSlugWithSuffix(baseSlug, strconv.Itoa(provider.Id+attempt))
			}
		} else if existingID, duplicate := usedSlugs[slug]; duplicate {
			return fmt.Errorf("hub provider slug %q is used by providers %d and %d", slug, existingID, provider.Id)
		}
		usedSlugs[slug] = provider.Id

		updates := make(map[string]any, 3)
		if provider.NameKey != nameKey {
			updates["name_key"] = nameKey
		}
		if provider.Slug != slug {
			updates["slug"] = slug
		}
		if provider.SlugBase == "" {
			updates["slug_base"] = slug
		}
		if len(updates) == 0 {
			continue
		}
		if err := DB.Model(&HubProvider{}).Where("id = ?", provider.Id).Updates(updates).Error; err != nil {
			return err
		}
	}

	for _, indexName := range []string{hubProviderLegacySlugIndexName, hubProviderTenantSlugIndexName} {
		if DB.Migrator().HasIndex(&HubProvider{}, indexName) {
			if err := DB.Migrator().DropIndex(&HubProvider{}, indexName); err != nil {
				return err
			}
		}
	}
	if !DB.Migrator().HasIndex(&HubProvider{}, hubProviderSlugIndexName) {
		if err := DB.Exec("CREATE UNIQUE INDEX " + hubProviderSlugIndexName + " ON hub_providers (slug)").Error; err != nil {
			return err
		}
	}
	if !DB.Migrator().HasIndex(&HubProvider{}, hubProviderNameIndexName) {
		if err := DB.Exec("CREATE UNIQUE INDEX " + hubProviderNameIndexName + " ON hub_providers (name_key)").Error; err != nil {
			return err
		}
	}
	return nil
}
