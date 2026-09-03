package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// WebhookPayload webhook 通知的负载数据
type WebhookPayload struct {
	Type      string        `json:"type"`
	Title     string        `json:"title"`
	Content   string        `json:"content"`
	Values    []interface{} `json:"values,omitempty"`
	Timestamp int64         `json:"timestamp"`
}

type weComWebhookPayload struct {
	MsgType  string `json:"msgtype"`
	Markdown struct {
		Content string `json:"content"`
	} `json:"markdown"`
}

type weComWebhookResponse struct {
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
}

func SendWeComWebhook(webhookURL string, content string) error {
	payload := weComWebhookPayload{MsgType: "markdown"}
	payload.Markdown.Content = content
	payloadBytes, err := common.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal enterprise WeChat payload: %v", err)
	}

	var resp *http.Response
	if system_setting.EnableWorker() {
		resp, err = DoWorkerRequest(&WorkerRequest{
			URL:    webhookURL,
			Key:    system_setting.WorkerValidKey,
			Method: http.MethodPost,
			Headers: map[string]string{
				"Content-Type": "application/json",
			},
			Body: payloadBytes,
		})
	} else {
		if err := ValidateSSRFProtectedFetchURL(webhookURL); err != nil {
			return fmt.Errorf("request reject: %v", err)
		}
		request, requestErr := http.NewRequest(http.MethodPost, webhookURL, bytes.NewBuffer(payloadBytes))
		if requestErr != nil {
			return fmt.Errorf("failed to create enterprise WeChat request: %v", requestErr)
		}
		request.Header.Set("Content-Type", "application/json")
		resp, err = GetSSRFProtectedHTTPClient().Do(request)
	}
	if err != nil {
		return fmt.Errorf("failed to send enterprise WeChat webhook: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("enterprise WeChat webhook failed with status code: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("failed to read enterprise WeChat response: %v", err)
	}
	var result weComWebhookResponse
	if len(bytes.TrimSpace(body)) > 0 {
		if err := common.Unmarshal(body, &result); err != nil {
			return fmt.Errorf("invalid enterprise WeChat response: %v", err)
		}
		if result.ErrCode != 0 {
			return fmt.Errorf("enterprise WeChat webhook rejected message (%d): %s", result.ErrCode, result.ErrMsg)
		}
	}
	return nil
}

// generateSignature 生成 webhook 签名
func generateSignature(secret string, payload []byte) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write(payload)
	return hex.EncodeToString(h.Sum(nil))
}

// SendWebhookNotify 发送通用 webhook 通知，保留用于兼容旧配置和调用方。
func SendWebhookNotify(webhookURL string, secret string, data dto.Notify) error {
	return SendWebhookNotifyWithProvider(webhookURL, secret, dto.WebhookProviderGeneric, data)
}

// SendWebhookNotifyWithProvider sends a notification using a standard payload
// for the selected bot provider. An empty provider is treated as generic for
// backwards compatibility with existing user settings.
func SendWebhookNotifyWithProvider(webhookURL string, secret string, provider string, data dto.Notify) error {
	// 处理占位符
	content := data.Content
	for _, value := range data.Values {
		content = strings.Replace(content, dto.ContentValueParam, fmt.Sprintf("%v", value), 1)
	}

	if provider == "" {
		provider = dto.WebhookProviderGeneric
	}

	timestamp := time.Now().Unix()
	var payload any
	headers := map[string]string{"Content-Type": "application/json"}
	signedURL := webhookURL
	switch provider {
	case dto.WebhookProviderWeCom:
		payload = map[string]any{
			"msgtype":  "markdown",
			"markdown": map[string]string{"content": fmt.Sprintf("**%s**\n%s", data.Title, content)},
		}
	case dto.WebhookProviderDingTalk:
		payload = map[string]any{
			"msgtype":  "markdown",
			"markdown": map[string]string{"title": data.Title, "text": fmt.Sprintf("### %s\n%s", data.Title, content)},
		}
		signedURL = signDingTalkURL(webhookURL, secret, timestamp)
	case dto.WebhookProviderFeishu:
		payload = map[string]any{
			"msg_type": "text",
			"content":  map[string]string{"text": fmt.Sprintf("%s\n%s", data.Title, content)},
		}
		signedURL = signFeishuURL(webhookURL, secret, timestamp)
	case dto.WebhookProviderGeneric:
		payload = WebhookPayload{Type: data.Type, Title: data.Title, Content: content, Values: data.Values, Timestamp: timestamp}
	default:
		return fmt.Errorf("unsupported webhook provider: %s", provider)
	}

	payloadBytes, err := common.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal webhook payload: %v", err)
	}
	if provider == dto.WebhookProviderGeneric && secret != "" {
		headers["X-Webhook-Signature"] = generateSignature(secret, payloadBytes)
	}
	workerAuthorization := ""
	if provider == dto.WebhookProviderGeneric {
		workerAuthorization = secret
	}
	return postWebhook(signedURL, payloadBytes, headers, workerAuthorization)
}

func signDingTalkURL(webhookURL string, secret string, timestamp int64) string {
	if secret == "" {
		return webhookURL
	}
	return signBotURL(webhookURL, secret, timestamp, false)
}

func signFeishuURL(webhookURL string, secret string, timestamp int64) string {
	if secret == "" {
		return webhookURL
	}
	return signBotURL(webhookURL, secret, timestamp, true)
}

func signBotURL(webhookURL string, secret string, timestamp int64, secretAsKey bool) string {
	parsed, err := url.Parse(webhookURL)
	if err != nil {
		return webhookURL
	}
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, secret)
	key := []byte(secret)
	message := []byte(stringToSign)
	if secretAsKey {
		key = []byte(stringToSign)
		message = nil
	}
	h := hmac.New(sha256.New, key)
	_, _ = h.Write(message)
	query := parsed.Query()
	query.Set("timestamp", fmt.Sprintf("%d", timestamp))
	query.Set("sign", base64.StdEncoding.EncodeToString(h.Sum(nil)))
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func postWebhook(webhookURL string, payload []byte, headers map[string]string, workerAuthorization string) error {
	if system_setting.EnableWorker() {
		workerHeaders := make(map[string]string, len(headers)+1)
		for key, value := range headers {
			workerHeaders[key] = value
		}
		if workerAuthorization != "" {
			workerHeaders["Authorization"] = "Bearer " + workerAuthorization
		}
		workerReq := &WorkerRequest{URL: webhookURL, Key: system_setting.WorkerValidKey, Method: http.MethodPost, Headers: workerHeaders, Body: payload}
		resp, err := DoWorkerRequest(workerReq)
		if err != nil {
			return fmt.Errorf("failed to send webhook request through worker: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("webhook request failed with status code: %d", resp.StatusCode)
		}
		return nil
	}
	if err := ValidateSSRFProtectedFetchURL(webhookURL); err != nil {
		return fmt.Errorf("request reject: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, webhookURL, bytes.NewBuffer(payload))
	if err != nil {
		return fmt.Errorf("failed to create webhook request: %v", err)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := GetSSRFProtectedHTTPClient().Do(req)
	if err != nil {
		return fmt.Errorf("failed to send webhook request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook request failed with status code: %d", resp.StatusCode)
	}
	return nil
}
