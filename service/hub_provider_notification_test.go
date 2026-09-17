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
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestShouldNotifyHubProviderApplicantOnlyForCompletedReview(t *testing.T) {
	tests := []struct {
		name           string
		previousStatus string
		status         string
		want           bool
	}{
		{name: "approved", previousStatus: model.HubProviderStatusPending, status: model.HubProviderStatusActive, want: true},
		{name: "rejected", previousStatus: model.HubProviderStatusPending, status: model.HubProviderStatusRejected, want: true},
		{name: "still pending", previousStatus: model.HubProviderStatusPending, status: model.HubProviderStatusPending},
		{name: "disabled after approval", previousStatus: model.HubProviderStatusActive, status: model.HubProviderStatusDisabled},
		{name: "re-enabled", previousStatus: model.HubProviderStatusDisabled, status: model.HubProviderStatusActive},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, shouldNotifyHubProviderApplicant(tt.previousStatus, tt.status))
		})
	}
}

func TestFormatHubProviderApplicantReviewEmailEscapesUserContent(t *testing.T) {
	provider := &model.HubProvider{Name: `<script>alert("provider")</script>`}
	subject, content := formatHubProviderApplicantReviewEmail(
		provider,
		model.HubProviderStatusRejected,
		`<img src=x onerror="alert('remark')">`,
	)

	assert.Equal(t, "渠道商申请已拒绝", subject)
	assert.Contains(t, content, "审核结果：</strong>已拒绝")
	assert.Contains(t, content, "审核备注：")
	assert.NotContains(t, content, "<script>")
	assert.NotContains(t, content, "<img")
	assert.True(t, strings.Contains(content, "&lt;script&gt;") && strings.Contains(content, "&lt;img"))
}

func TestDeliverHubProviderApplicantReviewUsesOwnerAccountEmail(t *testing.T) {
	previousDB := model.DB
	previousSender := sendHubProviderApplicantEmail
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sendHubProviderApplicantEmail = previousSender
	})

	user := &model.User{Username: "provider-owner", Email: "owner@example.com"}
	require.NoError(t, db.Create(user).Error)

	var gotSubject, gotRecipient, gotContent string
	sendHubProviderApplicantEmail = func(subject string, recipient string, content string) error {
		gotSubject = subject
		gotRecipient = recipient
		gotContent = content
		return nil
	}

	err = deliverHubProviderApplicantReview(
		&model.HubProvider{OwnerUserId: user.Id, Name: "Example Provider"},
		model.HubProviderStatusActive,
		"Verified",
	)
	require.NoError(t, err)
	assert.Equal(t, "渠道商申请已通过", gotSubject)
	assert.Equal(t, "owner@example.com", gotRecipient)
	assert.Contains(t, gotContent, "Example Provider")
	assert.Contains(t, gotContent, "Verified")
}
