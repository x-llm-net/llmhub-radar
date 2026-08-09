package hub_routing_setting

import (
	"fmt"
	"math"
	"sort"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

const (
	ServiceTierSpecial = "special"
	ServiceTierLow     = "low"
	ServiceTierMedium  = "medium"
	ServiceTierHigh    = "high"
)

var serviceTiers = []string{
	ServiceTierSpecial,
	ServiceTierLow,
	ServiceTierMedium,
	ServiceTierHigh,
}

type FamilyTierCeilings struct {
	Special float64 `json:"special"`
	Low     float64 `json:"low"`
	Medium  float64 `json:"medium"`
	High    float64 `json:"high"`
}

type HubRoutingSetting struct {
	Enabled                bool                          `json:"enabled"`
	AllowOtherFamily       bool                          `json:"allow_other_family"`
	FamilyTierCeilings     map[string]FamilyTierCeilings `json:"family_tier_ceilings"`
	HighQualityProviderIDs []int                         `json:"high_quality_provider_ids"`
}

var defaultFamilyTierCeilings = map[string]FamilyTierCeilings{
	"anthropic": {Special: 0.20, Low: 0.40, Medium: 0.80, High: 1.00},
	"openai":    {Special: 0.10, Low: 0.30, Medium: 0.80, High: 1.00},
	"google":    {Special: 0.10, Low: 0.30, Medium: 0.80, High: 1.00},
	"xai":       {Special: 0.10, Low: 0.30, Medium: 0.80, High: 1.00},
	"deepseek":  {Special: 0.10, Low: 0.30, Medium: 0.80, High: 1.00},
	"alibaba":   {Special: 0.10, Low: 0.30, Medium: 0.80, High: 1.00},
	"bytedance": {Special: 0.10, Low: 0.30, Medium: 0.80, High: 1.00},
	"zhipu":     {Special: 0.10, Low: 0.30, Medium: 0.80, High: 1.00},
	"other":     {Special: 0.10, Low: 0.30, Medium: 0.80, High: 1.00},
}

var hubRoutingSetting = HubRoutingSetting{
	Enabled:                true,
	AllowOtherFamily:       false,
	FamilyTierCeilings:     cloneFamilyTierCeilings(defaultFamilyTierCeilings),
	HighQualityProviderIDs: []int{},
}

func init() {
	config.GlobalConfig.Register("hub_routing_setting", &hubRoutingSetting)
}

func Get() *HubRoutingSetting {
	return &hubRoutingSetting
}

func ServiceTiers() []string {
	return append([]string(nil), serviceTiers...)
}

func IsServiceTier(group string) bool {
	for _, tier := range serviceTiers {
		if group == tier {
			return true
		}
	}
	return false
}

func GetFamilyTierCeilings() map[string]FamilyTierCeilings {
	result := cloneFamilyTierCeilings(defaultFamilyTierCeilings)
	for family, ceilings := range hubRoutingSetting.FamilyTierCeilings {
		ceilings = normalizeLegacyFamilyTierCeilings(ceilings)
		if validFamilyTierCeilings(ceilings) {
			result[family] = ceilings
		}
	}
	return result
}

func ResolveEligibleServiceTiers(family string, multiplier float64, providerID int) []string {
	if !hubRoutingSetting.Enabled || multiplier <= 0 || math.IsNaN(multiplier) || math.IsInf(multiplier, 0) {
		return nil
	}
	if family == "other" && !hubRoutingSetting.AllowOtherFamily {
		return nil
	}
	ceilings, ok := GetFamilyTierCeilings()[family]
	if !ok || !validFamilyTierCeilings(ceilings) {
		return nil
	}

	tiers := make([]string, 0, 2)
	switch {
	case multiplier <= ceilings.Special:
		tiers = append(tiers, ServiceTierSpecial)
	case multiplier <= ceilings.Low:
		tiers = append(tiers, ServiceTierLow)
	case multiplier <= ceilings.Medium:
		tiers = append(tiers, ServiceTierMedium)
	}
	if multiplier <= ceilings.High && IsHighQualityProvider(providerID) {
		tiers = append(tiers, ServiceTierHigh)
	}
	return tiers
}

func IsHighQualityProvider(providerID int) bool {
	if providerID <= 0 {
		return false
	}
	ids := append([]int(nil), hubRoutingSetting.HighQualityProviderIDs...)
	sort.Ints(ids)
	index := sort.SearchInts(ids, providerID)
	return index < len(ids) && ids[index] == providerID
}

func ValidateOption(key, value string) error {
	switch key {
	case "hub_routing_setting.enabled", "hub_routing_setting.allow_other_family":
		if _, err := strconv.ParseBool(value); err != nil {
			return fmt.Errorf("invalid boolean routing setting")
		}
	case "hub_routing_setting.family_tier_ceilings":
		ceilings := make(map[string]FamilyTierCeilings)
		if err := common.Unmarshal([]byte(value), &ceilings); err != nil {
			return fmt.Errorf("invalid family tier ceilings: %w", err)
		}
		if len(ceilings) == 0 {
			return fmt.Errorf("family tier ceilings cannot be empty")
		}
		for family, familyCeilings := range ceilings {
			if !validFamilyTierCeilings(familyCeilings) {
				return fmt.Errorf("invalid tier ceilings for family %s", family)
			}
		}
	case "hub_routing_setting.high_quality_provider_ids":
		providerIDs := make([]int, 0)
		if err := common.Unmarshal([]byte(value), &providerIDs); err != nil {
			return fmt.Errorf("invalid high-quality provider list: %w", err)
		}
		seen := make(map[int]struct{}, len(providerIDs))
		for _, providerID := range providerIDs {
			if providerID <= 0 {
				return fmt.Errorf("provider IDs must be positive")
			}
			if _, exists := seen[providerID]; exists {
				return fmt.Errorf("provider IDs must be unique")
			}
			seen[providerID] = struct{}{}
		}
	}
	return nil
}

func validFamilyTierCeilings(value FamilyTierCeilings) bool {
	return finitePositive(value.Special) &&
		finitePositive(value.Low) &&
		finitePositive(value.Medium) &&
		finitePositive(value.High) &&
		value.Special < value.Low &&
		value.Low < value.Medium
}

func finitePositive(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func normalizeLegacyFamilyTierCeilings(value FamilyTierCeilings) FamilyTierCeilings {
	if value.High == 100 {
		value.High = 1
	}
	return value
}

func cloneFamilyTierCeilings(source map[string]FamilyTierCeilings) map[string]FamilyTierCeilings {
	result := make(map[string]FamilyTierCeilings, len(source))
	for family, ceilings := range source {
		result[family] = ceilings
	}
	return result
}
