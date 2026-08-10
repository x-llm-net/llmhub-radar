package newapi

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUnsupportedEndpointErrorIsChannelScoped(t *testing.T) {
	_, err := (&Adaptor{}).ConvertRerankRequest(nil, 0, dto.RerankRequest{})
	var apiErr *types.NewAPIError
	require.ErrorAs(t, err, &apiErr)
	assert.Equal(t, types.ErrorCodeChannelEndpointUnsupported, apiErr.GetErrorCode())
}
