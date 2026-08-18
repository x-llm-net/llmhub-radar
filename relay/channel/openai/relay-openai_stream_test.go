package openai

import (
	"bufio"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type observingStreamWriter struct {
	mu         sync.Mutex
	header     http.Header
	body       []byte
	firstWrite chan struct{}
	closeCh    chan bool
}

func newObservingStreamWriter() *observingStreamWriter {
	return &observingStreamWriter{
		header:     make(http.Header),
		firstWrite: make(chan struct{}),
		closeCh:    make(chan bool),
	}
}

func (w *observingStreamWriter) Header() http.Header { return w.header }

func (w *observingStreamWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	wasEmpty := len(w.body) == 0
	w.body = append(w.body, p...)
	w.mu.Unlock()
	if wasEmpty {
		close(w.firstWrite)
	}
	return len(p), nil
}

func (w *observingStreamWriter) WriteHeader(int)          {}
func (w *observingStreamWriter) Flush()                   {}
func (w *observingStreamWriter) CloseNotify() <-chan bool { return w.closeCh }
func (w *observingStreamWriter) Pusher() http.Pusher      { return nil }
func (w *observingStreamWriter) WriteHeaderNow()          {}
func (w *observingStreamWriter) Status() int              { return http.StatusOK }
func (w *observingStreamWriter) Size() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.body)
}
func (w *observingStreamWriter) Written() bool { return w.Size() > 0 }
func (w *observingStreamWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}
func (w *observingStreamWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, errors.New("hijack unsupported in test writer")
}
func (w *observingStreamWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return string(w.body)
}

func TestOaiStreamHandlerForwardsPlainOpenAIEventsImmediately(t *testing.T) {
	oldMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(oldMode) })
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })

	reader, writer := io.Pipe()
	streamWriter := newObservingStreamWriter()
	c, _ := gin.CreateTestContext(streamWriter)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	c.Set(common.RequestIdKey, "stream-immediate-test")
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"},
		IsStream:    true, RelayFormat: types.RelayFormatOpenAI, DisablePing: true,
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       reader,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = (&Adaptor{}).DoResponse(c, resp, info)
	}()

	first := `data: {"id":"chatcmpl_test","model":"gpt-test","choices":[{"delta":{"content":"hello"}}]}` + "\n"
	_, err := io.WriteString(writer, first)
	require.NoError(t, err)

	select {
	case <-streamWriter.firstWrite:
	case <-time.After(2 * time.Second):
		t.Fatal("first OpenAI SSE event was not forwarded before the next event")
	}
	require.Contains(t, streamWriter.String(), `"content":"hello"`)

	_, err = io.WriteString(writer, `data: {"id":"chatcmpl_test","model":"gpt-test","choices":[{"delta":{},"finish_reason":"stop"}]}`+"\n")
	require.NoError(t, err)
	_, err = io.WriteString(writer, "data: [DONE]\n")
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("stream handler did not finish")
	}
	require.Equal(t, 1, countSSEData(streamWriter.String(), `"content":"hello"`))
}

func countSSEData(body, fragment string) int {
	count := 0
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, "data:") && strings.Contains(line, fragment) {
			count++
		}
	}
	return count
}
