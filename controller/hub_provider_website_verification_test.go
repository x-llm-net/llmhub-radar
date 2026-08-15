/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
package controller

import (
	"bytes"
	"encoding/base64"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHubProviderWebsiteEvidenceUploadAndPrivateRead(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.HubProvider{},
		&model.HubProviderWebsiteEvidenceAsset{},
	))
	provider := &model.HubProvider{
		OwnerUserId: 42,
		Name:        "Screenshot Provider",
		Website:     "https://example.com",
	}
	require.NoError(t, model.CreateHubProvider(provider))

	png, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	part, err := writer.CreateFormFile("file", "evidence.png")
	require.NoError(t, err)
	_, err = part.Write(png)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	uploadRecorder := httptest.NewRecorder()
	uploadContext, _ := gin.CreateTestContext(uploadRecorder)
	uploadContext.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/hub/provider/website-verification/assets",
		&requestBody,
	)
	uploadContext.Request.Header.Set("Content-Type", writer.FormDataContentType())
	uploadContext.Set("id", 42)
	UploadHubProviderWebsiteEvidence(uploadContext)

	var uploadResponse struct {
		Success bool `json:"success"`
		Data    struct {
			ID int `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(uploadRecorder.Body.Bytes(), &uploadResponse))
	require.True(t, uploadResponse.Success, uploadRecorder.Body.String())
	require.Positive(t, uploadResponse.Data.ID)

	foreignContext, foreignRecorder := newAuthenticatedContext(
		t,
		http.MethodGet,
		"/api/hub/provider/website-verification/assets/"+strconv.Itoa(uploadResponse.Data.ID),
		nil,
		43,
	)
	foreignContext.Params = gin.Params{{Key: "asset_id", Value: strconv.Itoa(uploadResponse.Data.ID)}}
	GetHubProviderWebsiteEvidence(foreignContext)
	assert.Equal(t, http.StatusNotFound, foreignContext.Writer.Status())
	assert.Empty(t, foreignRecorder.Body.Bytes())

	adminContext, adminRecorder := newAuthenticatedContext(
		t,
		http.MethodGet,
		"/api/hub/provider/website-verification/assets/"+strconv.Itoa(uploadResponse.Data.ID),
		nil,
		1,
	)
	adminContext.Set("role", common.RoleAdminUser)
	adminContext.Params = gin.Params{{Key: "asset_id", Value: strconv.Itoa(uploadResponse.Data.ID)}}
	GetHubProviderWebsiteEvidence(adminContext)
	assert.Equal(t, http.StatusOK, adminRecorder.Code)
	assert.Equal(t, "image/png", adminRecorder.Header().Get("Content-Type"))
	assert.Equal(t, png, adminRecorder.Body.Bytes())
}
