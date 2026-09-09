package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegisterRecordsTenantDirectSource(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Tenant{}, &model.TenantDomain{}))
	previousMemoryCache := common.MemoryCacheEnabled
	previousRegisterEnabled := common.RegisterEnabled
	previousPasswordRegisterEnabled := common.PasswordRegisterEnabled
	previousEmailVerificationEnabled := common.EmailVerificationEnabled
	previousGenerateDefaultToken := constant.GenerateDefaultToken
	common.MemoryCacheEnabled = false
	common.RegisterEnabled = true
	common.PasswordRegisterEnabled = true
	common.EmailVerificationEnabled = false
	constant.GenerateDefaultToken = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = previousMemoryCache
		common.RegisterEnabled = previousRegisterEnabled
		common.PasswordRegisterEnabled = previousPasswordRegisterEnabled
		common.EmailVerificationEnabled = previousEmailVerificationEnabled
		constant.GenerateDefaultToken = previousGenerateDefaultToken
	})

	tenant := model.Tenant{Name: "Tenant Direct", Slug: "tenant-direct", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	require.NoError(t, db.Create(&model.TenantDomain{
		TenantId: tenant.Id, Host: "brand.example",
		VerificationStatus: model.TenantDomainVerificationVerified,
		Status:             model.TenantDomainStatusActive,
	}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "http://brand.example/api/user/register", map[string]any{
		"username": "tenant-user",
		"password": "password123",
	}, 0)
	Register(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var user model.User
	require.NoError(t, db.Where("username = ?", "tenant-user").First(&user).Error)
	assert.Equal(t, model.RegistrationSourceTenantDirect, user.RegistrationSource)
	assert.Equal(t, tenant.Id, user.RegistrationTenantId)
	assert.Zero(t, user.RegistrationProviderId)
}
