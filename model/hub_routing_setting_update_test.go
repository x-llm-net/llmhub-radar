package model

import (
	"errors"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func prepareHubRoutingSettingSaveTest(t *testing.T) hub_routing_setting.HubRoutingSetting {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Option{}))
	original := hub_routing_setting.Snapshot()
	values, err := hub_routing_setting.OptionValues(original)
	require.NoError(t, err)
	for key, value := range values {
		require.NoError(t, DB.Save(&Option{Key: key, Value: value}).Error)
	}
	common.OptionMap = make(map[string]string)
	t.Cleanup(func() {
		for _, key := range hub_routing_setting.OptionKeys() {
			DB.Delete(&Option{}, "key = ?", key)
		}
		hub_routing_setting.Publish(original)
	})
	return original
}

func createHubRoutingSaveTestChannel(t *testing.T, channelID int) {
	t.Helper()
	channel := &Channel{
		Id:     channelID,
		Key:    "test-key",
		Status: common.ChannelStatusEnabled,
		Name:   "hub routing save test",
		Models: "gpt-5",
		Group:  "default",
	}
	require.NoError(t, DB.Create(channel).Error)
	require.NoError(t, DB.Create(&HubSupplyGroup{
		PublicId:        "test-public-" + strconv.Itoa(channelID),
		ProviderId:      1,
		NewAPIChannelId: channelID,
		PriceMultiplier: 0.08,
		PublishedModels: "gpt-5",
		ConfigVersion:   1,
		Status:          HubSupplyGroupStatusAvailable,
		LastProbeAt:     1,
	}).Error)
	t.Cleanup(func() {
		DB.Where("channel_id = ?", channelID).Delete(&Ability{})
		DB.Where("new_api_channel_id = ?", channelID).Delete(&HubSupplyGroup{})
		DB.Delete(&Channel{}, channelID)
	})
}

func TestSaveHubRoutingSettingRollsBackWhenAbilityRebuildFails(t *testing.T) {
	original := prepareHubRoutingSettingSaveTest(t)
	channelID := 94001
	createHubRoutingSaveTestChannel(t, channelID)
	require.NoError(t, DB.Create(&Ability{
		Group:     hub_routing_setting.ServiceTierSpecial,
		Model:     "gpt-5",
		ChannelId: channelID,
		Enabled:   true,
	}).Error)

	callbackName := "test_hub_routing_save_ability_failure"
	require.NoError(t, DB.Callback().Delete().Before("gorm:delete").Register(callbackName, func(db *gorm.DB) {
		if db.Statement.Table == "abilities" {
			db.AddError(errors.New("injected ability rebuild failure"))
		}
	}))
	t.Cleanup(func() { DB.Callback().Delete().Remove(callbackName) })

	next := original
	next.HighQualityProviderIDs = []int{2}
	err := SaveHubRoutingSetting(next)
	require.Error(t, err)

	var option Option
	require.NoError(t, DB.First(&option, "key = ?", hub_routing_setting.OptionKeyHighQualityProviderIDs).Error)
	assert.Equal(t, "[1]", option.Value)
	assert.Equal(t, original, hub_routing_setting.Snapshot())
	var ability Ability
	require.NoError(t, DB.First(&ability, "channel_id = ?", channelID).Error)
	assert.Equal(t, hub_routing_setting.ServiceTierSpecial, ability.Group)
}

func TestSaveHubRoutingSettingRebuildsAbilitiesOnce(t *testing.T) {
	original := prepareHubRoutingSettingSaveTest(t)
	createHubRoutingSaveTestChannel(t, 94002)
	createHubRoutingSaveTestChannel(t, 94003)

	var deleteCount int32
	callbackName := "test_hub_routing_save_ability_count"
	require.NoError(t, DB.Callback().Delete().Before("gorm:delete").Register(callbackName, func(db *gorm.DB) {
		if db.Statement.Table == "abilities" {
			atomic.AddInt32(&deleteCount, 1)
		}
	}))
	t.Cleanup(func() { DB.Callback().Delete().Remove(callbackName) })

	next := original
	next.AllowOtherFamily = true
	require.NoError(t, SaveHubRoutingSetting(next))

	assert.Equal(t, int32(2), atomic.LoadInt32(&deleteCount))
	assert.Equal(t, next, hub_routing_setting.Snapshot())
}
