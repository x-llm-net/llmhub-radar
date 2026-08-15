package hub_provider_settlement_setting

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

const (
	OptionKeyPlatformFeeBasisPoints = "hub_provider_settlement_setting.platform_fee_basis_points"
	OptionKeyMinimumWithdrawalQuota = "hub_provider_settlement_setting.minimum_withdrawal_quota"

	DefaultPlatformFeeBasisPoints = 1000
	DefaultMinimumWithdrawalQuota = 0
)

type HubProviderSettlementSetting struct {
	PlatformFeeBasisPoints int `json:"platform_fee_basis_points"`
	MinimumWithdrawalQuota int `json:"minimum_withdrawal_quota"`
}

var hubProviderSettlementSetting = HubProviderSettlementSetting{
	PlatformFeeBasisPoints: DefaultPlatformFeeBasisPoints,
	MinimumWithdrawalQuota: DefaultMinimumWithdrawalQuota,
}

func init() {
	config.GlobalConfig.Register("hub_provider_settlement_setting", &hubProviderSettlementSetting)
}

func Get() *HubProviderSettlementSetting {
	return &hubProviderSettlementSetting
}

func PlatformFeeBasisPoints() int {
	value := hubProviderSettlementSetting.PlatformFeeBasisPoints
	if value < 0 || value > 10000 {
		return DefaultPlatformFeeBasisPoints
	}
	return value
}

func MinimumWithdrawalQuota() int {
	value := hubProviderSettlementSetting.MinimumWithdrawalQuota
	if value < 0 {
		return DefaultMinimumWithdrawalQuota
	}
	return value
}

func IsOptionKey(key string) bool {
	return key == OptionKeyPlatformFeeBasisPoints || key == OptionKeyMinimumWithdrawalQuota
}

func ValidateOption(key, raw string) error {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("invalid provider settlement setting")
	}
	switch key {
	case OptionKeyPlatformFeeBasisPoints:
		if value < 0 || value > 10000 {
			return fmt.Errorf("provider platform fee must be between 0 and 10000 basis points")
		}
	case OptionKeyMinimumWithdrawalQuota:
		if value < 0 {
			return fmt.Errorf("minimum provider withdrawal quota cannot be negative")
		}
	}
	return nil
}
