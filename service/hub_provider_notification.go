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
	"sort"
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
	HubModelPriceNotificationType          = "hub_model_price_missing"
)

const hubModelPriceNotificationSuppressWindowSeconds = int64(time.Hour / time.Second)

var sendHubProviderApplicantEmail = common.SendEmail

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

func NotifyHubProviderReview(providerID int, previousStatus string, status string, reviewRemark string) {
	config := hub_provider_notification_setting.Get()
	notifyAdministrators := config.Enabled && config.NotifyOnReview
	notifyApplicant := shouldNotifyHubProviderApplicant(previousStatus, status)
	if !notifyAdministrators && !notifyApplicant {
		return
	}
	var provider model.HubProvider
	if err := model.DB.First(&provider, providerID).Error; err != nil {
		common.SysLog(fmt.Sprintf("failed to load provider %d for review notification: %v", providerID, err))
		return
	}
	if notifyAdministrators {
		title := fmt.Sprintf("渠道商审核结果：%s", hubProviderStatusLabel(status))
		content := formatHubProviderReviewContent(&provider, status, reviewRemark)
		notifyHubProviderEvent(config, HubProviderReviewNotificationType, title, content, providerNotificationLink())
	}
	if notifyApplicant {
		gopool.Go(func() {
			if err := deliverHubProviderApplicantReview(&provider, status, reviewRemark); err != nil {
				common.SysLog(fmt.Sprintf("failed to notify provider applicant %d: %v", provider.OwnerUserId, err))
			}
		})
	}
}

func shouldNotifyHubProviderApplicant(previousStatus string, status string) bool {
	if previousStatus != model.HubProviderStatusPending {
		return false
	}
	return status == model.HubProviderStatusActive || status == model.HubProviderStatusRejected
}

func deliverHubProviderApplicantReview(provider *model.HubProvider, status string, reviewRemark string) error {
	email, err := model.GetUserEmail(provider.OwnerUserId)
	if err != nil {
		return fmt.Errorf("load applicant email: %w", err)
	}
	if strings.TrimSpace(email) == "" {
		return nil
	}
	subject, content := formatHubProviderApplicantReviewEmail(provider, status, reviewRemark)
	return sendHubProviderApplicantEmail(subject, email, content)
}

func formatHubProviderApplicantReviewEmail(provider *model.HubProvider, status string, reviewRemark string) (string, string) {
	result := hubProviderStatusLabel(status)
	subject := "渠道商申请" + result
	details := fmt.Sprintf(
		"<p>你的渠道商申请审核已完成。</p><p><strong>渠道商：</strong>%s<br><strong>审核结果：</strong>%s</p>",
		html.EscapeString(provider.Name),
		html.EscapeString(result),
	)
	if reviewRemark = strings.TrimSpace(reviewRemark); reviewRemark != "" {
		details += fmt.Sprintf("<p><strong>审核备注：</strong>%s</p>", html.EscapeString(reviewRemark))
	}
	details += "<p>请登录提交申请时使用的站点查看详情。</p>"
	return subject, details
}

// NotifyHubModelPriceMissing alerts the same administrator targets used by
// provider application notifications. Missing prices can be encountered by
// probes and user requests, so each model is suppressed for one hour to avoid
// turning a configuration issue into a notification storm.
func NotifyHubModelPriceMissing(modelName string, channelID int, channelName string) {
	config := hub_provider_notification_setting.Get()
	if !config.Enabled {
		return
	}
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return
	}
	notified, err := model.ClaimHubModelPriceNotification(
		modelName,
		common.GetTimestamp(),
		hubModelPriceNotificationSuppressWindowSeconds,
	)
	if err != nil {
		common.SysError(fmt.Sprintf("failed to claim missing model price notification for %s: %v", modelName, err))
		return
	}
	if !notified {
		return
	}
	channelLabel := hubModelPriceChannelLabel(channelID, channelName)

	notifyHubProviderEvent(
		config,
		HubModelPriceNotificationType,
		"模型价格未配置",
		fmt.Sprintf("模型：%s\n渠道：%s\n原因：平台基础价格尚未配置，请在模型定价页面补充。", modelName, channelLabel),
		modelPricingNotificationLink(),
	)
}

// NotifyHubModelPricesMissing sends one administrator notification for the
// newly reported models from the provider model-management dialog.
func NotifyHubModelPricesMissing(modelNames []string, channelID int, channelName string) (bool, bool, error) {
	config := hub_provider_notification_setting.Get()
	if !config.Enabled {
		return false, false, nil
	}
	names := make([]string, 0, len(modelNames))
	seen := make(map[string]struct{}, len(modelNames))
	for _, modelName := range modelNames {
		modelName = strings.TrimSpace(modelName)
		if modelName == "" {
			continue
		}
		key := strings.ToLower(modelName)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		names = append(names, modelName)
	}
	if len(names) == 0 {
		return false, false, nil
	}
	sort.SliceStable(names, func(i, j int) bool {
		return strings.ToLower(names[i]) < strings.ToLower(names[j])
	})

	newNames := make([]string, 0, len(names))
	for _, modelName := range names {
		notified, err := model.ClaimHubModelPriceNotification(
			modelName,
			common.GetTimestamp(),
			hubModelPriceNotificationSuppressWindowSeconds,
		)
		if err != nil {
			return false, false, fmt.Errorf("failed to claim missing model price notification for %s: %w", modelName, err)
		}
		if notified {
			newNames = append(newNames, modelName)
		}
	}
	if len(newNames) == 0 {
		return false, true, nil
	}

	channelLabel := hubModelPriceChannelLabel(channelID, channelName)

	notifyHubProviderEvent(
		config,
		HubModelPriceNotificationType,
		"模型价格未配置",
		fmt.Sprintf("渠道：%s\n缺少价格的模型（%d 个）：\n- %s\n原因：平台基础价格尚未配置，请在模型定价页面补充。", channelLabel, len(newNames), strings.Join(newNames, "\n- ")),
		modelPricingNotificationLink(),
	)
	return true, false, nil
}

func hubModelPriceChannelLabel(channelID int, channelName string) string {
	if channelName = strings.TrimSpace(channelName); channelName != "" {
		return channelName
	}
	if channelID > 0 && model.DB != nil {
		var channel model.Channel
		if err := model.DB.Select("name").First(&channel, channelID).Error; err == nil && strings.TrimSpace(channel.Name) != "" {
			return fmt.Sprintf("%s (#%d)", strings.TrimSpace(channel.Name), channelID)
		}
		return fmt.Sprintf("渠道 #%d", channelID)
	}
	return "未知渠道"
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

func modelPricingNotificationLink() string {
	base := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	if base == "" {
		return "/system-settings/billing/model-pricing"
	}
	return base + "/system-settings/billing/model-pricing"
}
