package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequestHopRoundTripAndLimit(t *testing.T) {
	first := NextRequestHop("")
	hop, valid := ParseRequestHop(first)
	require.True(t, valid)
	assert.Equal(t, 1, hop)

	second := NextRequestHop(first)
	hop, valid = ParseRequestHop(second)
	require.True(t, valid)
	assert.Equal(t, 2, hop)

	third := NextRequestHop(second)
	hop, valid = ParseRequestHop(third)
	require.True(t, valid)
	assert.Equal(t, RequestHopMax, hop)
	assert.True(t, RequestHopExceeded(third))
}

func TestRequestHopRejectsTamperingAndStartsNewChain(t *testing.T) {
	marker := NextRequestHop("")
	replacement := "0"
	if marker[len(marker)-1:] == replacement {
		replacement = "1"
	}
	tampered := marker[:len(marker)-1] + replacement

	_, valid := ParseRequestHop(tampered)
	assert.False(t, valid)
	next := NextRequestHop(tampered)
	hop, valid := ParseRequestHop(next)
	require.True(t, valid)
	assert.Equal(t, 1, hop)
	assert.False(t, RequestHopExceeded(tampered))
}

func TestRequestHopIgnoresMalformedValues(t *testing.T) {
	for _, value := range []string{"1", "v1:0:bad", "v1:4:bad", "v2:1:bad", "v1:1:"} {
		_, valid := ParseRequestHop(value)
		assert.False(t, valid, value)
		assert.False(t, RequestHopExceeded(value), value)
	}
}
