/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
package controller

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const hubProviderPayoutQRCodeMaxBytes = 2 * 1024 * 1024

var hubProviderPayoutQRCodeContentTypes = map[string]struct{}{
	"image/png":  {},
	"image/jpeg": {},
	"image/webp": {},
}

type hubProviderPayoutAccountRequest struct {
	Method        string                                `json:"method"`
	Details       model.HubProviderPayoutAccountDetails `json:"details"`
	QRCodeAssetId int                                   `json:"qr_code_asset_id"`
	IsDefault     bool                                  `json:"is_default"`
}

func (request hubProviderPayoutAccountRequest) input() model.HubProviderPayoutAccountInput {
	return model.HubProviderPayoutAccountInput{
		Method:        request.Method,
		Details:       request.Details,
		QRCodeAssetId: request.QRCodeAssetId,
		IsDefault:     request.IsDefault,
	}
}

func payoutAccountError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrHubProviderPayoutAccountInvalid),
		errors.Is(err, model.ErrHubProviderPayoutAssetInvalid):
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutAccountInvalid)
	case errors.Is(err, model.ErrHubProviderPayoutAccountNotFound),
		errors.Is(err, gorm.ErrRecordNotFound):
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutAccountNotFound)
	default:
		common.ApiError(c, err)
	}
}

func GetHubProviderPayoutAccounts(c *gin.Context) {
	provider, ok := currentHubProviderOrError(c)
	if !ok {
		return
	}
	items, err := model.ListHubProviderPayoutAccounts(provider.Id, c.GetInt("id"))
	if err != nil {
		payoutAccountError(c, err)
		return
	}
	common.ApiSuccess(c, items)
}

func CreateHubProviderPayoutAccount(c *gin.Context) {
	provider, ok := currentHubProviderOrError(c)
	if !ok {
		return
	}
	var request hubProviderPayoutAccountRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	account, err := model.CreateHubProviderPayoutAccount(provider.Id, c.GetInt("id"), request.input())
	if err != nil {
		payoutAccountError(c, err)
		return
	}
	common.ApiSuccess(c, account)
}

func UpdateHubProviderPayoutAccount(c *gin.Context) {
	provider, ok := currentHubProviderOrError(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("account_id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	var request hubProviderPayoutAccountRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	account, err := model.UpdateHubProviderPayoutAccount(provider.Id, c.GetInt("id"), id, request.input())
	if err != nil {
		payoutAccountError(c, err)
		return
	}
	common.ApiSuccess(c, account)
}

func DeleteHubProviderPayoutAccount(c *gin.Context) {
	provider, ok := currentHubProviderOrError(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("account_id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.DeleteHubProviderPayoutAccount(provider.Id, c.GetInt("id"), id); err != nil {
		payoutAccountError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func UploadHubProviderPayoutQRCode(c *gin.Context) {
	provider, ok := currentHubProviderOrError(c)
	if !ok {
		return
	}
	if c.Request.ContentLength > hubProviderPayoutQRCodeMaxBytes+256*1024 {
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutQRCodeInvalid)
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutQRCodeInvalid)
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutQRCodeInvalid)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, hubProviderPayoutQRCodeMaxBytes+1))
	if err != nil || len(data) == 0 || len(data) > hubProviderPayoutQRCodeMaxBytes {
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutQRCodeInvalid)
		return
	}
	contentType := strings.ToLower(http.DetectContentType(data))
	if _, ok := hubProviderPayoutQRCodeContentTypes[contentType]; !ok {
		common.ApiErrorI18n(c, i18n.MsgHubProviderPayoutQRCodeInvalid)
		return
	}
	asset, err := model.CreateHubProviderPayoutAsset(provider.Id, c.GetInt("id"), contentType, data)
	if err != nil {
		payoutAccountError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": asset.Id, "content_type": asset.ContentType})
}

func GetHubProviderPayoutAsset(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("asset_id"))
	if err != nil || id <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	asset, err := model.GetHubProviderPayoutAsset(id)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	if !canReadHubProviderPrivateAsset(c, asset.ProviderId) {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, asset.ContentType, asset.Data)
}
