package controller

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// hubProviderAdminTenantID returns the tenant resolved by TenantHostContext.
// A nil result means the request is using the platform-wide administration
// scope. Super administrators are global on every host; a tenant domain only
// scopes regular tenant administrators.
func hubProviderAdminTenantID(c *gin.Context) *int {
	if isPlatformAdmin(c) {
		return nil
	}
	tenantID := common.GetContextKeyInt(c, constant.ContextKeyTenantId)
	if tenantID <= 0 {
		return nil
	}
	return &tenantID
}

func isPlatformAdmin(c *gin.Context) bool {
	return c != nil && c.GetInt("role") >= common.RoleRootUser
}

// hubProviderAdminChannelIDs resolves the tenant's channels in the main DB
// before a log DB query. The boolean distinguishes platform-wide scope from a
// tenant scope with no channels, whose result must remain empty.
func hubProviderAdminChannelIDs(c *gin.Context) ([]int, bool, error) {
	tenantID := hubProviderAdminTenantID(c)
	if tenantID == nil {
		return nil, false, nil
	}
	channelIDs, err := model.GetHubProviderChannelIDsInTenant(*tenantID)
	if err != nil {
		return nil, true, err
	}
	if channelIDs == nil {
		channelIDs = make([]int, 0)
	}
	return channelIDs, true, nil
}

func requireHubProviderAdminChannelScope(c *gin.Context, channelID int) bool {
	channelIDs, scoped, err := hubProviderAdminChannelIDs(c)
	if err != nil {
		common.ApiError(c, err)
		return false
	}
	if !scoped {
		return true
	}
	for _, allowedID := range channelIDs {
		if allowedID == channelID {
			return true
		}
	}
	common.ApiErrorI18n(c, i18n.MsgNotFound)
	return false
}

func getHubProviderForAdminScope(c *gin.Context, providerID int) (*model.HubProvider, error) {
	var (
		provider *model.HubProvider
		err      error
	)
	if tenantID := hubProviderAdminTenantID(c); tenantID != nil {
		provider, err = model.GetHubProviderByIDInTenant(providerID, tenantID)
	} else {
		provider, err = model.GetHubProviderByID(providerID)
	}
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return nil, model.ErrHubProviderNotFound
	}
	return provider, nil
}

func requireHubProviderAdminScope(c *gin.Context, providerID int) bool {
	if _, err := getHubProviderForAdminScope(c, providerID); err != nil {
		if errors.Is(err, model.ErrHubProviderNotFound) {
			common.ApiErrorI18n(c, i18n.MsgNotFound)
		} else {
			common.ApiError(c, err)
		}
		return false
	}
	return true
}
