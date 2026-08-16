package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListHubAdminNotificationsReturnsNewestFirst(t *testing.T) {
	truncateTables(t)
	first := &HubAdminNotification{
		Type:      "hub_provider_application",
		Title:     "First",
		Content:   "first",
		CreatedAt: 100,
	}
	second := &HubAdminNotification{
		Type:      "hub_provider_review",
		Title:     "Second",
		Content:   "second",
		CreatedAt: 200,
	}
	require.NoError(t, CreateHubAdminNotification(first))
	require.NoError(t, CreateHubAdminNotification(second))

	notifications, err := ListHubAdminNotifications(10)
	require.NoError(t, err)
	require.Len(t, notifications, 2)
	assert.Equal(t, "Second", notifications[0].Title)
	assert.Equal(t, "First", notifications[1].Title)
}
