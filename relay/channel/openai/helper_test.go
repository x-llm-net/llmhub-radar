package openai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestSendResponsesStreamDataReturnsWriteError(t *testing.T) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	requestCtx, cancel := context.WithCancel(context.Background())
	cancel()
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(requestCtx)

	err := sendResponsesStreamData(ctx, dto.ResponsesStreamResponse{Type: "response.output_text.delta"}, `{"delta":"hello"}`)
	require.Error(t, err)
}
