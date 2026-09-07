package model

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseModelMetadataEndpointTypesAcceptsSupportedValueShapes(t *testing.T) {
	got := parseModelMetadataEndpointTypes(`{
		"openai": "/v1/chat/completions",
		"image-generation": {"path": "/v1/images/generations", "method": "POST"},
		"ignored-null": null,
		"ignored-bool": true,
		"ignored-array": []
	}`)
	assert.ElementsMatch(t, []constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeImageGeneration,
	}, got)
}

func TestParseModelMetadataEndpointTypesRejectsLegacyArrayAsExplicitObject(t *testing.T) {
	assert.Empty(t, parseModelMetadataEndpointTypes(`[
		"openai",
		"image-generation"
	]`))
	assert.Empty(t, parseModelMetadataEndpointTypes(`{"openai":`))
}

func TestModelMetadataEndpointResolverUsesRulePrecedence(t *testing.T) {
	resolver := &modelMetadataEndpointResolver{metadata: []Model{
		{Id: 1, ModelName: "pt-5", NameRule: NameRuleContains, Endpoints: `{"gemini":"/v1beta/models/{model}:generateContent"}`},
		{Id: 2, ModelName: "-latest", NameRule: NameRuleSuffix, Endpoints: `{"anthropic":"/v1/messages"}`},
		{Id: 3, ModelName: "gpt-", NameRule: NameRulePrefix, Endpoints: `{"openai-response":"/v1/responses"}`},
		{Id: 4, ModelName: "gpt-5", NameRule: NameRuleExact, Endpoints: `{"image-generation":"/v1/images/generations"}`},
	}}

	endpoints, found := resolver.endpointTypes("gpt-5")
	require.True(t, found)
	assert.Equal(t, []constant.EndpointType{constant.EndpointTypeImageGeneration}, endpoints)

	endpoints, found = resolver.endpointTypes("gpt-5-latest")
	require.True(t, found)
	assert.Equal(t, []constant.EndpointType{constant.EndpointTypeOpenAIResponse}, endpoints)

	endpoints, found = resolver.endpointTypes("x-pt-5-latest")
	require.True(t, found)
	assert.Equal(t, []constant.EndpointType{constant.EndpointTypeAnthropic}, endpoints)
}

func TestModelMetadataEndpointResolverUsesLowestIDWithinRule(t *testing.T) {
	resolver := &modelMetadataEndpointResolver{metadata: []Model{
		{Id: 10, ModelName: "gpt-5", NameRule: NameRulePrefix, Endpoints: `{"image-generation":"/v1/images/generations"}`},
		{Id: 20, ModelName: "gpt-", NameRule: NameRulePrefix, Endpoints: `{"openai-response":"/v1/responses"}`},
	}}

	endpoints, found := resolver.endpointTypes("gpt-5-mini")
	require.True(t, found)
	// Resolver snapshots are ordered by id ASC by the DB query. Keep the
	// deterministic first-match behavior explicit for equal NameRule values.
	assert.Equal(t, []constant.EndpointType{constant.EndpointTypeImageGeneration}, endpoints)
}

func TestModelMetadataEndpointResolverTreatsEmptyAndMalformedRowsAsUnspecified(t *testing.T) {
	resolver := &modelMetadataEndpointResolver{metadata: []Model{
		{Id: 1, ModelName: "empty-model", NameRule: NameRuleExact, Endpoints: ""},
		{Id: 2, ModelName: "broken-model", NameRule: NameRuleExact, Endpoints: `{"openai":`},
	}}

	endpoints, found := resolver.endpointTypes("empty-model")
	assert.False(t, found)
	assert.Empty(t, endpoints)

	endpoints, found = resolver.endpointTypes("broken-model")
	assert.False(t, found)
	assert.Empty(t, endpoints)
}

func TestModelMetadataEndpointResolverTreatsLegacyArrayAsUnspecified(t *testing.T) {
	resolver := &modelMetadataEndpointResolver{metadata: []Model{
		{Id: 1, ModelName: "legacy-model", NameRule: NameRuleExact, Endpoints: `["openai", "image-generation"]`},
	}}

	endpoints, found := resolver.endpointTypes("legacy-model")
	assert.False(t, found)
	assert.Empty(t, endpoints)
}
