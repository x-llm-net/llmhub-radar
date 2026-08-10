package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRetryPrefersAnUntriedChannelBeforeReusingFailedChannels(t *testing.T) {
	const modelName = "retry-supply-model"
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		model.DB.Where("model = ?", modelName).Delete(&model.Ability{})
		model.DB.Where("name LIKE ?", "retry-supply-%").Delete(&model.Channel{})
		model.InitChannelCache()
	})

	priority := int64(0)
	channels := []*model.Channel{
		{
			Name: "retry-supply-a", Type: constant.ChannelTypeOpenAI,
			Key: "key-a", Models: modelName, Group: "default",
			Status: common.ChannelStatusEnabled, Priority: &priority,
		},
		{
			Name: "retry-supply-b", Type: constant.ChannelTypeOpenAI,
			Key: "key-b", Models: modelName, Group: "default",
			Status: common.ChannelStatusEnabled, Priority: &priority,
		},
	}
	for _, channel := range channels {
		require.NoError(t, model.DB.Create(channel).Error)
		require.NoError(t, model.DB.Create(&model.Ability{
			Group: "default", Model: modelName, ChannelId: channel.Id,
			Enabled: true, Priority: &priority,
		}).Error)
	}

	for _, memoryCacheEnabled := range []bool{false, true} {
		name := "database"
		if memoryCacheEnabled {
			name = "memory-cache"
		}
		t.Run(name, func(t *testing.T) {
			common.MemoryCacheEnabled = memoryCacheEnabled
			model.InitChannelCache()
			gin.SetMode(gin.TestMode)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			param := &RetryParam{
				Ctx: ctx, TokenGroup: "default", ModelName: modelName,
				Retry: common.GetPointer(0),
			}

			first, _, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, first)

			param.ExcludeChannel(first.Id)
			param.IncreaseRetry()
			second, _, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, second)
			assert.NotEqual(t, first.Id, second.Id)

			param.ExcludeChannel(second.Id)
			param.IncreaseRetry()
			fallback, _, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, fallback)
			assert.Contains(t, []int{first.Id, second.Id}, fallback.Id)
		})
	}
}

func TestServiceTierRetryDoesNotReuseFailedChannels(t *testing.T) {
	const modelName = "service-tier-retry-supply-model"
	tier := hub_routing_setting.ServiceTierSpecial
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		model.DB.Where("model = ?", modelName).Delete(&model.Ability{})
		model.DB.Where("name LIKE ?", "service-tier-retry-supply-%").Delete(&model.Channel{})
		model.InitChannelCache()
	})

	priority := int64(0)
	channels := []*model.Channel{
		{
			Name: "service-tier-retry-supply-a", Type: constant.ChannelTypeOpenAI,
			Key: "key-a", Models: modelName, Group: tier,
			Status: common.ChannelStatusEnabled, Priority: &priority,
		},
		{
			Name: "service-tier-retry-supply-b", Type: constant.ChannelTypeOpenAI,
			Key: "key-b", Models: modelName, Group: tier,
			Status: common.ChannelStatusEnabled, Priority: &priority,
		},
	}
	for _, channel := range channels {
		require.NoError(t, model.DB.Create(channel).Error)
		require.NoError(t, model.DB.Create(&model.Ability{
			Group: tier, Model: modelName, ChannelId: channel.Id,
			Enabled: true, Priority: &priority,
		}).Error)
	}

	for _, memoryCacheEnabled := range []bool{false, true} {
		name := "database"
		if memoryCacheEnabled {
			name = "memory-cache"
		}
		t.Run(name, func(t *testing.T) {
			common.MemoryCacheEnabled = memoryCacheEnabled
			model.InitChannelCache()
			gin.SetMode(gin.TestMode)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			param := &RetryParam{
				Ctx: ctx, TokenGroup: tier, ModelName: modelName,
				Retry: common.GetPointer(0),
			}

			first, selectedGroup, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, first)
			assert.Equal(t, tier, selectedGroup)

			param.ExcludeChannel(first.Id)
			param.IncreaseRetry()
			second, selectedGroup, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, second)
			assert.Equal(t, tier, selectedGroup)
			assert.NotEqual(t, first.Id, second.Id)

			param.ExcludeChannel(second.Id)
			param.IncreaseRetry()
			exhausted, selectedGroup, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			assert.Nil(t, exhausted)
			assert.Equal(t, tier, selectedGroup)
		})
	}
}
