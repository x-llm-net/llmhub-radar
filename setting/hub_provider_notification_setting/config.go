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
package hub_provider_notification_setting

import (
	"fmt"
	"net/mail"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const OptionKey = "hub_provider_notification.settings"

const (
	MaxEmailRecipients = 20
	MaxWebhooks        = 20
	MaxWebhookName     = 64
	MaxWebhookURL      = 2048
)

type WebhookTarget struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URL     string `json:"url"`
	Enabled bool   `json:"enabled"`
}

type Config struct {
	Enabled             bool            `json:"enabled"`
	NotifyOnApplication bool            `json:"notify_on_application"`
	NotifyOnReview      bool            `json:"notify_on_review"`
	EmailRecipients     []string        `json:"email_recipients"`
	Webhooks            []WebhookTarget `json:"webhooks"`
}

func Default() Config {
	return Config{
		Enabled:             true,
		NotifyOnApplication: true,
		NotifyOnReview:      true,
		EmailRecipients:     []string{},
		Webhooks:            []WebhookTarget{},
	}
}

func Get() Config {
	config := Default()
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[OptionKey]
	common.OptionMapRWMutex.RUnlock()
	if strings.TrimSpace(raw) == "" {
		return config
	}
	if err := common.UnmarshalJsonStr(raw, &config); err != nil {
		common.SysLog(fmt.Sprintf("failed to load hub provider notification settings: %v", err))
		return Default()
	}
	normalized, err := Normalize(config)
	if err != nil {
		common.SysLog(fmt.Sprintf("invalid hub provider notification settings: %v", err))
		return Default()
	}
	return normalized
}

func Normalize(config Config) (Config, error) {
	var err error
	config.EmailRecipients, err = normalizeEmails(config.EmailRecipients)
	if err != nil {
		return Config{}, err
	}
	if len(config.EmailRecipients) > MaxEmailRecipients {
		return Config{}, fmt.Errorf("too many email recipients")
	}
	if len(config.Webhooks) > MaxWebhooks {
		return Config{}, fmt.Errorf("too many webhook targets")
	}

	webhooks := make([]WebhookTarget, 0, len(config.Webhooks))
	seenURLs := make(map[string]struct{}, len(config.Webhooks))
	for _, target := range config.Webhooks {
		target.ID = strings.TrimSpace(target.ID)
		target.Name = strings.TrimSpace(target.Name)
		target.URL = strings.TrimSpace(target.URL)
		if target.ID == "" {
			target.ID = common.GetRandomString(10)
		}
		if target.Name == "" {
			target.Name = "企业微信机器人"
		}
		if len([]rune(target.Name)) > MaxWebhookName {
			return Config{}, fmt.Errorf("webhook name is too long")
		}
		if target.URL == "" {
			return Config{}, fmt.Errorf("webhook URL cannot be empty")
		}
		if len(target.URL) > MaxWebhookURL {
			return Config{}, fmt.Errorf("webhook URL is too long")
		}
		parsed, err := url.ParseRequestURI(target.URL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return Config{}, fmt.Errorf("webhook URL is invalid")
		}
		if _, exists := seenURLs[target.URL]; exists {
			continue
		}
		seenURLs[target.URL] = struct{}{}
		webhooks = append(webhooks, target)
	}
	config.Webhooks = webhooks
	return config, nil
}

func normalizeEmails(emails []string) ([]string, error) {
	seen := make(map[string]struct{}, len(emails))
	result := make([]string, 0, len(emails))
	for _, email := range emails {
		email = strings.TrimSpace(email)
		if email == "" {
			continue
		}
		parsed, err := mail.ParseAddress(email)
		if err != nil || parsed.Address != email {
			return nil, fmt.Errorf("email recipient is invalid")
		}
		key := strings.ToLower(email)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, email)
	}
	return result, nil
}
