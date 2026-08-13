/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
package controller

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type hubProviderOriginRoundTripper func(*http.Request) (*http.Response, error)

func (roundTrip hubProviderOriginRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

func TestVerifyHubProviderOriginClaimDNS(t *testing.T) {
	originalLookup := hubProviderOriginTXTLookup
	t.Cleanup(func() { hubProviderOriginTXTLookup = originalLookup })
	hubProviderOriginTXTLookup = func(name string) ([]string, error) {
		assert.Equal(t, "_llm-hub-verification.relay.example", name)
		return []string{"other=value", "llm-hub-verification=test-token"}, nil
	}

	claim := &model.HubProviderOriginClaim{
		Hostname:           "relay.example",
		VerificationMethod: model.HubProviderOriginClaimMethodDNS,
	}
	require.NoError(t, verifyHubProviderOriginClaim(context.Background(), claim, "llm-hub-verification=test-token"))

	hubProviderOriginTXTLookup = func(string) ([]string, error) {
		return nil, errors.New("lookup failed")
	}
	assert.Error(t, verifyHubProviderOriginClaim(context.Background(), claim, "llm-hub-verification=test-token"))
}

func TestVerifyHubProviderOriginClaimHTTP(t *testing.T) {
	originalClient := hubProviderOriginHTTPClient
	t.Cleanup(func() { hubProviderOriginHTTPClient = originalClient })
	hubProviderOriginHTTPClient = func() *http.Client {
		return &http.Client{Transport: hubProviderOriginRoundTripper(func(request *http.Request) (*http.Response, error) {
			assert.Equal(t, "https://relay.example/.well-known/llm-hub-provider-verification.txt", request.URL.String())
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("llm-hub-verification=test-token\n")),
				Header:     make(http.Header),
			}, nil
		})}
	}

	claim := &model.HubProviderOriginClaim{
		Origin:             "https://relay.example",
		VerificationMethod: model.HubProviderOriginClaimMethodHTTP,
	}
	require.NoError(t, verifyHubProviderOriginClaim(context.Background(), claim, "llm-hub-verification=test-token"))

	hubProviderOriginHTTPClient = func() *http.Client {
		return &http.Client{Transport: hubProviderOriginRoundTripper(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("wrong-value")),
				Header:     make(http.Header),
			}, nil
		})}
	}
	assert.Error(t, verifyHubProviderOriginClaim(context.Background(), claim, "llm-hub-verification=test-token"))
}
