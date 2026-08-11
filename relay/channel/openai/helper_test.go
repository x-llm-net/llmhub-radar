package openai

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type failingResponseWriter struct {
	header    http.Header
	writes    int
	failAfter int
}

func (w *failingResponseWriter) Header() http.Header {
	return w.header
}

func (w *failingResponseWriter) Write([]byte) (int, error) {
	w.writes++
	if w.writes >= w.failAfter {
		return 0, errors.New("socket write failed")
	}
	return 1, nil
}

func (w *failingResponseWriter) WriteHeader(int) {}

func TestSendResponsesStreamDataReturnsWriteError(t *testing.T) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	requestCtx, cancel := context.WithCancel(context.Background())
	cancel()
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(requestCtx)

	err := sendResponsesStreamData(ctx, dto.ResponsesStreamResponse{Type: "response.output_text.delta"}, `{"delta":"hello"}`)
	require.Error(t, err)
}

func TestSendResponsesStreamDataReturnsResponseWriterError(t *testing.T) {
	writer := &failingResponseWriter{header: make(http.Header), failAfter: 1}
	ctx, _ := gin.CreateTestContext(writer)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)

	err := sendResponsesStreamData(ctx, dto.ResponsesStreamResponse{Type: "response.output_text.delta"}, `{"delta":"hello"}`)
	require.ErrorContains(t, err, "socket write failed")
}

func TestSendResponsesStreamDataReturnsDataWriteError(t *testing.T) {
	writer := &failingResponseWriter{header: make(http.Header), failAfter: 2}
	ctx, _ := gin.CreateTestContext(writer)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)

	err := sendResponsesStreamData(ctx, dto.ResponsesStreamResponse{Type: "response.output_text.delta"}, `{"delta":"hello"}`)
	require.ErrorContains(t, err, "socket write failed")
}
