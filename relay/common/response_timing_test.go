package common

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRelayInfoObserveUpstreamResponse(t *testing.T) {
	info := &RelayInfo{}
	resp := &http.Response{
		Proto:            "HTTP/2.0",
		Header:           http.Header{},
		TransferEncoding: []string{"chunked"},
		Body:             io.NopCloser(strings.NewReader("data: hello\n\n")),
	}

	info.ObserveUpstreamResponse(resp)
	require.False(t, info.ResponseHeadersTime.IsZero())
	require.True(t, info.FirstBodyByteTime.IsZero())
	require.Equal(t, "HTTP/2.0", info.UpstreamProtocol)
	require.Equal(t, "identity", info.UpstreamContentEncoding)
	require.Equal(t, "chunked", info.UpstreamTransferEncoding)

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, "data: hello\n\n", string(body))
	require.False(t, info.FirstBodyByteTime.IsZero())
}

func TestRelayInfoObserveMeaningfulStreamData(t *testing.T) {
	tests := []struct {
		name string
		data string
		want bool
	}{
		{name: "openai role", data: `{"choices":[{"delta":{"role":"assistant"}}]}`},
		{name: "openai usage", data: `{"choices":[],"usage":{"prompt_tokens":1}}`},
		{name: "openai content", data: `{"choices":[{"delta":{"content":"hello"}}]}`, want: true},
		{name: "responses text", data: `{"type":"response.output_text.delta","delta":"hello"}`, want: true},
		{name: "claude text", data: `{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}`, want: true},
		{name: "gemini text", data: `{"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}`, want: true},
		{name: "image metadata", data: `{"type":"image_generation.partial","data":"base64"}`},
		{name: "done", data: `[DONE]`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &RelayInfo{IsStream: true}
			assert.Equal(t, tt.want, info.ObserveMeaningfulStreamData(tt.data))
			if tt.want {
				assert.False(t, info.FirstTokenTime.IsZero())
			} else {
				assert.True(t, info.FirstTokenTime.IsZero())
			}
		})
	}
}

func TestRelayInfoObserveMeaningfulStreamDataRequiresStream(t *testing.T) {
	info := &RelayInfo{}

	require.False(t, info.ObserveMeaningfulStreamData(`{"choices":[{"delta":{"content":"hello"}}]}`))
	assert.True(t, info.FirstTokenTime.IsZero())
}
