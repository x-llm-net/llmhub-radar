package performance_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
)

func TestPerformanceProtectionIsDisabledByDefault(t *testing.T) {
	assert.False(t, GetPerformanceSetting().MonitorEnabled)
	assert.False(t, common.GetPerformanceMonitorConfig().Enabled)
}
