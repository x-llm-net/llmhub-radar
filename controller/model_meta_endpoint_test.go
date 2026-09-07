package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/require"
)

func TestMarshalInferredEndpointsIsStableAndDoesNotDependOnMapOrder(t *testing.T) {
	got := marshalInferredEndpoints([]constant.EndpointType{
		constant.EndpointTypeImageGeneration,
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
	})
	require.Equal(t, `["image-generation","openai","openai-response"]`, got)
}

func TestMarshalInferredEndpointsEmptyValue(t *testing.T) {
	require.Empty(t, marshalInferredEndpoints(nil))
}
