package hub_provider_notification_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeNotificationConfigDeduplicatesRecipientsAndAssignsWebhookID(t *testing.T) {
	config, err := Normalize(Config{
		Enabled:         true,
		EmailRecipients: []string{"Admin@example.com", " admin@example.com "},
		Webhooks:        []WebhookTarget{{Name: "Ops", URL: "https://example.com/hook", Enabled: true}},
	})

	require.NoError(t, err)
	assert.Equal(t, []string{"Admin@example.com"}, config.EmailRecipients)
	require.Len(t, config.Webhooks, 1)
	assert.NotEmpty(t, config.Webhooks[0].ID)
}

func TestNormalizeNotificationConfigRejectsInvalidDestinations(t *testing.T) {
	_, err := Normalize(Config{EmailRecipients: []string{"not-an-email"}})
	assert.Error(t, err)

	_, err = Normalize(Config{Webhooks: []WebhookTarget{{URL: "file:///tmp/hook"}}})
	assert.Error(t, err)
}
