/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package hub_public_home_setting

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const OptionKeyModelBlacklist = "hub_public_home.model_blacklist"

const DefaultModelBlacklistJSON = `["codex-auto-review"]`

func GetModelBlacklist() []string {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[OptionKeyModelBlacklist]
	common.OptionMapRWMutex.RUnlock()

	models, err := parseModelBlacklist(raw)
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to load public home model blacklist: %v", err))
		return []string{}
	}
	return models
}

func ValidateOption(key, value string) error {
	if key != OptionKeyModelBlacklist {
		return nil
	}
	_, err := parseModelBlacklist(value)
	return err
}

func parseModelBlacklist(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return []string{}, nil
	}

	var models []string
	if err := common.Unmarshal([]byte(raw), &models); err != nil {
		return nil, fmt.Errorf("model blacklist must be a JSON array of strings: %w", err)
	}

	result := make([]string, 0, len(models))
	seen := make(map[string]struct{}, len(models))
	for _, modelName := range models {
		modelName = strings.TrimSpace(modelName)
		if modelName == "" {
			continue
		}
		if _, exists := seen[modelName]; exists {
			continue
		}
		seen[modelName] = struct{}{}
		result = append(result, modelName)
	}
	return result, nil
}
