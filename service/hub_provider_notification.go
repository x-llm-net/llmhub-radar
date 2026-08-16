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
package service

import (
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/hub_provider_notification_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/bytedance/gopkg/util/gopool"
)

const (
	HubProviderApplicationNotificationType = "hub_provider_application"
	HubProviderReviewNotificationType      = "hub_provider_review"
)

func NotifyHubProviderApplication(provider *model.HubProvider) {
	config := hub_provider_notification_setting.Get()
	if !config.Enabled || !config.NotifyOnApplication {
		return
	}
	notifyHubProviderEvent(
		config,
		HubProviderApplicationNotificationType,
		"新的渠道商申请",
		formatHubProviderApplicationContent(provider),
		providerNotificationLink(),
	)
}

func NotifyHubProviderReview(providerID int, status string, reviewRemark string) {
	config := hub_provider_notification_setting.Get()
	if !config.Enabled || !config.NotifyOnReview {
		return
	}
	var provider model.HubProvider
	if err := model.DB.First(&provider, providerID).Error; err != nil {
		common.SysLog(fmt.Sprintf("failed to load provider %d for review notification: %v", providerID, err))
		return
	}
	title := fmt.Sprintf("渠道商审核结果：%s", hubProviderStatusLabel(status))
	content := formatHubProviderReviewContent(&provider, status, reviewRemark)
	notifyHubProviderEvent(config, HubProviderReviewNotificationType, title, content, providerNotificationLink())
}

func TestHubProviderNotification() error {
	config := hub_provider_notification_setting.Get()
	if !config.Enabled {
		return fmt.Errorf("渠道商通知已关闭")
	}
	if len(config.EmailRecipients) == 0 && len(enabledHubProviderWebhooks(config)) == 0 {
		return fmt.Errorf("请先配置至少一个邮箱或企业微信 Webhook")
	}
	notification := &model.HubAdminNotification{
		Type:    "hub_provider_notification_test",
		Title:   "渠道商通知测试",
		Content: "这是一条渠道商通知测试消息。",
		Link:    providerNotificationLink(),
	}
	return deliverHubProviderNotification(config, notification)
}

func notifyHubProviderEvent(
	config hub_provider_notification_setting.Config,
	typeName string,
	title string,
	content string,
	link string,
) {
	notification := &model.HubAdminNotification{
		Type:    typeName,
		Title:   title,
		Content: content,
		Link:    link,
	}
	if err := model.CreateHubAdminNotification(notification); err != nil {
		common.SysLog(fmt.Sprintf("failed to create hub provider notification: %v", err))
		return
	}

	gopool.Go(func() {
		if err := deliverHubProviderNotification(config, notification); err != nil {
			common.SysLog(fmt.Sprintf("failed to deliver hub provider notification %d: %v", notification.Id, err))
		}
	})
}

func deliverHubProviderNotification(config hub_provider_notification_setting.Config, notification *model.HubAdminNotification) error {
	var failures []string
	if len(config.EmailRecipients) > 0 {
		recipients := strings.Join(config.EmailRecipients, ";")
		emailContent := fmt.Sprintf(
			"<p>%s</p><p>%s</p><p><a href=\"%s\">打开后台</a></p>",
			html.EscapeString(notification.Title),
			html.EscapeString(strings.ReplaceAll(notification.Content, "\n", "<br>")),
			html.EscapeString(notification.Link),
		)
		if err := retryHubProviderNotification(func() error {
			return common.SendEmail(notification.Title, recipients, emailContent)
		}); err != nil {
			failures = append(failures, "email: "+err.Error())
		}
	}
	for _, webhook := range enabledHubProviderWebhooks(config) {
		webhook := webhook
		if err := retryHubProviderNotification(func() error {
			return SendWeComWebhook(webhook.URL, formatWeComContent(notification))
		}); err != nil {
			failures = append(failures, webhook.Name+": "+err.Error())
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("%s", strings.Join(failures, "; "))
	}
	return nil
}

func retryHubProviderNotification(send func() error) error {
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		err = send()
		if err == nil {
			return nil
		}
		if attempt == 0 {
			time.Sleep(300 * time.Millisecond)
		}
	}
	return err
}

func enabledHubProviderWebhooks(config hub_provider_notification_setting.Config) []hub_provider_notification_setting.WebhookTarget {
	result := make([]hub_provider_notification_setting.WebhookTarget, 0, len(config.Webhooks))
	for _, webhook := range config.Webhooks {
		if webhook.Enabled {
			result = append(result, webhook)
		}
	}
	return result
}

func formatHubProviderApplicationContent(provider *model.HubProvider) string {
	return fmt.Sprintf("渠道商：%s\n子域名：%s\n当前状态：审核中", provider.Name, provider.Slug)
}

func formatHubProviderReviewContent(provider *model.HubProvider, status string, reviewRemark string) string {
	content := fmt.Sprintf("渠道商：%s\n子域名：%s\n审核结果：%s", provider.Name, provider.Slug, hubProviderStatusLabel(status))
	if strings.TrimSpace(reviewRemark) != "" {
		content += "\n审核备注：" + strings.TrimSpace(reviewRemark)
	}
	return content
}

func formatWeComContent(notification *model.HubAdminNotification) string {
	return fmt.Sprintf("**%s**\n%s\n[打开后台](%s)", notification.Title, notification.Content, notification.Link)
}

func hubProviderStatusLabel(status string) string {
	switch status {
	case model.HubProviderStatusActive:
		return "已通过"
	case model.HubProviderStatusRejected:
		return "已拒绝"
	case model.HubProviderStatusDisabled:
		return "已禁用"
	case model.HubProviderStatusPending:
		return "审核中"
	default:
		return status
	}
}

func providerNotificationLink() string {
	base := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	if base == "" {
		return "/providers"
	}
	return base + "/providers"
}
