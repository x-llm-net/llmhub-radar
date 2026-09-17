/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

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
	"context"
	"fmt"
	"html"
	"net/mail"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

const (
	hubWeeklyDigestWorkerCount = 8
	hubWeeklyDigestMaxAttempts = 3
)

var (
	hubWeeklyDigestLocation = func() *time.Location {
		location, err := time.LoadLocation("Asia/Shanghai")
		if err != nil {
			return time.FixedZone("Asia/Shanghai", 8*60*60)
		}
		return location
	}()
	sendHubWeeklyDigestEmail = common.SendEmail
)

type HubWeeklyDigestPayload struct {
	WeekStart   int64 `json:"week_start"`
	WeekEnd     int64 `json:"week_end"`
	RetryFailed bool  `json:"retry_failed,omitempty"`
}

type HubWeeklyDigestResult struct {
	Total   int `json:"total"`
	Sent    int `json:"sent"`
	Skipped int `json:"skipped"`
	Failed  int `json:"failed"`
}

type hubWeeklyDigestOutcome string

const (
	hubWeeklyDigestOutcomeSent    hubWeeklyDigestOutcome = "sent"
	hubWeeklyDigestOutcomeSkipped hubWeeklyDigestOutcome = "skipped"
	hubWeeklyDigestOutcomeFailed  hubWeeklyDigestOutcome = "failed"
)

// CurrentHubWeeklyDigestPayload returns the most recent completed natural week
// once its Monday 09:30 Asia/Shanghai delivery time has arrived.
func CurrentHubWeeklyDigestPayload(now time.Time) (HubWeeklyDigestPayload, bool) {
	localNow := now.In(hubWeeklyDigestLocation)
	daysSinceMonday := (int(localNow.Weekday()) + 6) % 7
	currentMonday := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, hubWeeklyDigestLocation).
		AddDate(0, 0, -daysSinceMonday)
	if localNow.Before(currentMonday.Add(9*time.Hour + 30*time.Minute)) {
		return HubWeeklyDigestPayload{}, false
	}
	return HubWeeklyDigestPayload{
		WeekStart: currentMonday.AddDate(0, 0, -7).Unix(),
		WeekEnd:   currentMonday.Unix(),
	}, true
}

func RunHubWeeklyDigest(
	ctx context.Context,
	payload HubWeeklyDigestPayload,
	progress func(processed, total int),
) (HubWeeklyDigestResult, error) {
	result := HubWeeklyDigestResult{}
	if payload.WeekStart <= 0 || payload.WeekEnd <= payload.WeekStart {
		return result, fmt.Errorf("invalid weekly digest window")
	}
	recipients, err := model.ListHubWeeklyDigestRecipients()
	if err != nil {
		return result, err
	}
	result.Total = len(recipients)
	if len(recipients) == 0 {
		if progress != nil {
			progress(0, 0)
		}
		return result, nil
	}

	workerCount := hubWeeklyDigestWorkerCount
	if len(recipients) < workerCount {
		workerCount = len(recipients)
	}
	jobs := make(chan model.HubWeeklyDigestRecipient)
	outcomes := make(chan hubWeeklyDigestOutcome, len(recipients))
	var workers sync.WaitGroup
	workers.Add(workerCount)
	for i := 0; i < workerCount; i++ {
		go func() {
			defer workers.Done()
			for recipient := range jobs {
				outcomes <- deliverHubWeeklyDigest(ctx, payload, recipient)
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, recipient := range recipients {
			select {
			case <-ctx.Done():
				return
			case jobs <- recipient:
			}
		}
	}()
	go func() {
		workers.Wait()
		close(outcomes)
	}()

	processed := 0
	for outcome := range outcomes {
		processed++
		switch outcome {
		case hubWeeklyDigestOutcomeSent:
			result.Sent++
		case hubWeeklyDigestOutcomeSkipped:
			result.Skipped++
		default:
			result.Failed++
		}
		if progress != nil {
			progress(processed, result.Total)
		}
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	return result, nil
}

func deliverHubWeeklyDigest(ctx context.Context, payload HubWeeklyDigestPayload, recipient model.HubWeeklyDigestRecipient) hubWeeklyDigestOutcome {
	setting := dto.UserSetting{}
	if strings.TrimSpace(recipient.Setting) != "" {
		if err := common.UnmarshalJsonStr(recipient.Setting, &setting); err != nil {
			common.SysLog(fmt.Sprintf("failed to decode weekly digest setting for user %d: %v", recipient.UserId, err))
		}
	}
	providerEnabled := recipient.ProviderId > 0 && settingEnabledByDefault(setting.WeeklyProviderDigestEnabled)
	tenantEnabled := recipient.TenantId > 0 && settingEnabledByDefault(setting.WeeklyTenantDigestEnabled)
	email := strings.TrimSpace(setting.NotificationEmail)
	if email == "" {
		email = strings.TrimSpace(recipient.Email)
	}
	var delivery *model.HubWeeklyDigestDelivery
	var err error
	if payload.RetryFailed {
		delivery, err = model.GetHubWeeklyDigestDelivery(payload.WeekStart, recipient.UserId)
		if err == nil && delivery == nil {
			return hubWeeklyDigestOutcomeSkipped
		}
	} else {
		delivery, err = model.EnsureHubWeeklyDigestDelivery(payload.WeekStart, payload.WeekEnd, recipient, email)
	}
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to load weekly digest delivery for user %d: %v", recipient.UserId, err))
		return hubWeeklyDigestOutcomeFailed
	}
	if payload.RetryFailed {
		if delivery.Status != model.HubWeeklyDigestDeliveryStatusFailed {
			return hubWeeklyDigestOutcomeSkipped
		}
		if err := model.ResetFailedHubWeeklyDigestDelivery(delivery.Id); err != nil {
			common.SysLog(fmt.Sprintf("failed to reset weekly digest delivery %d: %v", delivery.Id, err))
			return hubWeeklyDigestOutcomeFailed
		}
		delivery.Status = model.HubWeeklyDigestDeliveryStatusPending
		delivery.Attempts = 0
	}
	if delivery.Status == model.HubWeeklyDigestDeliveryStatusSent || delivery.Status == model.HubWeeklyDigestDeliveryStatusSkipped {
		return hubWeeklyDigestOutcomeSkipped
	}
	if delivery.Status == model.HubWeeklyDigestDeliveryStatusFailed && delivery.Attempts >= hubWeeklyDigestMaxAttempts {
		return hubWeeklyDigestOutcomeFailed
	}
	if !tenantEnabled && !providerEnabled {
		return skipHubWeeklyDigestDelivery(delivery.Id, "weekly digest disabled")
	}
	if email == "" {
		return skipHubWeeklyDigestDelivery(delivery.Id, "recipient email is empty")
	}
	parsedEmail, parseEmailErr := mail.ParseAddress(email)
	if parseEmailErr != nil || parsedEmail.Address != email {
		return skipHubWeeklyDigestDelivery(delivery.Id, "recipient email is invalid")
	}

	var tenantSummary *model.HubWeeklyDigestTenantSummary
	if tenantEnabled {
		summary, summaryErr := model.GetHubWeeklyDigestTenantSummary(recipient.TenantId, payload.WeekStart, payload.WeekEnd)
		if summaryErr != nil {
			message := "load tenant weekly digest: " + summaryErr.Error()
			_ = model.FinishHubWeeklyDigestDelivery(delivery.Id, model.HubWeeklyDigestDeliveryStatusFailed, message)
			common.SysLog(fmt.Sprintf("weekly digest delivery %d failed: %s", delivery.Id, message))
			return hubWeeklyDigestOutcomeFailed
		}
		tenantSummary = &summary
	}
	var providerSummary *model.HubWeeklyDigestProviderSummary
	if providerEnabled {
		summary, summaryErr := model.GetHubWeeklyDigestProviderSummary(recipient.ProviderId, payload.WeekStart, payload.WeekEnd)
		if summaryErr != nil {
			message := "load provider weekly digest: " + summaryErr.Error()
			_ = model.FinishHubWeeklyDigestDelivery(delivery.Id, model.HubWeeklyDigestDeliveryStatusFailed, message)
			common.SysLog(fmt.Sprintf("weekly digest delivery %d failed: %s", delivery.Id, message))
			return hubWeeklyDigestOutcomeFailed
		}
		providerSummary = &summary
	}
	if !hubWeeklyDigestHasActivity(tenantSummary, providerSummary) {
		return skipHubWeeklyDigestDelivery(delivery.Id, "no weekly activity")
	}

	subject, content := formatHubWeeklyDigestEmail(payload, recipient, tenantSummary, providerSummary)
	lastError := ""
	for attempt := delivery.Attempts; attempt < hubWeeklyDigestMaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			lastError = err.Error()
			break
		}
		if err := model.StartHubWeeklyDigestDeliveryAttempt(delivery.Id, email); err != nil {
			lastError = err.Error()
			break
		}
		if err := sendHubWeeklyDigestEmail(subject, email, content); err == nil {
			if err := model.FinishHubWeeklyDigestDelivery(delivery.Id, model.HubWeeklyDigestDeliveryStatusSent, ""); err != nil {
				common.SysLog(fmt.Sprintf("failed to mark weekly digest delivery %d sent: %v", delivery.Id, err))
				return hubWeeklyDigestOutcomeFailed
			}
			return hubWeeklyDigestOutcomeSent
		} else {
			lastError = err.Error()
			_ = model.FinishHubWeeklyDigestDelivery(delivery.Id, model.HubWeeklyDigestDeliveryStatusFailed, lastError)
		}
		if attempt+1 < hubWeeklyDigestMaxAttempts {
			timer := time.NewTimer(time.Duration(attempt+1) * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				lastError = ctx.Err().Error()
				attempt = hubWeeklyDigestMaxAttempts
			case <-timer.C:
			}
		}
	}
	_ = model.FinishHubWeeklyDigestDelivery(delivery.Id, model.HubWeeklyDigestDeliveryStatusFailed, lastError)
	common.SysLog(fmt.Sprintf("weekly digest delivery %d failed after retries: %s", delivery.Id, lastError))
	return hubWeeklyDigestOutcomeFailed
}

func skipHubWeeklyDigestDelivery(deliveryID int, reason string) hubWeeklyDigestOutcome {
	if err := model.FinishHubWeeklyDigestDelivery(deliveryID, model.HubWeeklyDigestDeliveryStatusSkipped, reason); err != nil {
		common.SysLog(fmt.Sprintf("failed to skip weekly digest delivery %d: %v", deliveryID, err))
		return hubWeeklyDigestOutcomeFailed
	}
	return hubWeeklyDigestOutcomeSkipped
}

func settingEnabledByDefault(value *bool) bool {
	return value == nil || *value
}

func hubWeeklyDigestHasActivity(tenant *model.HubWeeklyDigestTenantSummary, provider *model.HubWeeklyDigestProviderSummary) bool {
	if tenant != nil && (tenant.SuccessCalls > 0 || tenant.ConsumptionQuota != 0 || tenant.NetIncomeQuota != 0) {
		return true
	}
	return provider != nil && (provider.SuccessCalls > 0 || provider.SettledIncomeQuota != 0 || provider.PendingIncomeQuota != 0)
}

func formatHubWeeklyDigestEmail(
	payload HubWeeklyDigestPayload,
	recipient model.HubWeeklyDigestRecipient,
	tenant *model.HubWeeklyDigestTenantSummary,
	provider *model.HubWeeklyDigestProviderSummary,
) (string, string) {
	weekStart := time.Unix(payload.WeekStart, 0).In(hubWeeklyDigestLocation)
	weekLastDay := time.Unix(payload.WeekEnd, 0).In(hubWeeklyDigestLocation).AddDate(0, 0, -1)
	period := fmt.Sprintf("%s 至 %s", weekStart.Format("2006-01-02"), weekLastDay.Format("2006-01-02"))
	subject := fmt.Sprintf("%s经营周报（%s）", common.SystemName, period)
	sections := make([]string, 0, 2)
	if tenant != nil {
		fallbackRate := "0.00%"
		if tenant.SuccessCalls > 0 {
			fallbackRate = fmt.Sprintf("%.2f%%", float64(tenant.FallbackCalls)*100/float64(tenant.SuccessCalls))
		}
		sections = append(sections, fmt.Sprintf(
			"<h2 style=\"font-size:18px;margin:24px 0 12px\">站点经营%s</h2>"+
				"<table style=\"border-collapse:collapse;width:100%%\"><tbody>"+
				"<tr><td style=\"padding:8px;border:1px solid #e5e7eb\">用户消费</td><td style=\"padding:8px;border:1px solid #e5e7eb\"><strong>%s</strong></td></tr>"+
				"<tr><td style=\"padding:8px;border:1px solid #e5e7eb\">总代净收入（已结算）</td><td style=\"padding:8px;border:1px solid #e5e7eb\"><strong>%s</strong></td></tr>"+
				"<tr><td style=\"padding:8px;border:1px solid #e5e7eb\">成功调用</td><td style=\"padding:8px;border:1px solid #e5e7eb\">%d 次</td></tr>"+
				"<tr><td style=\"padding:8px;border:1px solid #e5e7eb\">活跃用户 / 新注册</td><td style=\"padding:8px;border:1px solid #e5e7eb\">%d / %d</td></tr>"+
				"<tr><td style=\"padding:8px;border:1px solid #e5e7eb\">平台兜底</td><td style=\"padding:8px;border:1px solid #e5e7eb\">%d 次（%s）</td></tr>"+
				"</tbody></table>%s",
			optionalDigestName(recipient.TenantName),
			logger.FormatQuota(tenant.ConsumptionQuota),
			logger.FormatQuota(tenant.NetIncomeQuota),
			tenant.SuccessCalls,
			tenant.ActiveUsers,
			tenant.NewUsers,
			tenant.FallbackCalls,
			fallbackRate,
			formatHubWeeklyDigestTopModels(tenant.TopModels),
		))
	}
	if provider != nil {
		sections = append(sections, fmt.Sprintf(
			"<h2 style=\"font-size:18px;margin:24px 0 12px\">自有渠道%s</h2>"+
				"<table style=\"border-collapse:collapse;width:100%%\"><tbody>"+
				"<tr><td style=\"padding:8px;border:1px solid #e5e7eb\">已结算收入</td><td style=\"padding:8px;border:1px solid #e5e7eb\"><strong>%s</strong></td></tr>"+
				"<tr><td style=\"padding:8px;border:1px solid #e5e7eb\">待结算收入</td><td style=\"padding:8px;border:1px solid #e5e7eb\"><strong>%s</strong></td></tr>"+
				"<tr><td style=\"padding:8px;border:1px solid #e5e7eb\">成功调用</td><td style=\"padding:8px;border:1px solid #e5e7eb\">%d 次</td></tr>"+
				"<tr><td style=\"padding:8px;border:1px solid #e5e7eb\">异常或下线渠道</td><td style=\"padding:8px;border:1px solid #e5e7eb\">%d / %d</td></tr>"+
				"</tbody></table>%s",
			optionalDigestName(recipient.ProviderName),
			logger.FormatQuota(provider.SettledIncomeQuota),
			logger.FormatQuota(provider.PendingIncomeQuota),
			provider.SuccessCalls,
			provider.AbnormalChannels,
			provider.TotalChannels,
			formatHubWeeklyDigestTopModels(provider.TopModels),
		))
	}
	consoleURL := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/") + "/dashboard/overview"
	if recipient.TenantHost != "" {
		consoleURL = "https://" + recipient.TenantHost + "/dashboard/overview"
	}
	content := fmt.Sprintf(
		"<div style=\"font-family:Arial,sans-serif;color:#111827;line-height:1.6;max-width:680px;margin:0 auto\">"+
			"<h1 style=\"font-size:22px;margin:0 0 8px\">经营周报</h1>"+
			"<p style=\"color:#6b7280;margin:0\">统计周期：%s（北京时间）</p>%s"+
			"<p style=\"margin:28px 0 0\"><a href=\"%s\" style=\"display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px\">进入控制台</a></p>"+
			"<p style=\"color:#9ca3af;font-size:12px;margin-top:24px\">本邮件为经营摘要，实时渠道异常仍以控制台告警为准。</p></div>",
		html.EscapeString(period),
		strings.Join(sections, ""),
		html.EscapeString(consoleURL),
	)
	return subject, content
}

func optionalDigestName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	return " · " + html.EscapeString(name)
}

func formatHubWeeklyDigestTopModels(models []model.HubWeeklyDigestTopModel) string {
	if len(models) == 0 {
		return ""
	}
	rows := make([]string, 0, len(models))
	for _, item := range models {
		rows = append(rows, fmt.Sprintf(
			"<li style=\"margin:4px 0\"><strong>%s</strong>：%d 次，%s</li>",
			html.EscapeString(item.ModelName),
			item.CallCount,
			logger.FormatQuota(item.Quota),
		))
	}
	return "<h3 style=\"font-size:15px;margin:16px 0 6px\">Top 3 模型</h3><ol style=\"margin:0;padding-left:20px\">" + strings.Join(rows, "") + "</ol>"
}
