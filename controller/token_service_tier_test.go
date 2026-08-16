package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func configureTokenServiceTierRouting(t *testing.T, enabled bool) {
	t.Helper()
	original := hub_routing_setting.Snapshot()
	updated := original
	updated.Enabled = enabled
	require.NoError(t, hub_routing_setting.Publish(updated))
	t.Cleanup(func() {
		require.NoError(t, hub_routing_setting.Publish(original))
	})
}

func serviceTierTokenRequest(name, group string) map[string]any {
	return map[string]any{
		"name":              name,
		"expired_time":      -1,
		"remain_quota":      0,
		"unlimited_quota":   true,
		"group":             group,
		"cross_group_retry": true,
	}
}

func TestAddTokenRequiresMultiplierPolicyWhenRoutingEnabled(t *testing.T) {
	tests := []struct {
		name  string
		group string
	}{
		{name: "special", group: hub_routing_setting.ServiceTierSpecial},
		{name: "low", group: hub_routing_setting.ServiceTierLow},
		{name: "medium", group: hub_routing_setting.ServiceTierMedium},
		{name: "high", group: hub_routing_setting.ServiceTierHigh},
		{name: "auto", group: "auto"},
		{name: "default", group: "default"},
		{name: "empty", group: ""},
		{name: "arbitrary", group: "custom"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupTokenControllerTestDB(t)
			configureTokenServiceTierRouting(t, true)
			ctx, recorder := newAuthenticatedContext(
				t,
				http.MethodPost,
				"/api/token/",
				serviceTierTokenRequest("create-"+test.name, test.group),
				1,
			)

			AddToken(ctx)

			response := decodeAPIResponse(t, recorder)
			assert.False(t, response.Success, response.Message)
			var count int64
			require.NoError(t, model.DB.Model(&model.Token{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestUpdateTokenRejectsLegacyGroupWhenRoutingEnabled(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	configureTokenServiceTierRouting(t, true)
	token := seedToken(t, db, 1, "legacy-token", "legacy-token-key")
	request := serviceTierTokenRequest("rejected-update", "default")
	request["id"] = token.Id
	request["status"] = common.TokenStatusEnabled
	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", request, 1)

	UpdateToken(ctx)

	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	var unchanged model.Token
	require.NoError(t, db.First(&unchanged, token.Id).Error)
	assert.Equal(t, "legacy-token", unchanged.Name)
	assert.Equal(t, "default", unchanged.Group)

	request = serviceTierTokenRequest("valid-update", hub_routing_setting.ServiceTierLow)
	request["id"] = token.Id
	request["status"] = common.TokenStatusEnabled
	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/token/", request, 1)

	UpdateToken(ctx)

	require.True(t, decodeAPIResponse(t, recorder).Success)
	var updated model.Token
	require.NoError(t, db.First(&updated, token.Id).Error)
	assert.Equal(t, "valid-update", updated.Name)
	assert.Equal(t, hub_routing_setting.ServiceTierLow, updated.Group)
}

func TestUpdateTokenStatusOnlyPreservesLegacyGroupWhenRoutingEnabled(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	configureTokenServiceTierRouting(t, true)
	token := seedToken(t, db, 1, "legacy-token", "legacy-status-key")
	request := serviceTierTokenRequest("ignored", "default")
	request["id"] = token.Id
	request["status"] = common.TokenStatusDisabled
	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/?status_only=true", request, 1)

	UpdateToken(ctx)

	require.True(t, decodeAPIResponse(t, recorder).Success)
	var updated model.Token
	require.NoError(t, db.First(&updated, token.Id).Error)
	assert.Equal(t, common.TokenStatusDisabled, updated.Status)
	assert.Equal(t, "legacy-token", updated.Name)
	assert.Equal(t, "default", updated.Group)
}

func TestTokenWritesPreserveLegacyGroupsWhenRoutingDisabled(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	configureTokenServiceTierRouting(t, false)
	ctx, recorder := newAuthenticatedContext(
		t,
		http.MethodPost,
		"/api/token/",
		serviceTierTokenRequest("legacy-create", "custom"),
		1,
	)

	AddToken(ctx)

	require.True(t, decodeAPIResponse(t, recorder).Success)
	var token model.Token
	require.NoError(t, db.First(&token).Error)
	assert.Equal(t, "custom", token.Group)

	request := serviceTierTokenRequest("legacy-update", "default")
	request["id"] = token.Id
	request["status"] = common.TokenStatusEnabled
	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/token/", request, 1)
	UpdateToken(ctx)

	require.True(t, decodeAPIResponse(t, recorder).Success)
	var updated model.Token
	require.NoError(t, db.First(&updated, token.Id).Error)
	assert.Equal(t, "default", updated.Group)
}
