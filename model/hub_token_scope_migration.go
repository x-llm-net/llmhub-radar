package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// migrateHubTokenScopes preserves the management ownership of tokens created
// before token scopes were persisted. Provider policies are authoritative;
// public-pool tokens fall back to the configured platform root tenant.
func migrateHubTokenScopes() error {
	var rows []struct {
		ID               int    `gorm:"column:id"`
		HubRoutingPolicy string `gorm:"column:hub_routing_policy"`
	}
	if err := DB.Table("tokens").
		Select("id", "hub_routing_policy").
		Where("hub_tenant_id = 0 AND hub_provider_id = 0").
		Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}

	rootTenantID, err := hubRootTenantID()
	if err != nil {
		return err
	}
	for _, row := range rows {
		scope, ok, err := hubTokenScopeFromLegacyPolicy(row.HubRoutingPolicy)
		if err != nil {
			common.SysLog("failed to parse legacy token routing policy: " + err.Error())
			continue
		}
		if !ok {
			if rootTenantID <= 0 {
				continue
			}
			scope = HubTokenScope{TenantID: rootTenantID}
		}
		if err := DB.Model(&Token{}).Where("id = ?", row.ID).Updates(map[string]any{
			"hub_tenant_id":   scope.TenantID,
			"hub_provider_id": scope.ProviderID,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

func hubRootTenantID() (int, error) {
	var domain TenantDomain
	err := DB.Where("host = ?", HubProviderRootDomain()).First(&domain).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return domain.TenantId, nil
}

func hubTokenScopeFromLegacyPolicy(rawPolicy string) (HubTokenScope, bool, error) {
	if rawPolicy == "" {
		return HubTokenScope{}, false, nil
	}
	var policy HubTokenRoutingPolicy
	if err := common.UnmarshalJsonStr(rawPolicy, &policy); err != nil {
		return HubTokenScope{}, false, err
	}
	if policy.Mode != HubTokenRoutingModeProvider || policy.ProviderID <= 0 {
		return HubTokenScope{}, false, nil
	}
	provider, err := GetHubProviderByID(policy.ProviderID)
	if err != nil {
		return HubTokenScope{}, false, err
	}
	if provider == nil || provider.TenantId == nil {
		return HubTokenScope{}, false, nil
	}
	return HubTokenScope{TenantID: *provider.TenantId, ProviderID: provider.Id}, true, nil
}
