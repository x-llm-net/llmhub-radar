package service

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPrepareBillingForSelectedChannelReservesHigherSupplyPrice(t *testing.T) {
	billing := &recordingBillingSettler{preConsumedQuota: 200}
	info := &relaycommon.RelayInfo{
		Billing: billing,
		PriceData: types.PriceData{
			QuotaBeforeGroup: 1000,
			GroupRatioInfo: types.GroupRatioInfo{
				GroupRatio:       0.4,
				BaseGroupRatio:   1,
				SupplyMultiplier: 0.4,
				HasSupplyPricing: true,
			},
		},
	}

	require.Nil(t, PrepareBillingForSelectedChannel(nil, info))
	assert.Equal(t, []int{400}, billing.reserveTargets)
	assert.Equal(t, 400, info.FinalPreConsumedQuota)
	assert.Equal(t, 400, info.PriceData.QuotaToPreConsume)
}

func TestPrepareBillingForSelectedChannelUsesFinalRetryChannelPricing(t *testing.T) {
	billing := &recordingBillingSettler{preConsumedQuota: 200}
	info := &relaycommon.RelayInfo{
		Billing: billing,
		PriceData: types.PriceData{
			QuotaBeforeGroup: 1000,
			GroupRatioInfo: types.GroupRatioInfo{
				GroupRatio:       0.4,
				BaseGroupRatio:   1,
				SupplyMultiplier: 0.4,
				HasSupplyPricing: true,
				SupplyGroupId:    10,
				SupplyProviderId: 20,
			},
		},
	}

	require.Nil(t, PrepareBillingForSelectedChannel(nil, info))
	info.PriceData.GroupRatioInfo = types.GroupRatioInfo{
		GroupRatio:       0.9,
		BaseGroupRatio:   1,
		SupplyMultiplier: 0.9,
		HasSupplyPricing: true,
		SupplyGroupId:    11,
		SupplyProviderId: 21,
	}
	require.Nil(t, PrepareBillingForSelectedChannel(nil, info))

	assert.Equal(t, []int{400, 900}, billing.reserveTargets)
	assert.Equal(t, 900, info.FinalPreConsumedQuota)
	assert.Equal(t, 900, info.PriceData.QuotaToPreConsume)
	other := map[string]interface{}{}
	appendBillingInfo(info, other)
	assert.Equal(t, 0.9, other["supply_multiplier"])
	assert.Equal(t, 0.9, other["billing_ratio"])
	assert.Equal(t, 11, other["hub_supply_group_id"])
	assert.Equal(t, 21, other["hub_provider_id"])
}

func TestAppendBillingInfoSeparatesConsumerAndSupplyRatios(t *testing.T) {
	info := &relaycommon.RelayInfo{
		PriceData: types.PriceData{
			GroupRatioInfo: types.GroupRatioInfo{
				GroupRatio:       0.6,
				BaseGroupRatio:   1.5,
				SupplyMultiplier: 0.4,
				HasSupplyPricing: true,
				SupplyGroupId:    12,
				SupplyProviderId: 7,
			},
		},
	}
	other := map[string]interface{}{"group_ratio": 0.6}

	appendBillingInfo(info, other)

	assert.Equal(t, 1.5, other["group_ratio"])
	assert.Equal(t, 0.4, other["supply_multiplier"])
	assert.Equal(t, 0.6, other["billing_ratio"])
	assert.Equal(t, 12, other["hub_supply_group_id"])
	assert.Equal(t, 7, other["hub_provider_id"])
}
