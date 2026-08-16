package controller

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShouldRetryTreatsRequestLoopDetectedAsTerminal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	loopResponse := &http.Response{
		StatusCode: http.StatusLoopDetected,
		Body: io.NopCloser(strings.NewReader(
			`{"error":{"message":"recursive route detected","type":"new_api_error","code":"request_loop_detected"}}`,
		)),
	}

	loopErr := service.RelayErrorHandler(context.Background(), loopResponse, false)
	require.NotNil(t, loopErr)
	assert.Equal(t, types.ErrorCodeRequestLoopDetected, loopErr.GetErrorCode())
	assert.False(t, shouldRetry(ctx, loopErr, 3))

	ordinaryResponse := &http.Response{
		StatusCode: http.StatusLoopDetected,
		Body: io.NopCloser(strings.NewReader(
			`{"error":{"message":"third-party 508","type":"upstream_error","code":"third_party_508"}}`,
		)),
	}
	ordinaryErr := service.RelayErrorHandler(context.Background(), ordinaryResponse, false)
	require.NotNil(t, ordinaryErr)
	assert.Equal(t, types.ErrorCode("third_party_508"), ordinaryErr.GetErrorCode())
	assert.True(t, shouldRetry(ctx, ordinaryErr, 3))
}

func TestShouldRetryTreatsEndpointUnsupportedAsChannelScoped(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	endpointErr := types.NewErrorWithStatusCode(
		io.ErrUnexpectedEOF,
		types.ErrorCodeChannelEndpointUnsupported,
		http.StatusBadRequest,
		types.ErrOptionWithSkipRetry(),
	)

	assert.True(t, shouldRetry(ctx, endpointErr, 1))
}

func TestRealtimeErrorsAreTerminalAfterClientUpgrade(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayErr := types.NewErrorWithStatusCode(
		io.ErrUnexpectedEOF,
		types.ErrorCodeBadResponse,
		http.StatusBadGateway,
	)

	result := applyRelayFormatRetryPolicy(types.RelayFormatOpenAIRealtime, relayErr)

	require.Same(t, relayErr, result)
	require.True(t, types.IsSkipRetryError(result))
	require.False(t, shouldRetry(ctx, result, 1))
}
