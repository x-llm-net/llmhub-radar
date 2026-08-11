package middleware

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func abortWithOpenAiMessage(c *gin.Context, statusCode int, message string, code ...types.ErrorCode) {
	codeStr := ""
	if len(code) > 0 {
		codeStr = string(code[0])
	}
	userId := c.GetInt("id")
	c.JSON(statusCode, gin.H{
		"error": gin.H{
			"message": common.MessageWithRequestId(message, c.GetString(common.RequestIdKey)),
			"type":    "new_api_error",
			"code":    codeStr,
		},
	})
	if len(code) > 0 && code[0] == types.ErrorCodeServiceTierUnavailable {
		recordHubServiceTierErrorLog(c, statusCode, message)
	}
	c.Abort()
	logger.LogError(c.Request.Context(), fmt.Sprintf("user %d | %s", userId, message))
}

func recordHubServiceTierErrorLog(c *gin.Context, statusCode int, message string) {
	if c == nil || !service.IsHubServiceTierRequest(c) {
		return
	}
	other := map[string]interface{}{
		"error_type":  "new_api_error",
		"error_code":  string(types.ErrorCodeServiceTierUnavailable),
		"status_code": statusCode,
	}
	if c.Request != nil && c.Request.URL != nil {
		other["request_path"] = c.Request.URL.Path
	}
	other["admin_info"] = map[string]interface{}{
		"use_channel": c.GetStringSlice("use_channel"),
	}
	service.AttachHubRelayLogInfo(c, nil, other, false)
	startTime := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime)
	if startTime.IsZero() {
		startTime = time.Now()
	}
	model.RecordErrorLog(
		c,
		c.GetInt("id"),
		c.GetInt("channel_id"),
		c.GetString("original_model"),
		c.GetString("token_name"),
		message,
		c.GetInt("token_id"),
		int(time.Since(startTime).Seconds()),
		common.GetContextKeyBool(c, constant.ContextKeyIsStream),
		c.GetString("group"),
		other,
	)
}

func abortWithMidjourneyMessage(c *gin.Context, statusCode int, code int, description string) {
	c.JSON(statusCode, gin.H{
		"description": description,
		"type":        "new_api_error",
		"code":        code,
	})
	c.Abort()
	logger.LogError(c.Request.Context(), description)
}
