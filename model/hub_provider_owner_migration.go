/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
package model

const (
	hubProviderLegacyOwnerIndexName = "idx_hub_provider_owner_slot"
	hubProviderTenantOwnerIndexName = "idx_hub_provider_tenant_owner"
)

func migrateHubProviderOwnerConstraint() error {
	if !DB.Migrator().HasTable(&HubProvider{}) {
		return nil
	}
	if DB.Migrator().HasIndex(&HubProvider{}, hubProviderLegacyOwnerIndexName) {
		if err := DB.Migrator().DropIndex(&HubProvider{}, hubProviderLegacyOwnerIndexName); err != nil {
			return err
		}
	}
	if DB.Migrator().HasIndex(&HubProvider{}, hubProviderTenantOwnerIndexName) {
		return nil
	}
	return DB.Migrator().CreateIndex(&HubProvider{}, hubProviderTenantOwnerIndexName)
}
