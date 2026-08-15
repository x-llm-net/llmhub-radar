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
)

const hubProviderWebsiteEvidenceMaxBytes = 5 * 1024 * 1024

var hubProviderWebsiteEvidenceContentTypes = map[string]struct{}{
	"image/png":  {},
	"image/jpeg": {},
	"image/webp": {},
}

type hubProviderWebsiteVerificationRequest struct {
	Method          string `json:"method"`
	EvidenceAssetID int    `json:"evidence_asset_id"`
}

func readHubProviderWebsiteEvidence(c *gin.Context) (string, []byte, error) {
	if c.Request.ContentLength > hubProviderWebsiteEvidenceMaxBytes+256*1024 {
		return "", nil, model.ErrHubProviderWebsiteEvidenceInvalid
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return "", nil, model.ErrHubProviderWebsiteEvidenceInvalid
	}
	file, err := fileHeader.Open()
	if err != nil {
		return "", nil, model.ErrHubProviderWebsiteEvidenceInvalid
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, hubProviderWebsiteEvidenceMaxBytes+1))
	if err != nil || len(data) == 0 || len(data) > hubProviderWebsiteEvidenceMaxBytes {
		return "", nil, model.ErrHubProviderWebsiteEvidenceInvalid
	}
	contentType := strings.ToLower(http.DetectContentType(data))
	if _, ok := hubProviderWebsiteEvidenceContentTypes[contentType]; !ok {
		return "", nil, model.ErrHubProviderWebsiteEvidenceInvalid
	}
	return contentType, data, nil
}

func hubProviderWebsiteVerificationError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrHubProviderNotFound):
		common.ApiErrorI18n(c, i18n.MsgHubProviderRequired)
	case errors.Is(err, model.ErrHubProviderWebsiteRequired):
		common.ApiErrorI18n(c, i18n.MsgHubProviderWebsiteRequired)
	case errors.Is(err, model.ErrHubProviderWebsiteEvidenceInvalid):
		common.ApiErrorI18n(c, i18n.MsgHubProviderWebsiteEvidenceInvalid)
	case errors.Is(err, model.ErrHubProviderWebsiteVerificationInvalid):
		common.ApiErrorI18n(c, i18n.MsgHubProviderWebsiteVerificationInvalid)
	default:
		common.ApiError(c, err)
	}
}

func UploadHubProviderWebsiteEvidence(c *gin.Context) {
	contentType, data, err := readHubProviderWebsiteEvidence(c)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderWebsiteEvidenceInvalid)
		return
	}
	asset, err := model.CreateHubProviderWebsiteEvidenceAsset(c.GetInt("id"), contentType, data)
	if err != nil {
		hubProviderWebsiteVerificationError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": asset.Id, "content_type": asset.ContentType})
}

func GetHubProviderWebsiteEvidence(c *gin.Context) {
	assetID, err := strconv.Atoi(c.Param("asset_id"))
	if err != nil || assetID <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	asset, err := model.GetHubProviderWebsiteEvidenceAsset(assetID)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	if c.GetInt("role") < common.RoleAdminUser {
		provider, providerErr := model.GetHubProviderByOwnerUserID(c.GetInt("id"))
		if providerErr != nil || provider == nil || provider.Id != asset.ProviderId {
			c.Status(http.StatusNotFound)
			return
		}
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, asset.ContentType, asset.Data)
}

func SubmitHubProviderWebsiteVerification(c *gin.Context) {
	var request hubProviderWebsiteVerificationRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	provider, err := model.SubmitHubProviderWebsiteVerification(
		c.GetInt("id"), request.Method, request.EvidenceAssetID,
	)
	if err != nil {
		hubProviderWebsiteVerificationError(c, err)
		return
	}
	common.ApiSuccess(c, provider)
}

func VerifyHubProviderWebsite(c *gin.Context) {
	provider, err := model.GetHubProviderByOwnerUserID(c.GetInt("id"))
	if err != nil || provider == nil {
		hubProviderWebsiteVerificationError(c, model.ErrHubProviderNotFound)
		return
	}
	if provider.WebsiteVerificationStatus != model.HubProviderWebsiteVerificationStatusPending ||
		(provider.WebsiteVerificationMethod != model.HubProviderWebsiteVerificationMethodDNS &&
			provider.WebsiteVerificationMethod != model.HubProviderWebsiteVerificationMethodHTTP) {
		hubProviderWebsiteVerificationError(c, model.ErrHubProviderWebsiteVerificationInvalid)
		return
	}
	origin, hostname, err := model.NormalizeHubProviderOrigin(provider.Website)
	if err != nil || origin != provider.WebsiteVerifiedOrigin || provider.WebsiteVerificationToken == "" {
		hubProviderWebsiteVerificationError(c, model.ErrHubProviderWebsiteVerificationInvalid)
		return
	}
	claim := &model.HubProviderOriginClaim{
		Origin:             origin,
		Hostname:           hostname,
		VerificationMethod: provider.WebsiteVerificationMethod,
	}
	expectedValue := model.HubProviderWebsiteVerificationPrefix + provider.WebsiteVerificationToken
	verificationErr := verifyHubProviderOriginClaim(c.Request.Context(), claim, expectedValue)
	updated, updateErr := model.UpdateHubProviderWebsiteVerificationResult(
		c.GetInt("id"), verificationErr == nil, verificationErrorMessage(verificationErr),
	)
	if updateErr != nil {
		hubProviderWebsiteVerificationError(c, updateErr)
		return
	}
	if verificationErr != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.T(c, i18n.MsgHubProviderWebsiteVerificationFailed),
			"data":    updated,
		})
		return
	}
	common.ApiSuccess(c, updated)
}
