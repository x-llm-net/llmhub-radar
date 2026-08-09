package middleware

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSystemPerformanceCheckAllowsRequestsWhenProtectionIsDisabled(t *testing.T) {
	config := common.PerformanceMonitorConfig{
		Enabled:         false,
		CPUThreshold:    90,
		MemoryThreshold: 90,
		DiskThreshold:   90,
	}
	status := common.SystemStatus{
		CPUUsage:    100,
		MemoryUsage: 100,
		DiskUsage:   100,
	}

	assert.Nil(t, checkSystemPerformanceStatus(config, status))
}

func TestSystemPerformanceCheckRejectsRequestsWhenEnabledThresholdIsExceeded(t *testing.T) {
	config := common.PerformanceMonitorConfig{
		Enabled:         true,
		CPUThreshold:    0,
		MemoryThreshold: 90,
		DiskThreshold:   0,
	}
	status := common.SystemStatus{MemoryUsage: 95}

	err := checkSystemPerformanceStatus(config, status)
	require.NotNil(t, err)
	assert.Equal(t, http.StatusServiceUnavailable, err.StatusCode)
	assert.Equal(t, "system_memory_overloaded", string(err.GetErrorCode()))
}
