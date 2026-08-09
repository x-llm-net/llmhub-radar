package model

import (
	"errors"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"gorm.io/gorm"
)

var ErrHubRoutingSettingRequiresAtomicSave = errors.New("hub routing settings must be saved as one configuration")

var hubRoutingSettingUpdateLock sync.Mutex

// SaveHubRoutingSetting persists the complete routing configuration and its
// derived abilities in one database transaction. The active runtime snapshot
// is published only after that transaction succeeds.
func SaveHubRoutingSetting(value hub_routing_setting.HubRoutingSetting) error {
	normalized, err := hub_routing_setting.NormalizeAndValidate(value)
	if err != nil {
		return err
	}
	values, err := hub_routing_setting.OptionValues(normalized)
	if err != nil {
		return err
	}
	if DB == nil {
		return errors.New("database is not initialized")
	}

	hubRoutingSettingUpdateLock.Lock()
	defer hubRoutingSettingUpdateLock.Unlock()
	hubSupplyAbilityRefreshLock.Lock()
	defer hubSupplyAbilityRefreshLock.Unlock()

	if err := DB.Transaction(func(tx *gorm.DB) error {
		for _, key := range hub_routing_setting.OptionKeys() {
			if err := tx.Save(&Option{Key: key, Value: values[key]}).Error; err != nil {
				return err
			}
		}
		return refreshHubSupplyAbilitiesWithSetting(tx, &normalized)
	}); err != nil {
		return err
	}

	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	for key, value := range values {
		common.OptionMap[key] = value
	}
	common.OptionMapRWMutex.Unlock()

	if err := hub_routing_setting.Publish(normalized); err != nil {
		return err
	}
	InitChannelCache()
	return nil
}
