package model

import (
	"strings"

	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// HasModelBillingConfig reports whether a model has a platform billing
// definition that can be used by routing and model discovery.
//
// Tiered expressions are validated when the billing setting is saved. The
// routing path only needs to recognize the configured billing mode; it must
// not duplicate or evaluate the expression language.
func HasModelBillingConfig(modelName string) bool {
	if _, ok := ratio_setting.GetModelPrice(modelName, false); ok {
		return true
	}
	if _, ok, _ := ratio_setting.GetModelRatio(modelName); ok {
		return true
	}
	if billing_setting.GetBillingMode(modelName) != billing_setting.BillingModeTieredExpr {
		return false
	}
	expr, ok := billing_setting.GetBillingExpr(modelName)
	return ok && strings.TrimSpace(expr) != ""
}
