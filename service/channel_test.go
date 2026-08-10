package service

import (
	"errors"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/require"
)

func TestShouldDisableChannelExcludesPlatformGeneratedFailures(t *testing.T) {
	originalEnabled := common.AutomaticDisableChannelEnabled
	originalRanges := operation_setting.AutomaticDisableStatusCodeRanges
	t.Cleanup(func() {
		common.AutomaticDisableChannelEnabled = originalEnabled
		operation_setting.AutomaticDisableStatusCodeRanges = originalRanges
	})

	common.AutomaticDisableChannelEnabled = true
	operation_setting.AutomaticDisableStatusCodeRanges = []operation_setting.StatusCodeRange{
		{Start: http.StatusLoopDetected, End: http.StatusLoopDetected},
	}

	loopErr := types.NewErrorWithStatusCode(
		errors.New("platform loop"),
		types.ErrorCodeRequestLoopDetected,
		http.StatusLoopDetected,
	)
	mappedErr := types.NewError(
		errors.New("model mapping failed"),
		types.ErrorCodeChannelModelMappedError,
	)
	channelErr := types.NewError(
		errors.New("channel key failed"),
		types.ErrorCodeChannelInvalidKey,
	)

	require.False(t, ShouldDisableChannel(loopErr))
	require.False(t, ShouldDisableChannel(mappedErr))
	require.True(t, ShouldDisableChannel(channelErr))
}
