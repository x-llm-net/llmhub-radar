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
	originalKeywords := operation_setting.AutomaticDisableKeywords
	t.Cleanup(func() {
		common.AutomaticDisableChannelEnabled = originalEnabled
		operation_setting.AutomaticDisableStatusCodeRanges = originalRanges
		operation_setting.AutomaticDisableKeywords = originalKeywords
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
	endpointErr := types.NewErrorWithStatusCode(
		errors.New("endpoint not supported"),
		types.ErrorCodeChannelEndpointUnsupported,
		http.StatusBadRequest,
	)
	modelNotFoundErr := types.NewErrorWithStatusCode(
		errors.New("model not found upstream"),
		types.ErrorCodeModelNotFound,
		http.StatusNotFound,
	)
	channelErr := types.NewError(
		errors.New("channel key failed"),
		types.ErrorCodeChannelInvalidKey,
	)

	require.False(t, ShouldDisableChannel(loopErr))
	require.False(t, ShouldDisableChannel(mappedErr))
	require.False(t, ShouldDisableChannel(endpointErr))
	require.False(t, ShouldDisableChannel(modelNotFoundErr))
	require.True(t, ShouldDisableChannel(channelErr))
}
