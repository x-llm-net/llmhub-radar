package model

import "fmt"

// migrateHubSupplyGroupLegacyColumns removes fields retired when supply groups
// became one-to-one Channel extensions. AutoMigrate adds the replacement
// columns first, so legacy publication data can be preserved before cleanup.
func migrateHubSupplyGroupLegacyColumns() error {
	if DB == nil || !DB.Migrator().HasTable(&HubSupplyGroup{}) {
		return nil
	}

	if DB.Migrator().HasColumn(&HubSupplyGroup{}, "models") {
		if err := DB.Exec(`
			UPDATE hub_supply_groups
			SET published_models = models
			WHERE (published_models IS NULL OR published_models = '')
			  AND models IS NOT NULL
			  AND models <> ''
		`).Error; err != nil {
			return fmt.Errorf("migrate legacy hub supply models: %w", err)
		}
		if err := DB.Migrator().DropColumn(&HubSupplyGroup{}, "models"); err != nil {
			return fmt.Errorf("drop legacy hub supply models column: %w", err)
		}
	}

	if DB.Migrator().HasColumn(&HubSupplyGroup{}, "name") {
		if err := DB.Migrator().DropColumn(&HubSupplyGroup{}, "name"); err != nil {
			return fmt.Errorf("drop legacy hub supply name column: %w", err)
		}
	}

	return nil
}
