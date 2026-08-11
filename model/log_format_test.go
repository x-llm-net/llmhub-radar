package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/require"
)

// TestFormatUserLogsStripsAdminOnlyDetails verifies routing and diagnostic
// details are removed from non-admin log responses.
func TestFormatUserLogsStripsAdminOnlyDetails(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"model_price": 0.004,
		"admin_info": map[string]interface{}{
			"quota_saturation": map[string]interface{}{
				"op":      "QuotaFromDecimal",
				"kind":    "overflow",
				"clamped": common.MaxQuota,
			},
		},
		"audit_info": map[string]interface{}{
			"operator_id": 1,
		},
		"hub_attempts": []map[string]interface{}{
			{
				"provider_id": 2,
				"channel_id":  3,
				"result":      "failed",
			},
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	_, hasAdminInfo := parsed["admin_info"]
	require.False(t, hasAdminInfo, "admin_info (and nested quota_saturation) must be stripped for non-admin views")
	_, hasAuditInfo := parsed["audit_info"]
	require.False(t, hasAuditInfo, "audit_info must be stripped for non-admin views")
	_, hasHubAttempts := parsed["hub_attempts"]
	require.False(t, hasHubAttempts, "hub_attempts must be stripped for non-admin views")
	// Non-admin billing fields remain visible.
	require.Contains(t, parsed, "model_price")
}
