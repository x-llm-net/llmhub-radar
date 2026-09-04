package controller

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFilterPricingKeepsPublicHubRoutingModel(t *testing.T) {
	pricing := []model.Pricing{
		{
			ModelName:  "gemini-3.8-flash",
			HubRouting: true,
		},
		{
			ModelName:   "legacy-group-model",
			EnableGroup: []string{"premium"},
		},
	}

	filtered := filterPricingByUsableGroups(pricing, map[string]string{"default": "Default"})

	require.Len(t, filtered, 1)
	assert.Equal(t, "gemini-3.8-flash", filtered[0].ModelName)

	encoded, err := json.Marshal(filtered[0])
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "hub-routing")
}
