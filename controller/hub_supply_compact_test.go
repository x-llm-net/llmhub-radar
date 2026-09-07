package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildTestRequestForCompactProbeIsTextRequest(t *testing.T) {
	request := buildTestRequest(
		"compact-model",
		string(constant.EndpointTypeOpenAIResponseCompact),
		&model.Channel{Type: constant.ChannelTypeAdvancedCustom},
		false,
	)

	compact, ok := request.(*dto.OpenAIResponsesCompactionRequest)
	require.True(t, ok)
	assert.Equal(t, "compact-model", compact.Model)
	assert.NotEmpty(t, compact.Input)
	assert.Empty(t, compact.Tools, "compact text probes must not be classified as image probes")
}
