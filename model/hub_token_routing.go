package model

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const (
	HubTokenRoutingModeChannels = "channels"
	// These labels remain in historical task and accounting snapshots.
	HubTokenRoutingModePublic     = "public_pool"
	HubTokenRoutingModeProvider   = "provider"
	HubTokenRoutingAbilityGroup   = "hub-routing"
	HubTokenRoutingMaxSelections  = 8
	HubTokenRoutingMinMultiplier  = 0.01
	HubTokenRoutingMaxMultiplier  = 100
	HubTokenRoutingMultiplierStep = 0.001
)

var ErrHubRoutingPolicyRequiresSelection = errors.New("routing channels must be selected again")

func IsHubTokenRoutingAbilityGroup(group string) bool {
	return group == HubTokenRoutingAbilityGroup
}

// Only the ordered IDs are persisted. Channels is resolved from current
// publication and pricing for each request, including disabled supply.
type HubTokenRoutingPolicy struct {
	Mode       string                   `json:"mode"`
	ProviderID int                      `json:"provider_id"`
	ChannelIDs []int                    `json:"channel_ids"`
	Channels   []HubTokenRoutingChannel `json:"-"`
}

type HubTokenRoutingChannel struct {
	ChannelID        int      `json:"channel_id"`
	Name             string   `json:"name"`
	Multiplier       float64  `json:"multiplier"`
	Models           []string `json:"models"`
	ConfiguredModels []string `json:"-"`
	ModelFamilies    []string `json:"model_families,omitempty"`
	Available        bool     `json:"available"`
}

type HubTokenRoutingOptions struct {
	Mode          string                   `json:"mode"`
	ProviderID    int                      `json:"provider_id"`
	ProviderName  string                   `json:"provider_name"`
	ProviderSlug  string                   `json:"provider_slug"`
	Channels      []HubTokenRoutingChannel `json:"channels"`
	MaxSelections int                      `json:"max_selections"`
}

func (token *Token) GetHubRoutingPolicy() (*HubTokenRoutingPolicy, error) {
	if token == nil || strings.TrimSpace(token.HubRoutingPolicy) == "" {
		return nil, nil
	}
	var policy HubTokenRoutingPolicy
	if err := common.UnmarshalJsonStr(token.HubRoutingPolicy, &policy); err != nil {
		return nil, ErrHubRoutingPolicyRequiresSelection
	}
	if policy.Mode != HubTokenRoutingModeChannels || policy.ProviderID <= 0 || len(policy.ChannelIDs) == 0 {
		return nil, ErrHubRoutingPolicyRequiresSelection
	}
	return NormalizeHubTokenRoutingPolicy(&policy, policy.ProviderID)
}

func (token *Token) SetHubRoutingPolicy(policy *HubTokenRoutingPolicy) error {
	if policy == nil {
		token.HubRoutingPolicy = ""
		return nil
	}
	data, err := common.Marshal(policy)
	if err != nil {
		return err
	}
	token.HubRoutingPolicy = string(data)
	return nil
}

func NormalizeHubTokenRoutingPolicy(input *HubTokenRoutingPolicy, providerID int) (*HubTokenRoutingPolicy, error) {
	if input == nil {
		return nil, nil
	}
	if providerID <= 0 {
		return nil, errors.New("routing policy requires a provider")
	}
	if input.Mode != "" && input.Mode != HubTokenRoutingModeChannels {
		return nil, ErrHubRoutingPolicyRequiresSelection
	}
	if len(input.ChannelIDs) == 0 {
		return nil, ErrHubRoutingPolicyRequiresSelection
	}
	if len(input.ChannelIDs) > HubTokenRoutingMaxSelections {
		return nil, fmt.Errorf("routing policy must contain 1-%d channels", HubTokenRoutingMaxSelections)
	}
	seen := make(map[int]struct{}, len(input.ChannelIDs))
	for _, channelID := range input.ChannelIDs {
		if channelID <= 0 {
			return nil, errors.New("invalid routing channel")
		}
		if _, exists := seen[channelID]; exists {
			return nil, fmt.Errorf("channel %d is selected more than once", channelID)
		}
		seen[channelID] = struct{}{}
	}
	return &HubTokenRoutingPolicy{
		Mode: HubTokenRoutingModeChannels, ProviderID: providerID,
		ChannelIDs: append([]int(nil), input.ChannelIDs...),
	}, nil
}

func ResolveHubTokenRoutingPolicy(input *HubTokenRoutingPolicy) (*HubTokenRoutingPolicy, error) {
	if input == nil {
		return nil, nil
	}
	policy, err := NormalizeHubTokenRoutingPolicy(input, input.ProviderID)
	if err != nil {
		return nil, err
	}
	channels, err := getHubTokenRoutingChannels(policy.ProviderID, policy.ChannelIDs)
	if err != nil {
		return nil, err
	}
	byID := make(map[int]HubTokenRoutingChannel, len(channels))
	policy.Channels = make([]HubTokenRoutingChannel, 0, len(channels))
	for _, channel := range channels {
		byID[channel.ChannelID] = channel
	}
	for _, channelID := range policy.ChannelIDs {
		if channel, ok := byID[channelID]; ok {
			policy.Channels = append(policy.Channels, channel)
		}
	}
	return policy, nil
}

func roundHubTokenMultiplier(value float64) float64 {
	return math.Round(value*1000) / 1000
}

func validHubTokenMultiplier(value float64) bool {
	return value >= HubTokenRoutingMinMultiplier && value <= HubTokenRoutingMaxMultiplier &&
		!math.IsNaN(value) && !math.IsInf(value, 0)
}

func (policy *HubTokenRoutingPolicy) AllowsChannel(channelID int) bool {
	if policy == nil {
		return false
	}
	for _, selectedID := range policy.ChannelIDs {
		if selectedID == channelID {
			return true
		}
	}
	return false
}

func (policy *HubTokenRoutingPolicy) OrderedMultipliers(modelName string) []float64 {
	return policy.orderedMultipliers(modelName, false)
}

// orderedMultipliers returns the selected channels' current pricing basis for
// a model. Published models drive preferred routing. Configured models are
// also retained privately so an intentional unpublication can fall back to a
// different healthy channel without losing the key's pricing ceiling.
func (policy *HubTokenRoutingPolicy) orderedMultipliers(modelName string, configured bool) []float64 {
	if policy == nil {
		return nil
	}
	values := make([]float64, 0, len(policy.Channels))
	seen := make(map[float64]struct{})
	for _, channel := range policy.Channels {
		if !validHubTokenMultiplier(channel.Multiplier) {
			continue
		}
		models := channel.Models
		if configured && len(channel.ConfiguredModels) > 0 {
			models = channel.ConfiguredModels
		}
		for _, published := range models {
			if !hubRoutingModelMatches(published, modelName) {
				continue
			}
			value := roundHubTokenMultiplier(channel.Multiplier)
			if _, exists := seen[value]; !exists {
				seen[value] = struct{}{}
				values = append(values, value)
			}
			break
		}
	}
	return values
}

func (policy *HubTokenRoutingPolicy) AllowsConfiguredModel(modelName string) bool {
	return len(policy.orderedMultipliers(modelName, true)) > 0
}

func (policy *HubTokenRoutingPolicy) AllowsModel(modelName string) bool {
	return len(policy.OrderedMultipliers(modelName)) > 0
}

func (policy *HubTokenRoutingPolicy) SelectedChannelCount(modelName string) int {
	if policy == nil {
		return 0
	}
	count := 0
	for _, channel := range policy.Channels {
		if policy.AllowsPreferredChannel(modelName, channel.ChannelID, channel.Multiplier) {
			count++
		}
	}
	return count
}

func (policy *HubTokenRoutingPolicy) AllowsMultiplier(modelName string, multiplier float64) bool {
	if !validHubTokenMultiplier(multiplier) {
		return false
	}
	for _, selected := range policy.OrderedMultipliers(modelName) {
		if math.Abs(selected-multiplier) < 0.0005 {
			return true
		}
	}
	return false
}

func (policy *HubTokenRoutingPolicy) AllowsPreferredChannel(modelName string, channelID int, multiplier float64) bool {
	if policy == nil || !validHubTokenMultiplier(multiplier) {
		return false
	}
	for _, channel := range policy.Channels {
		if channel.ChannelID != channelID || math.Abs(channel.Multiplier-multiplier) >= 0.0005 {
			continue
		}
		for _, published := range channel.Models {
			if hubRoutingModelMatches(published, modelName) {
				return true
			}
		}
	}
	return false
}

func (policy *HubTokenRoutingPolicy) AllowsMultiplierForPlatformFallback(modelName string, multiplier float64) bool {
	if !validHubTokenMultiplier(multiplier) {
		return false
	}
	selectedMultipliers := policy.orderedMultipliers(modelName, true)
	for _, selected := range selectedMultipliers {
		if multiplier <= selected+0.0005 {
			return true
		}
	}
	return false
}

func (policy *HubTokenRoutingPolicy) ProviderFallbackProtectionMultiplier(modelName string) (float64, bool) {
	values := policy.orderedMultipliers(modelName, true)
	if len(values) == 0 {
		return 0, false
	}
	return values[0], true
}

func hubRoutingModelMatches(configured, requested string) bool {
	return strings.TrimSpace(configured) == strings.TrimSpace(requested)
}
