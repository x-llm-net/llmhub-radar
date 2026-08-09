package hub_routing_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveEligibleServiceTiersUsesExclusivePriceBands(t *testing.T) {
	original := *Get()
	t.Cleanup(func() { *Get() = original })
	Get().Enabled = true
	Get().FamilyTierCeilings = cloneFamilyTierCeilings(defaultFamilyTierCeilings)
	Get().HighQualityProviderIDs = nil

	assert.Equal(t, []string{ServiceTierSpecial}, ResolveEligibleServiceTiers("openai", 0.10, 1))
	assert.Equal(t, []string{ServiceTierSpecial}, ResolveEligibleServiceTiers("anthropic", 0.15, 1))
	assert.Equal(t, []string{ServiceTierLow}, ResolveEligibleServiceTiers("openai", 0.25, 1))
	assert.Equal(t, []string{ServiceTierMedium}, ResolveEligibleServiceTiers("openai", 0.50, 1))
	assert.Empty(t, ResolveEligibleServiceTiers("openai", 1.20, 1))
}

func TestResolveEligibleServiceTiersOverlapsApprovedHighQualitySupply(t *testing.T) {
	original := *Get()
	t.Cleanup(func() { *Get() = original })
	Get().Enabled = true
	Get().FamilyTierCeilings = cloneFamilyTierCeilings(defaultFamilyTierCeilings)
	Get().HighQualityProviderIDs = []int{7}

	assert.Equal(t,
		[]string{ServiceTierSpecial, ServiceTierHigh},
		ResolveEligibleServiceTiers("openai", 0.08, 7),
	)
	assert.Equal(t,
		[]string{ServiceTierHigh},
		ResolveEligibleServiceTiers("openai", 0.90, 7),
	)
	assert.Empty(t, ResolveEligibleServiceTiers("openai", 1.20, 7))
}

func TestGetFamilyTierCeilingsNormalizesLegacyHighSentinel(t *testing.T) {
	original := *Get()
	t.Cleanup(func() { *Get() = original })
	Get().FamilyTierCeilings = map[string]FamilyTierCeilings{
		"openai": {Special: 0.10, Low: 0.30, Medium: 0.80, High: 100},
	}

	assert.Equal(t, 1.0, GetFamilyTierCeilings()["openai"].High)
}

func TestValidateOptionTreatsHighAsIndependentGuardrail(t *testing.T) {
	valid := `{"openai":{"special":0.1,"low":0.3,"medium":0.8,"high":0.2}}`
	require.NoError(t, ValidateOption("hub_routing_setting.family_tier_ceilings", valid))

	equalPriceBoundaries := `{"openai":{"special":0.1,"low":0.1,"medium":0.8,"high":1}}`
	assert.Error(t, ValidateOption("hub_routing_setting.family_tier_ceilings", equalPriceBoundaries))
}

func TestResolveEligibleServiceTiersRejectsUnknownFamilyByDefault(t *testing.T) {
	original := *Get()
	t.Cleanup(func() { *Get() = original })
	Get().Enabled = true
	Get().AllowOtherFamily = false

	assert.Empty(t, ResolveEligibleServiceTiers("other", 0.05, 1))
}
