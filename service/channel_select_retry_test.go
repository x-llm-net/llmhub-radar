package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRetryPrefersAnUntriedChannelBeforeReusingFailedChannels(t *testing.T) {
	const modelName = "retry-supply-model"
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		model.DB.Where("model = ?", modelName).Delete(&model.Ability{})
		model.DB.Where("name LIKE ?", "retry-supply-%").Delete(&model.Channel{})
		if originalMemoryCacheEnabled {
			model.InitChannelCache()
		}
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
}
