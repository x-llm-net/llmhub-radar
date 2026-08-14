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
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/hub_provider_setting"
)

func isAzureManagedHostname(hostname string) bool {
	hostname = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(hostname), "."))
	for _, suffix := range []string{
		".openai.azure.com",
		".cognitiveservices.azure.com",
		".services.ai.azure.com",
	} {
		if strings.HasSuffix(hostname, suffix) && len(hostname) > len(suffix) {
			return true
		}
	}
	return false
}

func HubProviderChannelOriginRequiresClaim(_ int, rawURL string) (bool, string, string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return false, "", "", nil
	}
	if _, isPreset := constant.ChannelSpecialBases[rawURL]; isPreset {
		return false, "", "", nil
	}
	origin, hostname, err := NormalizeHubProviderOrigin(rawURL)
	if err != nil {
		return false, "", "", err
	}
	for _, defaultURL := range constant.ChannelBaseURLs {
		defaultURL = strings.TrimSpace(defaultURL)
		if defaultURL == "" {
			continue
		}
		defaultOrigin, _, defaultErr := NormalizeHubProviderOrigin(defaultURL)
		if defaultErr == nil && defaultOrigin == origin {
			return false, origin, hostname, nil
		}
	}
	if isAzureManagedHostname(hostname) && origin == "https://"+hostname {
		return false, origin, hostname, nil
	}
	return true, origin, hostname, nil
}

func migrateHubProviderOriginClaims() error {
	verificationEnabled := hub_provider_setting.IsOriginVerificationEnabled()
	if DB.Migrator().HasTable(&Option{}) {
		var option Option
		result := DB.Where(commonKeyCol+" = ?", "hub_provider_setting.origin_verification_enabled").Limit(1).Find(&option)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected > 0 {
			if parsed, parseErr := strconv.ParseBool(strings.TrimSpace(option.Value)); parseErr == nil {
				verificationEnabled = parsed
			}
		}
	}
	if !verificationEnabled {
		return nil
	}
	if !DB.Migrator().HasTable(&HubProviderOriginClaim{}) || !DB.Migrator().HasTable(&HubSupplyGroup{}) || !DB.Migrator().HasTable(&Channel{}) {
		return nil
	}
	type existingSupplyOrigin struct {
		ProviderId  int     `gorm:"column:provider_id"`
		ChannelType int     `gorm:"column:channel_type"`
		BaseURL     *string `gorm:"column:base_url"`
	}
	rows := make([]existingSupplyOrigin, 0)
	if err := DB.Table("hub_supply_groups AS supply_groups").
		Select("supply_groups.provider_id, channels.type AS channel_type, channels.base_url").
		Joins("JOIN channels ON channels.id = supply_groups.new_api_channel_id").
		Scan(&rows).Error; err != nil {
		return err
	}
	providersByOrigin := make(map[string]map[int]struct{})
	hostnameByOrigin := make(map[string]string)
	for _, row := range rows {
		baseURL := ""
		if row.BaseURL != nil {
			baseURL = *row.BaseURL
		}
		required, origin, hostname, err := HubProviderChannelOriginRequiresClaim(row.ChannelType, baseURL)
		if err != nil || !required {
			continue
		}
		if providersByOrigin[origin] == nil {
			providersByOrigin[origin] = make(map[int]struct{})
		}
		providersByOrigin[origin][row.ProviderId] = struct{}{}
		hostnameByOrigin[origin] = hostname
	}
	for origin, providerIDs := range providersByOrigin {
		existing, err := GetHubProviderOriginClaimByOrigin(origin)
		if err != nil {
			return err
		}
		if existing != nil {
			legacyProviderID := 0
			if len(providerIDs) == 1 {
				for providerID := range providerIDs {
					legacyProviderID = providerID
				}
			}
			if len(providerIDs) == 1 && existing.ProviderId == legacyProviderID && existing.Status == HubProviderOriginClaimStatusVerified {
				continue
			}
			if err := DB.Model(&HubProviderOriginClaim{}).Where("id = ?", existing.Id).Updates(map[string]any{
				"provider_id": 0,
				"status":      HubProviderOriginClaimStatusConflict,
				"last_error":  "existing origin claim does not match legacy provider supply ownership",
				"verified_at": 0,
				"updated_at":  common.GetTimestamp(),
			}).Error; err != nil {
				return err
			}
			continue
		}
		token, err := GenerateHubProviderOriginVerificationToken()
		if err != nil {
			return err
		}
		claim := HubProviderOriginClaim{
			Origin:             origin,
			Hostname:           hostnameByOrigin[origin],
			VerificationMethod: HubProviderOriginClaimMethodLegacy,
			VerificationToken:  "legacy-" + token,
			Status:             HubProviderOriginClaimStatusVerified,
			VerifiedAt:         common.GetTimestamp(),
		}
		if len(providerIDs) == 1 {
			for providerID := range providerIDs {
				claim.ProviderId = providerID
			}
		} else {
			claim.Status = HubProviderOriginClaimStatusConflict
			claim.LastError = "multiple existing providers use this upstream origin"
			claim.VerifiedAt = 0
		}
		if err := DB.Create(&claim).Error; err != nil {
			return err
		}
	}
	var conflictCount int64
	if err := DB.Model(&HubProviderOriginClaim{}).
		Where("status = ?", HubProviderOriginClaimStatusConflict).
		Count(&conflictCount).Error; err != nil {
		return err
	}
	if conflictCount > 0 {
		return fmt.Errorf("found %d conflicting provider upstream origin claim(s); resolve them before startup", conflictCount)
	}
	return nil
}
