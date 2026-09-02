package hub_provider_settlement_setting

import (
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/setting/config"
)

const (
	// PlatformFeeBasisPoints is the platform's share of the reseller's gross
	// income. It is deliberately separate from the provider service fee.
	OptionKeyPlatformFeeBasisPoints        = "hub_provider_settlement_setting.platform_fee_basis_points"
	OptionKeyProviderServiceFeeBasisPoints = "hub_provider_settlement_setting.provider_service_fee_basis_points"
	OptionKeyMinimumWithdrawalQuota        = "hub_provider_settlement_setting.minimum_withdrawal_quota"
	OptionKeyFallbackReferralEnabled       = "hub_provider_settlement_setting.fallback_referral_enabled"
	OptionKeyFallbackReferralBasisPoints   = "hub_provider_settlement_setting.fallback_referral_basis_points"

	DefaultPlatformFeeBasisPoints        = 3000
	DefaultProviderServiceFeeBasisPoints = 1000
	DefaultMinimumWithdrawalQuota        = 0
	DefaultFallbackReferralEnabled       = true
	DefaultFallbackReferralBasisPoints   = 2000
)

type HubProviderSettlementSetting struct {
	PlatformFeeBasisPoints        int  `json:"platform_fee_basis_points"`
	ProviderServiceFeeBasisPoints int  `json:"provider_service_fee_basis_points"`
	MinimumWithdrawalQuota        int  `json:"minimum_withdrawal_quota"`
	FallbackReferralEnabled       bool `json:"fallback_referral_enabled"`
	FallbackReferralBasisPoints   int  `json:"fallback_referral_basis_points"`
}

var hubProviderSettlementSetting = HubProviderSettlementSetting{
	PlatformFeeBasisPoints:        DefaultPlatformFeeBasisPoints,
	ProviderServiceFeeBasisPoints: DefaultProviderServiceFeeBasisPoints,
	MinimumWithdrawalQuota:        DefaultMinimumWithdrawalQuota,
	FallbackReferralEnabled:       DefaultFallbackReferralEnabled,
	FallbackReferralBasisPoints:   DefaultFallbackReferralBasisPoints,
}

var hubProviderSettlementSettingMutex sync.RWMutex

func init() {
	config.GlobalConfig.Register("hub_provider_settlement_setting", &hubProviderSettlementSetting)
}

func Get() *HubProviderSettlementSetting {
	return &hubProviderSettlementSetting
}

func Snapshot() HubProviderSettlementSetting {
	hubProviderSettlementSettingMutex.RLock()
	defer hubProviderSettlementSettingMutex.RUnlock()
	return hubProviderSettlementSetting
}

// UpdateFromMap publishes all supplied settlement fields as one runtime
// snapshot. Database persistence is handled by the caller.
func UpdateFromMap(values map[string]string) error {
	for key, raw := range values {
		if !IsOptionKey(key) {
			continue
		}
		if err := ValidateOption(key, raw); err != nil {
			return err
		}
	}

	next := Snapshot()
	for key, raw := range values {
		switch key {
		case OptionKeyPlatformFeeBasisPoints:
			next.PlatformFeeBasisPoints, _ = strconv.Atoi(strings.TrimSpace(raw))
		case OptionKeyProviderServiceFeeBasisPoints:
			next.ProviderServiceFeeBasisPoints, _ = strconv.Atoi(strings.TrimSpace(raw))
		case OptionKeyMinimumWithdrawalQuota:
			next.MinimumWithdrawalQuota, _ = strconv.Atoi(strings.TrimSpace(raw))
		case OptionKeyFallbackReferralEnabled:
			next.FallbackReferralEnabled, _ = strconv.ParseBool(strings.TrimSpace(raw))
		case OptionKeyFallbackReferralBasisPoints:
			next.FallbackReferralBasisPoints, _ = strconv.Atoi(strings.TrimSpace(raw))
		}
	}
	hubProviderSettlementSettingMutex.Lock()
	hubProviderSettlementSetting = next
	hubProviderSettlementSettingMutex.Unlock()
	return nil
}

func PlatformFeeBasisPoints() int {
	value := Snapshot().PlatformFeeBasisPoints
	if value < 0 || value > 10000 {
		return DefaultPlatformFeeBasisPoints
	}
	return value
}

func ProviderServiceFeeBasisPoints() int {
	value := Snapshot().ProviderServiceFeeBasisPoints
	if value < 0 || value > 10000 {
		return DefaultProviderServiceFeeBasisPoints
	}
	return value
}

func MinimumWithdrawalQuota() int {
	value := Snapshot().MinimumWithdrawalQuota
	if value < 0 {
		return DefaultMinimumWithdrawalQuota
	}
	return value
}

func FallbackReferralEnabled() bool {
	return Snapshot().FallbackReferralEnabled
}

func FallbackReferralPolicy() (bool, int) {
	snapshot := Snapshot()
	basisPoints := snapshot.FallbackReferralBasisPoints
	if basisPoints < 0 || basisPoints > 10000 {
		basisPoints = DefaultFallbackReferralBasisPoints
	}
	return snapshot.FallbackReferralEnabled, basisPoints
}

func FallbackReferralBasisPoints() int {
	_, basisPoints := FallbackReferralPolicy()
	return basisPoints
}

func IsOptionKey(key string) bool {
	return key == OptionKeyPlatformFeeBasisPoints || key == OptionKeyProviderServiceFeeBasisPoints || key == OptionKeyMinimumWithdrawalQuota ||
		key == OptionKeyFallbackReferralEnabled || key == OptionKeyFallbackReferralBasisPoints
}

func ValidateOption(key, raw string) error {
	if key == OptionKeyFallbackReferralEnabled {
		if _, err := strconv.ParseBool(strings.TrimSpace(raw)); err != nil {
			return fmt.Errorf("invalid fallback referral enabled setting")
		}
		return nil
	}
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("invalid provider settlement setting")
	}
	switch key {
	case OptionKeyPlatformFeeBasisPoints:
		if value < 0 || value > 10000 {
			return fmt.Errorf("provider platform fee must be between 0 and 10000 basis points")
		}
	case OptionKeyProviderServiceFeeBasisPoints:
		if value < 0 || value > 10000 {
			return fmt.Errorf("provider service fee must be between 0 and 10000 basis points")
		}
	case OptionKeyMinimumWithdrawalQuota:
		if value < 0 {
			return fmt.Errorf("minimum provider withdrawal quota cannot be negative")
		}
	case OptionKeyFallbackReferralBasisPoints:
		if value < 0 || value > 10000 {
			return fmt.Errorf("fallback referral commission must be between 0 and 10000 basis points")
		}
	}
	return nil
}
