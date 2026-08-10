package common

import (
	"strings"

	"github.com/tidwall/gjson"
)

// ObserveMeaningfulStreamData records TTFT only for content-bearing events.
// Protocol lifecycle, usage, stop, and image metadata events are deliberately
// excluded so non-text endpoints do not receive a fabricated TTFT.
func (info *RelayInfo) ObserveMeaningfulStreamData(data string) bool {
	if info == nil || !info.IsStream || !isMeaningfulStreamData(data) {
		return false
	}
	info.SetFirstTokenTime()
	return true
}

func isMeaningfulStreamData(data string) bool {
	payload := gjson.Parse(strings.TrimSpace(data))
	if !payload.Exists() || !payload.IsObject() {
		return false
	}

	for _, choice := range payload.Get("choices").Array() {
		for _, path := range []string{
			"delta.content",
			"delta.reasoning_content",
			"delta.reasoning",
			"text",
		} {
			if hasMeaningfulValue(choice.Get(path)) {
				return true
			}
		}
	}

	for _, candidate := range payload.Get("candidates").Array() {
		for _, part := range candidate.Get("content.parts").Array() {
			if hasMeaningfulValue(part.Get("text")) {
				return true
			}
		}
	}

	eventType := payload.Get("type").String()
	switch eventType {
	case "content_block_delta":
		return hasMeaningfulValue(payload.Get("delta.text")) ||
			hasMeaningfulValue(payload.Get("delta.thinking"))
	case "response.output_text.delta", "response.reasoning_summary_text.delta", "response.reasoning_text.delta":
		return hasMeaningfulValue(payload.Get("delta"))
	}

	if hasMeaningfulValue(payload.Get("completion")) ||
		hasMeaningfulValue(payload.Get("answer")) ||
		hasMeaningfulValue(payload.Get("token.text")) {
		return true
	}
	return false
}

func hasMeaningfulValue(value gjson.Result) bool {
	if !value.Exists() {
		return false
	}
	if value.IsArray() {
		for _, item := range value.Array() {
			if hasMeaningfulValue(item) {
				return true
			}
		}
		return false
	}
	return strings.TrimSpace(value.String()) != ""
}
