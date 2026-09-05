package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withTieredBillingConfigForModelTest(t *testing.T, modelName, expr string) {
	t.Helper()

	originalModes := billing_setting.GetBillingModeCopy()
	originalExprs := billing_setting.GetBillingExprCopy()
	apply := func(modes map[string]string, exprs map[string]string) {
		modeBytes, err := common.Marshal(modes)
		require.NoError(t, err)
		exprBytes, err := common.Marshal(exprs)
		require.NoError(t, err)
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
			"billing_setting.billing_mode": string(modeBytes),
			"billing_setting.billing_expr": string(exprBytes),
		}))
	}

	modes := originalModes
	modes[modelName] = billing_setting.BillingModeTieredExpr
	exprs := originalExprs
	exprs[modelName] = expr
	apply(modes, exprs)
	t.Cleanup(func() { apply(originalModes, originalExprs) })
}

func TestHasModelBillingConfigRecognizesTieredExpr(t *testing.T) {
	const modelName = "tiered-billing-config-test"
	withTieredBillingConfigForModelTest(t, modelName, `tier("base", p * 2 + c * 8)`)

	assert.True(t, HasModelBillingConfig(modelName))
}

func TestBuildChannelAbilitiesAcceptsTieredExprSupplyModel(t *testing.T) {
	const modelName = "tiered-hub-supply-test"
	truncateTables(t)
	withTieredBillingConfigForModelTest(t, modelName, `len <= 272000 ? tier("standard", p * 10 + c * 50) : tier("long_context", p * 20 + c * 75)`)

	channel := &Channel{
		Name:   "tiered-expression-supply",
		Type:   constant.ChannelTypeOpenAI,
		Status: common.ChannelStatusEnabled,
		Models: modelName,
		Group:  "default",
	}
	require.NoError(t, DB.Create(channel).Error)

	group := &HubSupplyGroup{
		ProviderId:      1,
		NewAPIChannelId: channel.Id,
		PriceMultiplier: 0.4,
		PublishedModels: modelName,
		ConfigVersion:   1,
		Status:          HubSupplyGroupStatusAvailable,
	}
	require.NoError(t, DB.Create(group).Error)
	require.NoError(t, DB.Create(&HubSupplyGroupProbeTarget{
		GroupId:       group.Id,
		ConfigVersion: group.ConfigVersion,
		ModelName:     modelName,
		EndpointType:  string(constant.EndpointTypeOpenAI),
		ProbeKind:     HubSupplyProbeKindText,
		Status:        HubSupplyProbeStatusAvailable,
	}).Error)

	require.NoError(t, channel.UpdateAbilities(nil))

	var abilities []Ability
	require.NoError(t, DB.Where("channel_id = ? AND model = ? AND enabled = ?", channel.Id, modelName, true).Find(&abilities).Error)
	require.NotEmpty(t, abilities)
	foundRoutingAbility := false
	for _, ability := range abilities {
		if ability.Group == HubTokenRoutingAbilityGroup && ability.Model == modelName && ability.ChannelId == channel.Id && ability.Enabled {
			foundRoutingAbility = true
			break
		}
	}
	assert.True(t, foundRoutingAbility)
}
