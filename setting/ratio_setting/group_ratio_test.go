package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestServiceTierGroupRatiosAreAlwaysOne(t *testing.T) {
	original := GroupRatio2JSONString()
	t.Cleanup(func() { _ = UpdateGroupRatioByJSONString(original) })

	assert.NoError(t, UpdateGroupRatioByJSONString(`{"special": 9, "low": 8, "medium": 7, "high": 6, "default": 2}`))
	for _, tier := range []string{"special", "low", "medium", "high"} {
		assert.True(t, ContainsGroupRatio(tier))
		assert.Equal(t, float64(1), GetGroupRatio(tier))
	}
	assert.Equal(t, 2.0, GetGroupRatio("default"))
}
