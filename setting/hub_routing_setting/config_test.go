package hub_routing_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestResolveServiceTierUsesFamilyBoundariesAndHighApproval(t *testing.T) {
	original := *Get()
	t.Cleanup(func() { *Get() = original })
	Get().Enabled = true
	Get().FamilyTierCeilings = cloneFamilyTierCeilings(defaultFamilyTierCeilings)
	Get().HighQualityProviderIDs = []int{7}

	tier, ok := ResolveServiceTier("openai", 0.10, 1)
	assert.True(t, ok)
	assert.Equal(t, ServiceTierSpecial, tier)

	tier, ok = ResolveServiceTier("anthropic", 0.15, 1)
	assert.True(t, ok)
	assert.Equal(t, ServiceTierSpecial, tier)

	tier, ok = ResolveServiceTier("openai", 0.50, 1)
	assert.True(t, ok)
	assert.Equal(t, ServiceTierMedium, tier)

	_, ok = ResolveServiceTier("openai", 1.20, 1)
	assert.False(t, ok)
	tier, ok = ResolveServiceTier("openai", 1.20, 7)
	assert.True(t, ok)
	assert.Equal(t, ServiceTierHigh, tier)
}

func TestResolveServiceTierRejectsUnknownFamilyByDefault(t *testing.T) {
	original := *Get()
	t.Cleanup(func() { *Get() = original })
	Get().Enabled = true
	Get().AllowOtherFamily = false

	_, ok := ResolveServiceTier("other", 0.05, 1)
	assert.False(t, ok)
}
