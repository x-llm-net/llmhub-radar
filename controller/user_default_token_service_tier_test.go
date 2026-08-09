package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func configureDefaultTokenRegistration(t *testing.T, routingEnabled, defaultAuto bool) {
	t.Helper()
	originalRoutingSetting := hub_routing_setting.Snapshot()
	updatedRoutingSetting := originalRoutingSetting
	updatedRoutingSetting.Enabled = routingEnabled
	originalGenerateDefaultToken := constant.GenerateDefaultToken
	originalRegisterEnabled := common.RegisterEnabled
	originalPasswordRegisterEnabled := common.PasswordRegisterEnabled
	originalEmailVerificationEnabled := common.EmailVerificationEnabled
	originalDefaultUseAutoGroup := setting.DefaultUseAutoGroup

	require.NoError(t, hub_routing_setting.Publish(updatedRoutingSetting))
	constant.GenerateDefaultToken = true
	common.RegisterEnabled = true
	common.PasswordRegisterEnabled = true
	common.EmailVerificationEnabled = false
	setting.DefaultUseAutoGroup = defaultAuto
	t.Cleanup(func() {
		require.NoError(t, hub_routing_setting.Publish(originalRoutingSetting))
		constant.GenerateDefaultToken = originalGenerateDefaultToken
		common.RegisterEnabled = originalRegisterEnabled
		common.PasswordRegisterEnabled = originalPasswordRegisterEnabled
		common.EmailVerificationEnabled = originalEmailVerificationEnabled
		setting.DefaultUseAutoGroup = originalDefaultUseAutoGroup
	})
}

func TestRegisterDefaultTokenUsesRoutingCompatibleGroup(t *testing.T) {
	tests := []struct {
		name           string
		routingEnabled bool
		defaultAuto    bool
		expectedGroup  string
	}{
		{
			name:           "service tier routing uses medium",
			routingEnabled: true,
			defaultAuto:    true,
			expectedGroup:  hub_routing_setting.ServiceTierMedium,
		},
		{
			name:          "legacy routing keeps auto default",
			defaultAuto:   true,
			expectedGroup: "auto",
		},
		{
			name:          "legacy routing keeps inherited default",
			expectedGroup: "",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := setupTokenControllerTestDB(t)
			require.NoError(t, db.AutoMigrate(&model.User{}))
			configureDefaultTokenRegistration(t, test.routingEnabled, test.defaultAuto)
			request := map[string]any{
				"username": "new-user",
				"password": "password123",
			}
			ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/user/register", request, 0)

			Register(ctx)

			response := decodeAPIResponse(t, recorder)
			require.True(t, response.Success, response.Message)
			var user model.User
			require.NoError(t, db.First(&user, "username = ?", "new-user").Error)
			var token model.Token
			require.NoError(t, db.First(&token, "user_id = ?", user.Id).Error)
			assert.Equal(t, test.expectedGroup, token.Group)
		})
	}
}
