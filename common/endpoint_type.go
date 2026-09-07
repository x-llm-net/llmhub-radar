package common

import "github.com/QuantumNous/new-api/constant"

// GetEndpointTypesByChannelType provides default endpoint hints for a channel.
// This is not an exhaustive list of its adapters' protocol conversions.
func GetEndpointTypesByChannelType(channelType int, modelName string) []constant.EndpointType {
	_ = modelName
	var endpointTypes []constant.EndpointType
	switch channelType {
	case constant.ChannelTypeJina:
		endpointTypes = []constant.EndpointType{constant.EndpointTypeJinaRerank}
	//case constant.ChannelTypeMidjourney, constant.ChannelTypeMidjourneyPlus:
	//	endpointTypes = []constant.EndpointType{constant.EndpointTypeMidjourney}
	//case constant.ChannelTypeSunoAPI:
	//	endpointTypes = []constant.EndpointType{constant.EndpointTypeSuno}
	//case constant.ChannelTypeKling:
	//	endpointTypes = []constant.EndpointType{constant.EndpointTypeKling}
	//case constant.ChannelTypeJimeng:
	//	endpointTypes = []constant.EndpointType{constant.EndpointTypeJimeng}
	case constant.ChannelTypeAws:
		fallthrough
	case constant.ChannelTypeAnthropic:
		endpointTypes = []constant.EndpointType{constant.EndpointTypeAnthropic, constant.EndpointTypeOpenAI}
	case constant.ChannelTypeVertexAi:
		fallthrough
	case constant.ChannelTypeGemini:
		endpointTypes = []constant.EndpointType{constant.EndpointTypeGemini, constant.EndpointTypeOpenAI}
	case constant.ChannelTypeOpenRouter: // OpenRouter 只支持 OpenAI 端点
		endpointTypes = []constant.EndpointType{constant.EndpointTypeOpenAI}
	case constant.ChannelTypeXai:
		endpointTypes = []constant.EndpointType{constant.EndpointTypeOpenAI, constant.EndpointTypeOpenAIResponse}
	case constant.ChannelTypeSora:
		endpointTypes = []constant.EndpointType{constant.EndpointTypeOpenAIVideo}
	case constant.ChannelTypeSub2API, constant.ChannelTypeNewAPI:
		endpointTypes = []constant.EndpointType{
			constant.EndpointTypeOpenAI,
			constant.EndpointTypeOpenAIResponse,
			constant.EndpointTypeOpenAIResponseCompact,
			constant.EndpointTypeAnthropic,
			constant.EndpointTypeGemini,
			constant.EndpointTypeOpenAIAlphaSearch,
		}
	case constant.ChannelTypeCodex:
		endpointTypes = []constant.EndpointType{
			constant.EndpointTypeOpenAIResponse,
			constant.EndpointTypeOpenAIResponseCompact,
			constant.EndpointTypeOpenAIAlphaSearch,
		}
	default:
		// Protocol selection is based on the channel adapter and the request
		// endpoint. A model name must never silently switch a channel from
		// Chat Completions to Responses.
		endpointTypes = []constant.EndpointType{constant.EndpointTypeOpenAI}
	}
	return endpointTypes
}

// IsEndpointTypeCompatible reports whether an explicitly declared model
// endpoint can be attempted through the selected channel adapter. The model
// name is intentionally absent: endpoint compatibility belongs to the
// channel/protocol boundary, while model matching is handled by Ability.
//
// Used for initial probe hints only, never as a request routing allowlist.
func IsEndpointTypeCompatible(channelType int, endpointType constant.EndpointType) bool {
	for _, supported := range GetEndpointTypesByChannelType(channelType, "") {
		if supported == endpointType {
			return true
		}
	}

	switch endpointType {
	case constant.EndpointTypeOpenAIResponse:
		switch channelType {
		case constant.ChannelTypeOpenAI,
			constant.ChannelTypeAzure,
			constant.ChannelTypeOpenAIMax,
			constant.ChannelTypeGemini,
			constant.ChannelTypeOpenRouter,
			constant.ChannelTypeXai,
			constant.ChannelTypeNewAPI,
			constant.ChannelTypeSub2API,
			constant.ChannelTypeCodex:
			return true
		}
	case constant.EndpointTypeOpenAIResponseCompact:
		switch channelType {
		case constant.ChannelTypeOpenAI,
			constant.ChannelTypeAzure,
			constant.ChannelTypeOpenAIMax,
			constant.ChannelTypeOpenRouter,
			constant.ChannelTypeXai,
			constant.ChannelTypeNewAPI,
			constant.ChannelTypeSub2API,
			constant.ChannelTypeCodex:
			return true
		}
	case constant.EndpointTypeImageGeneration:
		switch channelType {
		case constant.ChannelTypeOpenAI,
			constant.ChannelTypeAzure,
			constant.ChannelTypeOpenAIMax,
			constant.ChannelTypeOpenRouter,
			constant.ChannelTypeGemini,
			constant.ChannelTypeVertexAi,
			constant.ChannelTypeXai,
			constant.ChannelTypeSiliconFlow,
			constant.ChannelTypeVolcEngine,
			constant.ChannelTypeBaiduV2,
			constant.ChannelTypeNewAPI,
			constant.ChannelTypeSub2API:
			return true
		}
	case constant.EndpointTypeGemini, constant.EndpointTypeAnthropic,
		constant.EndpointTypeEmbeddings, constant.EndpointTypeJinaRerank:
		switch channelType {
		case constant.ChannelTypeOpenAI, constant.ChannelTypeAzure, constant.ChannelTypeOpenAIMax:
			return true
		}
	}
	return false
}
