package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetRandomSatisfiedChannelPrefersUntriedBeforeFallback(t *testing.T) {
	truncateTables(t)
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		if originalMemoryCacheEnabled {
			InitChannelCache()
		}
	})

	for _, memoryCacheEnabled := range []bool{false, true} {
		name := "database"
		if memoryCacheEnabled {
			name = "memory cache"
		}
		t.Run(name, func(t *testing.T) {
			modelName := "retry-selection-" + name
			priority := int64(0)
			channels := []*Channel{
				{
					Name: "retry-selection-a-" + name, Type: constant.ChannelTypeOpenAI,
					Key: "key-a", Models: modelName, Group: "default",
					Status: common.ChannelStatusEnabled, Priority: &priority,
				},
				{
					Name: "retry-selection-b-" + name, Type: constant.ChannelTypeOpenAI,
					Key: "key-b", Models: modelName, Group: "default",
					Status: common.ChannelStatusEnabled, Priority: &priority,
				},
			}
			for _, channel := range channels {
				require.NoError(t, DB.Create(channel).Error)
				require.NoError(t, DB.Create(&Ability{
					Group: "default", Model: modelName, ChannelId: channel.Id,
					Enabled: true, Priority: &priority,
				}).Error)
			}

			common.MemoryCacheEnabled = memoryCacheEnabled
			if memoryCacheEnabled {
				InitChannelCache()
			}

			first, err := GetRandomSatisfiedChannel("default", modelName, 0, "", nil)
			require.NoError(t, err)
			require.NotNil(t, first)

			excluded := map[int]struct{}{first.Id: {}}
			second, err := GetRandomSatisfiedChannel("default", modelName, 1, "", excluded)
			require.NoError(t, err)
			require.NotNil(t, second)
			assert.NotEqual(t, first.Id, second.Id)

			excluded[second.Id] = struct{}{}
			fallback, err := GetRandomSatisfiedChannel("default", modelName, 2, "", excluded)
			require.NoError(t, err)
			require.NotNil(t, fallback)
			assert.Contains(t, []int{first.Id, second.Id}, fallback.Id)
		})
	}
}

func TestChannelMemoryCacheUsesEnabledAbilitiesInsteadOfDeclaredModels(t *testing.T) {
	truncateTables(t)
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		if originalMemoryCacheEnabled {
			InitChannelCache()
		}
	})

	priority := int64(0)
	channel := &Channel{
		Name: "published-model-only", Type: constant.ChannelTypeOpenAI,
		Key: "key", Models: "published-model,failed-model", Group: "default",
		Status: common.ChannelStatusEnabled, Priority: &priority,
	}
	require.NoError(t, DB.Create(channel).Error)
	require.NoError(t, DB.Create(&Ability{
		Group: "default", Model: "published-model", ChannelId: channel.Id,
		Enabled: true, Priority: &priority,
	}).Error)
	InitChannelCache()

	published, err := GetRandomSatisfiedChannel("default", "published-model", 0, "", nil)
	require.NoError(t, err)
	require.NotNil(t, published)
	assert.Equal(t, channel.Id, published.Id)

	failed, err := GetRandomSatisfiedChannel("default", "failed-model", 0, "", nil)
	require.NoError(t, err)
	assert.Nil(t, failed)
}
