package common

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

type failingEventWriter struct {
	header http.Header
}

func (w *failingEventWriter) Header() http.Header {
	return w.header
}

func (w *failingEventWriter) Write([]byte) (int, error) {
	return 0, errors.New("event write failed")
}

func (w *failingEventWriter) WriteHeader(int) {}

func TestCustomEventRenderReturnsWriterError(t *testing.T) {
	writer := &failingEventWriter{header: make(http.Header)}

	err := (CustomEvent{Data: "data: hello"}).Render(writer)

	require.ErrorContains(t, err, "event write failed")
}
