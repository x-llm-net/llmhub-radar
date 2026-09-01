package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
)

func TestPaymentReturnPathUsesDefaultDashboardRoutes(t *testing.T) {
	previousAddress := system_setting.ServerAddress
	previousCallbackAddress := operation_setting.CustomCallbackAddress
	system_setting.ServerAddress = "https://dashboard.example.com/"
	operation_setting.CustomCallbackAddress = ""
	t.Cleanup(func() {
		system_setting.ServerAddress = previousAddress
		operation_setting.CustomCallbackAddress = previousCallbackAddress
	})

	assert.Equal(
		t,
		"https://dashboard.example.com/wallet?pay=success",
		paymentReturnPath("/wallet?pay=success"),
	)
	assert.Equal(
		t,
		"https://dashboard.example.com/usage-logs",
		paymentReturnPath("/usage-logs"),
	)
}

func TestPaymentReturnPathUsesCustomCallbackAddress(t *testing.T) {
	previousAddress := system_setting.ServerAddress
	previousCallbackAddress := operation_setting.CustomCallbackAddress
	system_setting.ServerAddress = "http://localhost:3000"
	operation_setting.CustomCallbackAddress = "https://llm-hub.store/"
	t.Cleanup(func() {
		system_setting.ServerAddress = previousAddress
		operation_setting.CustomCallbackAddress = previousCallbackAddress
	})

	assert.Equal(
		t,
		"https://llm-hub.store/usage-logs",
		paymentReturnPath("/usage-logs"),
	)
}
