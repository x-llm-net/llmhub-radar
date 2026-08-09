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
	"strconv"
)

const hubProviderSlugIndexName = "idx_hub_providers_slug"

func migrateHubProviderSlugs() error {
	providers := make([]HubProvider, 0)
	if err := DB.Select("id", "name", "slug").Order("id ASC").Find(&providers).Error; err != nil {
		return err
	}

	used := make(map[string]struct{}, len(providers))
	for i := range providers {
		provider := &providers[i]
		slug, err := NormalizeHubProviderSlug(provider.Slug)
		if err != nil {
			slug = hubProviderSlugFromName(provider.Name)
		}
		baseSlug := slug
		for attempt := 0; ; attempt++ {
			if _, duplicate := used[slug]; !duplicate {
				break
			}
			slug = hubProviderSlugWithSuffix(baseSlug, strconv.Itoa(provider.Id+attempt))
		}
		used[slug] = struct{}{}
		if provider.Slug == slug {
			continue
		}
		if err := DB.Model(&HubProvider{}).Where("id = ?", provider.Id).Update("slug", slug).Error; err != nil {
			return err
		}
	}

	if DB.Migrator().HasIndex(&HubProvider{}, hubProviderSlugIndexName) {
		return nil
	}
	return DB.Exec("CREATE UNIQUE INDEX " + hubProviderSlugIndexName + " ON hub_providers (slug)").Error
}
