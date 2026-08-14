package hub_provider_setting

import "github.com/QuantumNous/new-api/setting/config"

type HubProviderSetting struct {
	OriginVerificationEnabled bool `json:"origin_verification_enabled"`
}

var hubProviderSetting = HubProviderSetting{
	OriginVerificationEnabled: false,
}

func init() {
	config.GlobalConfig.Register("hub_provider_setting", &hubProviderSetting)
}

func Get() *HubProviderSetting {
	return &hubProviderSetting
}

func IsOriginVerificationEnabled() bool {
	return hubProviderSetting.OriginVerificationEnabled
}
