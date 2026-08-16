package model

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
)

const (
	HubTokenRoutingModePublic     = "public_pool"
	HubTokenRoutingModeProvider   = "provider"
	HubTokenRoutingMaxSelections  = 8
	HubTokenRoutingMinMultiplier  = 0.01
	HubTokenRoutingMaxMultiplier  = 100
	HubTokenRoutingMultiplierStep = 0.001
)

// HubTokenRoutingSelection is the user-facing supply constraint for one model
// family. Public keys use an inclusive range; provider-scoped keys use the
// exact multiplier list supplied by that provider.
type HubTokenRoutingSelection struct {
	Family           string    `json:"family"`
	MinMultiplier    float64   `json:"min_multiplier,omitempty"`
	MaxMultiplier    float64   `json:"max_multiplier,omitempty"`
	ExactMultipliers []float64 `json:"exact_multipliers,omitempty"`
}

type HubTokenRoutingPolicy struct {
	Mode       string                     `json:"mode"`
	ProviderID int                        `json:"provider_id,omitempty"`
	Selections []HubTokenRoutingSelection `json:"selections"`
}

type HubTokenRoutingAvailability struct {
	Multiplier    float64 `json:"multiplier"`
	ChannelCount  int     `json:"channel_count"`
	ProviderCount int     `json:"provider_count"`
	ProviderIDs   []int   `json:"provider_ids,omitempty"`
}

type HubTokenRoutingFamilyOption struct {
	Key                   string                        `json:"key"`
	MinMultiplier         float64                       `json:"min_multiplier"`
	MaxMultiplier         float64                       `json:"max_multiplier"`
	Step                  float64                       `json:"step"`
	AvailableChannelCount int                           `json:"available_channel_count"`
	ProviderCount         int                           `json:"provider_count"`
	ExactMultipliers      []float64                     `json:"exact_multipliers,omitempty"`
	Availability          []HubTokenRoutingAvailability `json:"availability"`
}

type HubTokenRoutingOptions struct {
	Mode         string                                            `json:"mode"`
	ProviderID   int                                               `json:"provider_id,omitempty"`
	ProviderName string                                            `json:"provider_name,omitempty"`
	ProviderSlug string                                            `json:"provider_slug,omitempty"`
	Families     []HubTokenRoutingFamilyOption                     `json:"families"`
	TierCeilings map[string]hub_routing_setting.FamilyTierCeilings `json:"tier_ceilings"`
}

var supportedHubTokenRoutingFamilies = map[string]struct{}{
	"openai": {}, "anthropic": {}, "google": {}, "xai": {}, "deepseek": {},
	"alibaba": {}, "bytedance": {}, "zhipu": {}, "other": {},
}

func (token *Token) GetHubRoutingPolicy() (*HubTokenRoutingPolicy, error) {
	if token == nil || strings.TrimSpace(token.HubRoutingPolicy) == "" {
		return nil, nil
	}
	var policy HubTokenRoutingPolicy
	if err := common.UnmarshalJsonStr(token.HubRoutingPolicy, &policy); err != nil {
		return nil, err
	}
	return &policy, nil
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
	policy := *input
	policy.Selections = append([]HubTokenRoutingSelection(nil), input.Selections...)
	if len(policy.Selections) == 0 || len(policy.Selections) > HubTokenRoutingMaxSelections {
		return nil, fmt.Errorf("routing policy must contain 1-%d selections", HubTokenRoutingMaxSelections)
	}
	if providerID > 0 {
		policy.Mode = HubTokenRoutingModeProvider
		policy.ProviderID = providerID
	} else {
		policy.Mode = HubTokenRoutingModePublic
		policy.ProviderID = 0
	}
	if policy.Mode != HubTokenRoutingModePublic && policy.Mode != HubTokenRoutingModeProvider {
		return nil, errors.New("invalid routing policy mode")
	}
	if policy.Mode == HubTokenRoutingModeProvider && policy.ProviderID <= 0 {
		return nil, errors.New("provider routing policy requires a provider")
	}

	seenFamilies := make(map[string]struct{}, len(policy.Selections))
	for index := range policy.Selections {
		selection := &policy.Selections[index]
		selection.Family = strings.ToLower(strings.TrimSpace(selection.Family))
		if selection.Family == "" {
			return nil, fmt.Errorf("selection %d has no model family", index+1)
		}
		if _, supported := supportedHubTokenRoutingFamilies[selection.Family]; !supported {
			return nil, fmt.Errorf("unsupported model family %s", selection.Family)
		}
		if _, exists := seenFamilies[selection.Family]; exists {
			return nil, fmt.Errorf("model family %s is selected more than once", selection.Family)
		}
		seenFamilies[selection.Family] = struct{}{}
		if policy.Mode == HubTokenRoutingModeProvider {
			if len(selection.ExactMultipliers) == 0 {
				return nil, fmt.Errorf("provider selection %s requires a multiplier", selection.Family)
			}
			selection.ExactMultipliers = normalizeMultipliers(selection.ExactMultipliers)
			for _, multiplier := range selection.ExactMultipliers {
				if !validHubTokenMultiplier(multiplier) {
					return nil, fmt.Errorf("invalid multiplier for %s", selection.Family)
				}
			}
			selection.MinMultiplier = 0
			selection.MaxMultiplier = 0
			continue
		}
		selection.MinMultiplier = roundHubTokenMultiplier(selection.MinMultiplier)
		selection.MaxMultiplier = roundHubTokenMultiplier(selection.MaxMultiplier)
		if !validHubTokenMultiplier(selection.MinMultiplier) ||
			!validHubTokenMultiplier(selection.MaxMultiplier) ||
			selection.MinMultiplier > selection.MaxMultiplier {
			return nil, fmt.Errorf("invalid multiplier range for %s", selection.Family)
		}
		selection.ExactMultipliers = nil
	}
	return &policy, nil
}

func normalizeMultipliers(values []float64) []float64 {
	result := make([]float64, 0, len(values))
	seen := make(map[float64]struct{}, len(values))
	for _, value := range values {
		value = roundHubTokenMultiplier(value)
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Float64s(result)
	return result
}

func roundHubTokenMultiplier(value float64) float64 {
	return math.Round(value*1000) / 1000
}

func validHubTokenMultiplier(value float64) bool {
	return value >= HubTokenRoutingMinMultiplier && value <= HubTokenRoutingMaxMultiplier &&
		!math.IsNaN(value) && !math.IsInf(value, 0)
}

func (policy *HubTokenRoutingPolicy) AllowsMultiplier(family string, multiplier float64) bool {
	multiplier = roundHubTokenMultiplier(multiplier)
	if policy == nil || !validHubTokenMultiplier(multiplier) {
		return false
	}
	family = strings.ToLower(strings.TrimSpace(family))
	for _, selection := range policy.Selections {
		if selection.Family != family {
			continue
		}
		if policy.Mode == HubTokenRoutingModeProvider {
			for _, exact := range selection.ExactMultipliers {
				if math.Abs(exact-multiplier) < 0.0005 {
					return true
				}
			}
			return false
		}
		return multiplier >= selection.MinMultiplier-0.0005 && multiplier <= selection.MaxMultiplier+0.0005
	}
	return false
}

func (policy *HubTokenRoutingPolicy) AllowsModel(modelName string) bool {
	if policy == nil {
		return false
	}
	family := ClassifyHubPublicModelFamily(modelName)
	for _, selection := range policy.Selections {
		if selection.Family == family {
			return true
		}
	}
	return false
}
