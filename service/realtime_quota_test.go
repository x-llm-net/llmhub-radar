package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type realtimeBillingSettler struct {
	preConsumedQuota int
	reserveTargets   []int
	settleTargets    []int
	settleErr        error
	committed        bool
}

func (s *realtimeBillingSettler) Settle(quota int) error {
	s.settleTargets = append(s.settleTargets, quota)
	return s.settleErr
}

func (*realtimeBillingSettler) Refund(*gin.Context) {}

func (*realtimeBillingSettler) NeedsRefund() bool { return false }

func (s *realtimeBillingSettler) GetPreConsumedQuota() int { return s.preConsumedQuota }

func (s *realtimeBillingSettler) Reserve(targetQuota int) error {
	s.reserveTargets = append(s.reserveTargets, targetQuota)
	if targetQuota > s.preConsumedQuota {
		s.preConsumedQuota = targetQuota
	}
	return nil
}

func (s *realtimeBillingSettler) SettlementCommitted() bool { return s.committed }

func TestRealtimeBillingReservesCumulativeUsageAndSettlesOnce(t *testing.T) {
	truncate(t)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	common.SetContextKey(ctx, constant.ContextKeyHubTokenRoutingPolicy, &struct{}{})
	billing := &realtimeBillingSettler{preConsumedQuota: 10}
	status := relaycommon.NewStreamStatus()
	status.SetEndReason(relaycommon.StreamEndReasonDone, nil)
	info := &relaycommon.RelayInfo{
		RequestId:       "realtime-billing-once",
		UserId:          101,
		TokenId:         201,
		TokenKey:        "realtime-token",
		OriginModelName: "gpt-4o-realtime-preview",
		UsingGroup:      "default",
		BillingSource:   BillingSourceWallet,
		Billing:         billing,
		StartTime:       time.Now().Add(-time.Second),
		IsStream:        true,
		StreamStatus:    status,
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: 301},
		PriceData: hosttypes.PriceData{
			ModelRatio: 1,
			GroupRatioInfo: hosttypes.GroupRatioInfo{
				GroupRatio: 1,
			},
		},
	}
	usage := &dto.RealtimeUsage{
		TotalTokens:  15,
		InputTokens:  10,
		OutputTokens: 5,
		InputTokenDetails: dto.InputTokenDetails{
			TextTokens: 10,
		},
		OutputTokenDetails: dto.OutputTokenDetails{
			TextTokens: 5,
		},
	}
	expectedQuota, clamp := calculateAudioQuota(QuotaInfo{
		InputDetails:  TokenDetails{TextTokens: 10},
		OutputDetails: TokenDetails{TextTokens: 5},
		ModelName:     info.OriginModelName,
		ModelRatio:    1,
		GroupRatio:    1,
	})
	require.Nil(t, clamp)

	firstUsage := &dto.RealtimeUsage{
		TotalTokens:  6,
		InputTokens:  4,
		OutputTokens: 2,
		InputTokenDetails: dto.InputTokenDetails{
			TextTokens: 4,
		},
		OutputTokenDetails: dto.OutputTokenDetails{
			TextTokens: 2,
		},
	}
	firstQuota, firstClamp := calculateAudioQuota(QuotaInfo{
		InputDetails:  TokenDetails{TextTokens: 4},
		OutputDetails: TokenDetails{TextTokens: 2},
		ModelName:     info.OriginModelName,
		ModelRatio:    1,
		GroupRatio:    1,
	})
	require.Nil(t, firstClamp)

	require.NoError(t, PreWssConsumeQuota(ctx, info, firstUsage))
	require.NoError(t, PreWssConsumeQuota(ctx, info, usage))
	assert.Equal(t, []int{firstQuota, expectedQuota}, billing.reserveTargets)
	assert.Empty(t, billing.settleTargets)

	require.NoError(t, PostWssConsumeQuota(ctx, info, info.OriginModelName, usage, ""))

	assert.Equal(t, []int{expectedQuota}, billing.settleTargets)
	assert.Equal(t, expectedQuota, info.FinalPreConsumedQuota)
}

func TestRealtimeFixedPriceSettlesConfiguredPrice(t *testing.T) {
	truncate(t)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	billing := &realtimeBillingSettler{}
	info := &relaycommon.RelayInfo{
		RequestId:       "realtime-fixed-price",
		UserId:          102,
		TokenId:         202,
		OriginModelName: "realtime-fixed-price-model",
		UsingGroup:      "default",
		BillingSource:   BillingSourceWallet,
		Billing:         billing,
		StartTime:       time.Now().Add(-time.Second),
		IsStream:        true,
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: 302},
		PriceData: hosttypes.PriceData{
			UsePrice:   true,
			ModelPrice: 0.25,
			GroupRatioInfo: hosttypes.GroupRatioInfo{
				GroupRatio: 2,
			},
		},
	}
	usage := &dto.RealtimeUsage{
		TotalTokens:  2,
		InputTokens:  1,
		OutputTokens: 1,
		InputTokenDetails: dto.InputTokenDetails{
			TextTokens: 1,
		},
		OutputTokenDetails: dto.OutputTokenDetails{
			TextTokens: 1,
		},
	}
	expectedQuota, clamp := calculateAudioQuota(QuotaInfo{
		UsePrice:   true,
		ModelPrice: 0.25,
		GroupRatio: 2,
	})
	require.Nil(t, clamp)

	require.NoError(t, PreWssConsumeQuota(ctx, info, usage))
	assert.Empty(t, billing.reserveTargets)
	require.NoError(t, PostWssConsumeQuota(ctx, info, info.OriginModelName, usage, ""))

	assert.Equal(t, []int{expectedQuota}, billing.settleTargets)
	assert.Greater(t, expectedQuota, 0)
}

func TestAudioFixedPriceSettlesConfiguredPrice(t *testing.T) {
	truncate(t)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	billing := &realtimeBillingSettler{}
	info := &relaycommon.RelayInfo{
		RequestId:       "audio-fixed-price",
		UserId:          103,
		TokenId:         203,
		OriginModelName: "audio-fixed-price-model",
		UsingGroup:      "default",
		BillingSource:   BillingSourceWallet,
		Billing:         billing,
		StartTime:       time.Now().Add(-time.Second),
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: 303},
		PriceData: hosttypes.PriceData{
			UsePrice:   true,
			ModelPrice: 0.25,
			GroupRatioInfo: hosttypes.GroupRatioInfo{
				GroupRatio: 2,
			},
		},
	}
	usage := &dto.Usage{
		PromptTokens:     1,
		CompletionTokens: 1,
		TotalTokens:      2,
		PromptTokensDetails: dto.InputTokenDetails{
			TextTokens: 1,
		},
		CompletionTokenDetails: dto.OutputTokenDetails{
			TextTokens: 1,
		},
	}
	expectedQuota, clamp := calculateAudioQuota(QuotaInfo{
		UsePrice: true, ModelPrice: 0.25, GroupRatio: 2,
	})
	require.Nil(t, clamp)

	require.NoError(t, PostAudioConsumeQuota(ctx, info, usage, ""))
	assert.Equal(t, []int{expectedQuota}, billing.settleTargets)
	assert.Greater(t, expectedQuota, 0)
}

func TestTextSettlementFailureDoesNotIncrementUsageCounters(t *testing.T) {
	truncate(t)
	const userID = 104
	const channelID = 304
	seedUser(t, userID, 1000)
	seedChannel(t, channelID)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	billing := &realtimeBillingSettler{settleErr: assert.AnError}
	info := &relaycommon.RelayInfo{
		RequestId:       "text-settlement-failure",
		UserId:          userID,
		TokenId:         204,
		OriginModelName: "gpt-5",
		UsingGroup:      "default",
		BillingSource:   BillingSourceWallet,
		Billing:         billing,
		StartTime:       time.Now().Add(-time.Second),
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: channelID},
		PriceData: hosttypes.PriceData{
			ModelRatio:     1,
			GroupRatioInfo: hosttypes.GroupRatioInfo{GroupRatio: 1},
		},
	}
	usage := &dto.Usage{PromptTokens: 10, CompletionTokens: 1, TotalTokens: 11}

	require.ErrorIs(t, PostTextConsumeQuota(ctx, info, usage, nil), assert.AnError)
	var user model.User
	require.NoError(t, model.DB.First(&user, userID).Error)
	assert.Zero(t, user.UsedQuota)
	assert.Zero(t, user.RequestCount)
}

func TestCountTokenRealtimeRecognizesTextDeltaEvents(t *testing.T) {
	info := &relaycommon.RelayInfo{}
	for _, eventType := range []string{
		dto.RealtimeEventResponseOutputTextDelta,
		dto.RealtimeEventResponseTextDelta,
	} {
		textTokens, audioTokens, err := CountTokenRealtime(info, dto.RealtimeEvent{
			Type:  eventType,
			Delta: "hello from realtime",
		}, "gpt-4o")

		require.NoError(t, err)
		assert.Greater(t, textTokens, 0)
		assert.Zero(t, audioTokens)
	}
}
