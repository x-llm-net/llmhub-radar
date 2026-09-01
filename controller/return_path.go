package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/service"
)

func paymentReturnPath(suffix string) string {
	base := strings.TrimRight(service.GetCallbackAddress(), "/")
	return base + suffix
}
