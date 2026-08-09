package setting

import (
	"encoding/json"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
)

var userUsableGroups = map[string]string{
	"default": "默认分组",
	"vip":     "vip分组",
}
var userUsableGroupsMutex sync.RWMutex

var serviceTierDescriptions = map[string]string{
	hub_routing_setting.ServiceTierSpecial: "特价",
	hub_routing_setting.ServiceTierLow:     "经济",
	hub_routing_setting.ServiceTierMedium:  "标准",
	hub_routing_setting.ServiceTierHigh:    "高品质",
}

func GetUserUsableGroupsCopy() map[string]string {
	userUsableGroupsMutex.RLock()
	defer userUsableGroupsMutex.RUnlock()

	copyUserUsableGroups := make(map[string]string)
	for k, v := range userUsableGroups {
		copyUserUsableGroups[k] = v
	}
	for group, description := range serviceTierDescriptions {
		copyUserUsableGroups[group] = description
	}
	return copyUserUsableGroups
}

func UserUsableGroups2JSONString() string {
	userUsableGroupsMutex.RLock()
	defer userUsableGroupsMutex.RUnlock()

	groups := make(map[string]string, len(userUsableGroups)+len(serviceTierDescriptions))
	for group, description := range userUsableGroups {
		groups[group] = description
	}
	for group, description := range serviceTierDescriptions {
		groups[group] = description
	}
	jsonBytes, err := json.Marshal(groups)
	if err != nil {
		common.SysLog("error marshalling user groups: " + err.Error())
	}
	return string(jsonBytes)
}

func UpdateUserUsableGroupsByJSONString(jsonStr string) error {
	userUsableGroupsMutex.Lock()
	defer userUsableGroupsMutex.Unlock()

	userUsableGroups = make(map[string]string)
	return json.Unmarshal([]byte(jsonStr), &userUsableGroups)
}

func GetUsableGroupDescription(groupName string) string {
	userUsableGroupsMutex.RLock()
	defer userUsableGroupsMutex.RUnlock()

	if desc, ok := userUsableGroups[groupName]; ok {
		return desc
	}
	if desc, ok := serviceTierDescriptions[groupName]; ok {
		return desc
	}
	return groupName
}
