/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package model

import (
	"sort"
	"strconv"
	"strings"
)

// Keep this order stable: it is the public model directory order, not a
// reliability ranking. Reliability is displayed on each model instead.
var hubPublicModelFamilyOrder = []string{
	"anthropic",
	"openai",
	"google",
	"xai",
	"deepseek",
	"alibaba",
	"bytedance",
	"zhipu",
	"other",
}

func ClassifyHubPublicModelFamily(modelName string) string {
	name := strings.ToLower(strings.TrimSpace(modelName))
	switch {
	case strings.Contains(name, "claude"):
		return "anthropic"
	case strings.Contains(name, "gemini"), strings.Contains(name, "banana"), strings.Contains(name, "imagen"), strings.HasPrefix(name, "veo"), name == "text-embedding-004":
		return "google"
	case strings.Contains(name, "grok"):
		return "xai"
	case strings.Contains(name, "deepseek"):
		return "deepseek"
	case strings.Contains(name, "qwen"), strings.HasPrefix(name, "wan"), strings.Contains(name, "tongyi"):
		return "alibaba"
	case strings.Contains(name, "doubao"), strings.Contains(name, "seedream"), strings.Contains(name, "seedance"):
		return "bytedance"
	case strings.HasPrefix(name, "glm"), strings.Contains(name, "cogview"), strings.Contains(name, "cogvideo"):
		return "zhipu"
	case strings.HasPrefix(name, "gpt-"), strings.HasPrefix(name, "chatgpt"), strings.HasPrefix(name, "o1"), strings.HasPrefix(name, "o3"), strings.HasPrefix(name, "o4"), strings.Contains(name, "codex"), strings.Contains(name, "dall-e"), strings.HasPrefix(name, "sora"),
		strings.HasPrefix(name, "text-embedding-3-"), name == "text-embedding-ada-002",
		strings.HasPrefix(name, "text-moderation-"), strings.HasPrefix(name, "omni-moderation-"),
		strings.HasPrefix(name, "whisper-"), strings.HasPrefix(name, "tts-"),
		strings.HasPrefix(name, "text-ada-"), strings.HasPrefix(name, "text-babbage-"),
		strings.HasPrefix(name, "text-curie-"), strings.HasPrefix(name, "text-davinci-"),
		strings.HasPrefix(name, "code-davinci-"), strings.HasPrefix(name, "davinci-"),
		strings.HasPrefix(name, "babbage-"):
		return "openai"
	default:
		return "other"
	}
}

func classifyHubPublicModelFamily(modelName string) string {
	return ClassifyHubPublicModelFamily(modelName)
}

func hubPublicModelFamilyRank(familyKey string) int {
	for index, key := range hubPublicModelFamilyOrder {
		if key == familyKey {
			return index
		}
	}
	return len(hubPublicModelFamilyOrder)
}

func hubPublicModelVariantRank(familyKey, modelName string) int {
	name := strings.ToLower(strings.TrimSpace(modelName))
	switch familyKey {
	case "anthropic":
		switch {
		case strings.Contains(name, "opus"):
			return 0
		case strings.Contains(name, "sonnet"):
			return 1
		case strings.Contains(name, "haiku"):
			return 2
		}
	case "openai":
		if strings.Contains(name, "image") || strings.Contains(name, "dall-e") || strings.HasPrefix(name, "sora") {
			return 2
		}
		if strings.HasPrefix(name, "o1") || strings.HasPrefix(name, "o3") || strings.HasPrefix(name, "o4") || strings.Contains(name, "reasoning") {
			return 1
		}
	case "google":
		if strings.Contains(name, "image") || strings.Contains(name, "imagen") || strings.Contains(name, "banana") || strings.HasPrefix(name, "veo") {
			return 2
		}
		if strings.Contains(name, "flash") {
			return 1
		}
		if strings.Contains(name, "pro") {
			return 0
		}
	}
	return 0
}

func hubPublicModelNameLess(familyKey, left, right string) bool {
	leftRank := hubPublicModelVariantRank(familyKey, left)
	rightRank := hubPublicModelVariantRank(familyKey, right)
	if leftRank != rightRank {
		return leftRank < rightRank
	}
	return naturalModelNameLess(left, right)
}

func sortHubPublicModels(models []HubProviderPublicModel) {
	sort.SliceStable(models, func(i, j int) bool {
		left := models[i]
		right := models[j]
		leftFamily := left.FamilyKey
		rightFamily := right.FamilyKey
		if leftFamily == "" {
			leftFamily = classifyHubPublicModelFamily(left.ModelName)
		}
		if rightFamily == "" {
			rightFamily = classifyHubPublicModelFamily(right.ModelName)
		}
		leftRank := hubPublicModelFamilyRank(leftFamily)
		rightRank := hubPublicModelFamilyRank(rightFamily)
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		return hubPublicModelNameLess(leftFamily, left.ModelName, right.ModelName)
	})
}

func naturalModelNameLess(left, right string) bool {
	left = strings.ToLower(left)
	right = strings.ToLower(right)
	for left != "" && right != "" {
		leftDigit := left[0] >= '0' && left[0] <= '9'
		rightDigit := right[0] >= '0' && right[0] <= '9'
		leftChunk, leftRest := modelNameChunk(left, leftDigit)
		rightChunk, rightRest := modelNameChunk(right, rightDigit)
		if leftDigit && rightDigit {
			leftNumber, _ := strconv.Atoi(leftChunk)
			rightNumber, _ := strconv.Atoi(rightChunk)
			if leftNumber != rightNumber {
				return leftNumber > rightNumber
			}
		} else if leftChunk != rightChunk {
			return leftChunk < rightChunk
		}
		left = leftRest
		right = rightRest
	}
	return len(left) < len(right)
}

func modelNameChunk(value string, digit bool) (string, string) {
	end := 0
	for end < len(value) {
		currentDigit := value[end] >= '0' && value[end] <= '9'
		if currentDigit != digit {
			break
		}
		end++
	}
	return value[:end], value[end:]
}
