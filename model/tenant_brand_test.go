package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTenantBrandConfigRoundTripAndMalformedFallback(t *testing.T) {
	encoded, err := EncodeTenantBrandConfig(TenantBrandConfig{
		Name:    "Brand A",
		LogoURL: "https://brand-a.example/logo.png",
		BusinessContact: BusinessContact{
			Name: "Sales", Type: "email", Value: "sales@example.com", Description: "Weekdays",
		},
	})
	require.NoError(t, err)

	tenant := Tenant{BrandConfig: encoded}
	assert.Equal(t, TenantBrandConfig{
		Name:    "Brand A",
		LogoURL: "https://brand-a.example/logo.png",
		BusinessContact: BusinessContact{
			Name: "Sales", Type: "email", Value: "sales@example.com", Description: "Weekdays",
		},
	}, tenant.Brand())

	tenant.BrandConfig = "not-json"
	assert.Equal(t, TenantBrandConfig{}, tenant.Brand())
}
