package service

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/require"
)

func TestSendWebhookNotifyWithProviderFormatsSupportedBots(t *testing.T) {
	fetchSetting := system_setting.GetFetchSetting()
	originalFetchSetting := *fetchSetting
	originalHTTPClient := httpClient
	t.Cleanup(func() {
		*fetchSetting = originalFetchSetting
		httpClient = originalHTTPClient
	})
	fetchSetting.EnableSSRFProtection = false
	InitHttpClient()

	tests := []struct {
		name     string
		provider string
		secret   string
		check    func(t *testing.T, requestURL *url.URL, payload map[string]any)
	}{
		{
			name:     "generic",
			provider: dto.WebhookProviderGeneric,
			secret:   "generic-secret",
			check: func(t *testing.T, requestURL *url.URL, payload map[string]any) {
				require.Empty(t, requestURL.Query().Get("sign"))
				require.Equal(t, "quota_exceed", payload["type"])
				require.Equal(t, "余额告警：用户", payload["content"])
			},
		},
		{
			name:     "enterprise-wechat",
			provider: dto.WebhookProviderWeCom,
			check: func(t *testing.T, requestURL *url.URL, payload map[string]any) {
				require.Empty(t, requestURL.Query())
				require.Equal(t, "markdown", payload["msgtype"])
			},
		},
		{
			name:     "dingtalk",
			provider: dto.WebhookProviderDingTalk,
			secret:   "dingtalk-secret",
			check: func(t *testing.T, requestURL *url.URL, payload map[string]any) {
				require.NotEmpty(t, requestURL.Query().Get("timestamp"))
				require.NotEmpty(t, requestURL.Query().Get("sign"))
				require.Equal(t, "markdown", payload["msgtype"])
			},
		},
		{
			name:     "feishu",
			provider: dto.WebhookProviderFeishu,
			secret:   "feishu-secret",
			check: func(t *testing.T, requestURL *url.URL, payload map[string]any) {
				require.NotEmpty(t, requestURL.Query().Get("timestamp"))
				require.NotEmpty(t, requestURL.Query().Get("sign"))
				require.Equal(t, "text", payload["msg_type"])
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			requestReceived := make(chan struct{})
			var requestURL *url.URL
			var payloadBytes []byte
			var handlerErr error
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requestURLCopy := *r.URL
				requestURL = &requestURLCopy
				payloadBytes, handlerErr = io.ReadAll(r.Body)
				w.WriteHeader(http.StatusOK)
				close(requestReceived)
			}))
			defer server.Close()

			err := SendWebhookNotifyWithProvider(
				server.URL,
				test.secret,
				test.provider,
				dto.NewNotify(dto.NotifyTypeQuotaExceed, "额度告警", "余额告警：{{value}}", []interface{}{"用户"}),
			)
			require.NoError(t, err)
			<-requestReceived
			require.NoError(t, handlerErr)
			var payload map[string]any
			require.NoError(t, json.Unmarshal(payloadBytes, &payload))
			test.check(t, requestURL, payload)
		})
	}
}
