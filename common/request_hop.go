package common

import (
	"crypto/subtle"
	"fmt"
	"strconv"
	"strings"
)

const (
	RequestHopHeader = "X-LLM-Hub-Hop"
	RequestHopMax    = 3
	requestHopPrefix = "llmhub-request-hop:v1:"
)

// ParseRequestHop validates the platform-generated hop marker. Invalid or
// client-supplied values are ignored and do not affect normal requests.
func ParseRequestHop(value string) (int, bool) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 3 || parts[0] != "v1" {
		return 0, false
	}
	hop, err := strconv.Atoi(parts[1])
	if err != nil || hop < 1 || hop > RequestHopMax {
		return 0, false
	}
	expected := GenerateHMAC(requestHopSignatureInput(hop))
	if subtle.ConstantTimeCompare([]byte(strings.ToLower(parts[2])), []byte(expected)) != 1 {
		return 0, false
	}
	return hop, true
}

// NextRequestHop creates the marker for the next gateway hop. An absent or
// invalid marker starts a new chain at hop one.
func NextRequestHop(previous string) string {
	hop, valid := ParseRequestHop(previous)
	if !valid {
		hop = 0
	}
	if hop < RequestHopMax {
		hop++
	}
	return fmt.Sprintf("v1:%d:%s", hop, GenerateHMAC(requestHopSignatureInput(hop)))
}

// RequestHopExceeded reports whether a valid marker has reached the terminal
// hop. The middleware uses this as a hard stop before channel selection.
func RequestHopExceeded(value string) bool {
	hop, valid := ParseRequestHop(value)
	return valid && hop >= RequestHopMax
}

func requestHopSignatureInput(hop int) string {
	return requestHopPrefix + strconv.Itoa(hop)
}
