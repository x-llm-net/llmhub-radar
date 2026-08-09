package model

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveHubProviderHost(t *testing.T) {
	truncateTables(t)
	t.Setenv("HUB_PROVIDER_ROOT_DOMAIN", "llm-hub.store")
	provider := &HubProvider{OwnerUserId: 94001, Name: "LLM Routers", Slug: "llm-routers"}
	require.NoError(t, CreateHubProvider(provider))

	for _, host := range []string{"llm-hub.store", "localhost:3100", "127.0.0.1:3100", "api.llm-hub.store"} {
		resolution, err := ResolveHubProviderHost(host)
		require.NoError(t, err, host)
		assert.False(t, resolution.IsProviderHost, host)
	}

	for _, host := range []string{"llm-routers.llm-hub.store", "llm-routers.localhost:3100"} {
		resolution, err := ResolveHubProviderHost(host)
		require.NoError(t, err, host)
		require.True(t, resolution.IsProviderHost, host)
		assert.Equal(t, provider.Id, resolution.Provider.Id)
		assert.Equal(t, "llm-routers", resolution.Provider.Slug)
	}

	_, err := ResolveHubProviderHost("missing-provider.llm-hub.store")
	assert.True(t, errors.Is(err, ErrHubProviderHostNotFound))
	_, err = ResolveHubProviderHost("nested.llm-routers.llm-hub.store")
	assert.True(t, errors.Is(err, ErrHubProviderHostInvalid))
}

func TestResolveHubProviderHostReturnsDisabledProviderForMiddlewareDecision(t *testing.T) {
	truncateTables(t)
	t.Setenv("HUB_PROVIDER_ROOT_DOMAIN", "llm-hub.store")
	provider := &HubProvider{OwnerUserId: 94002, Name: "Paused Router", Slug: "paused-router"}
	require.NoError(t, CreateHubProvider(provider))
	_, err := UpdateHubProviderStatus(provider.Id, HubProviderStatusDisabled)
	require.NoError(t, err)

	resolution, err := ResolveHubProviderHost("paused-router.llm-hub.store")
	require.NoError(t, err)
	require.True(t, resolution.IsProviderHost)
	assert.Equal(t, HubProviderStatusDisabled, resolution.Provider.Status)
}
