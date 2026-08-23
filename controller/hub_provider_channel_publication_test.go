package controller

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTenantAdminChannelPublicationCannotCrossTenantOrPartiallyUpdate(t *testing.T) {
	require.NoError(t, i18n.Init())
	setupHubSupplyGroupControllerTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Tenant{}))
	tenantA := model.Tenant{Name: "Publication tenant A", Slug: "publication-tenant-a", Status: model.TenantStatusActive}
	tenantB := model.Tenant{Name: "Publication tenant B", Slug: "publication-tenant-b", Status: model.TenantStatusActive}
	require.NoError(t, model.DB.Create(&tenantA).Error)
	require.NoError(t, model.DB.Create(&tenantB).Error)
	providerA := model.HubProvider{OwnerUserId: 9301, TenantId: &tenantA.Id, Name: "Publication provider A", Slug: "publication-provider-a", Status: model.HubProviderStatusActive}
	providerB := model.HubProvider{OwnerUserId: 9302, TenantId: &tenantB.Id, Name: "Publication provider B", Slug: "publication-provider-b", Status: model.HubProviderStatusActive}
	require.NoError(t, model.DB.Create(&providerA).Error)
	require.NoError(t, model.DB.Create(&providerB).Error)
	channelA := model.Channel{Type: constant.ChannelTypeOpenAI, Key: "a", Name: "publication channel A", Models: "gpt-a", Group: "default", Status: common.ChannelStatusEnabled}
	channelB := model.Channel{Type: constant.ChannelTypeOpenAI, Key: "b", Name: "publication channel B", Models: "gpt-b", Group: "default", Status: common.ChannelStatusEnabled}
	require.NoError(t, model.DB.Create(&channelA).Error)
	require.NoError(t, model.DB.Create(&channelB).Error)
	require.NoError(t, model.DB.Create(&model.HubSupplyGroup{ProviderId: providerA.Id, NewAPIChannelId: channelA.Id, PriceMultiplier: 1, TenantPublished: true, Status: model.HubSupplyGroupStatusAvailable}).Error)
	require.NoError(t, model.DB.Create(&model.HubSupplyGroup{ProviderId: providerB.Id, NewAPIChannelId: channelB.Id, PriceMultiplier: 1, TenantPublished: true, Status: model.HubSupplyGroupStatusAvailable}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/channels/"+strconv.Itoa(channelA.Id)+"/publication", map[string]any{"published": false}, 9300)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(channelA.Id)}}
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantA.Id)
	UpdateHubChannelPublication(ctx)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success, recorder.Body.String())
	var storedA model.HubSupplyGroup
	require.NoError(t, model.DB.First(&storedA, "new_api_channel_id = ?", channelA.Id).Error)
	assert.False(t, storedA.TenantPublished)

	ctx, recorder = newAuthenticatedContext(t, http.MethodPut, "/api/hub/admin/channels/publication/batch", map[string]any{
		"ids": []int{channelA.Id, channelB.Id}, "published": false,
	}, 9300)
	setTenantChannelContext(ctx, tenantA.Id)
	BatchUpdateHubChannelPublication(ctx)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	var storedB model.HubSupplyGroup
	require.NoError(t, model.DB.First(&storedB, "new_api_channel_id = ?", channelB.Id).Error)
	assert.True(t, storedB.TenantPublished)

}
