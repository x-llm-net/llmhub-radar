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

const hubProviderLogoMaxBytes = 512 * 1024

var hubProviderLogoContentTypes = map[string]struct{}{
	"image/png":  {},
	"image/jpeg": {},
	"image/webp": {},
}

func readHubProviderLogo(c *gin.Context) (string, []byte, error) {
	fileHeader, err := c.FormFile("logo")
	if err != nil {
		return "", nil, model.ErrHubProviderLogoInvalid
	}
	file, err := fileHeader.Open()
	if err != nil {
		return "", nil, model.ErrHubProviderLogoInvalid
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, hubProviderLogoMaxBytes+1))
	if err != nil || len(data) == 0 || len(data) > hubProviderLogoMaxBytes {
		return "", nil, model.ErrHubProviderLogoInvalid
	}
	contentType := strings.ToLower(http.DetectContentType(data))
	if _, ok := hubProviderLogoContentTypes[contentType]; !ok {
		return "", nil, model.ErrHubProviderLogoInvalid
	}
	return contentType, data, nil
}

func hubProviderLogoError(c *gin.Context, err error) {
	if errors.Is(err, model.ErrHubProviderLogoInvalid) {
		common.ApiErrorI18n(c, i18n.MsgHubProviderLogoInvalid)
		return
	}
	common.ApiError(c, err)
}

func getHubProviderLogoAssetForProvider(c *gin.Context, providerID int) (*model.HubProviderLogoAsset, error) {
	if providerID <= 0 {
		return nil, model.ErrHubProviderLogoInvalid
	}
	asset, err := model.GetHubProviderLogoAsset(providerID)
	if err != nil {
		return nil, err
	}
	return asset, nil
}

func serveHubProviderLogo(c *gin.Context, asset *model.HubProviderLogoAsset, public bool) {
	if public {
		c.Header("Cache-Control", "public, max-age=300")
	} else {
		c.Header("Cache-Control", "private, no-store")
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, asset.ContentType, asset.Data)
}

func GetHubProviderLogo(c *gin.Context) {
	provider, err := getCurrentHubProvider(c)
	if err != nil || provider == nil {
		c.Status(http.StatusNotFound)
		return
	}
	asset, err := getHubProviderLogoAssetForProvider(c, provider.Id)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	serveHubProviderLogo(c, asset, false)
}

func GetPublicHubProviderLogo(c *gin.Context) {
	slug, err := model.NormalizeHubProviderSlug(c.Param("slug"))
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	tenantID, ok := publicHubProviderTenantID(c, slug)
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}
	provider, err := model.GetActiveHubProviderBySlugInTenant(slug, tenantID)
	if err != nil || provider == nil {
		c.Status(http.StatusNotFound)
		return
	}
	asset, err := getHubProviderLogoAssetForProvider(c, provider.Id)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	serveHubProviderLogo(c, asset, true)
}

func GetAdminHubProviderLogo(c *gin.Context) {
	providerID, err := strconv.Atoi(c.Param("id"))
	if err != nil || providerID <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	if _, err := getHubProviderForAdminScope(c, providerID); err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	asset, err := getHubProviderLogoAssetForProvider(c, providerID)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	serveHubProviderLogo(c, asset, false)
}

func GetAdminHubProviderOverviewLogo(c *gin.Context) {
	providerID, err := strconv.Atoi(c.Param("id"))
	if err != nil || providerID <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	provider, err := model.GetHubProviderByID(providerID)
	if err != nil || provider == nil {
		c.Status(http.StatusNotFound)
		return
	}
	asset, err := getHubProviderLogoAssetForProvider(c, provider.Id)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	serveHubProviderLogo(c, asset, false)
}
