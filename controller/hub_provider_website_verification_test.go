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
	"github.com/QuantumNous/new-api/constant"
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
	adminContext.Set("role", common.RoleRootUser)
	adminContext.Params = gin.Params{{Key: "asset_id", Value: strconv.Itoa(uploadResponse.Data.ID)}}
	GetHubProviderWebsiteEvidence(adminContext)
	assert.Equal(t, http.StatusOK, adminRecorder.Code)
	assert.Equal(t, "image/png", adminRecorder.Header().Get("Content-Type"))
	assert.Equal(t, png, adminRecorder.Body.Bytes())
}

func TestHubProviderWebsiteEvidenceCannotCrossTenantForSameOwner(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.Tenant{},
		&model.TenantMember{},
		&model.HubProvider{},
		&model.HubProviderWebsiteEvidenceAsset{},
	))
	tenantA, tenantB := 101, 202
	providerA := &model.HubProvider{OwnerUserId: 42, TenantId: &tenantA, Name: "Provider A", Slug: "evidence-provider-a"}
	providerB := &model.HubProvider{OwnerUserId: 42, TenantId: &tenantB, Name: "Provider B", Slug: "evidence-provider-b"}
	require.NoError(t, model.CreateHubProvider(providerA))
	require.NoError(t, model.CreateHubProvider(providerB))
	asset, err := model.CreateHubProviderWebsiteEvidenceAsset(providerA.Id, 42, "image/png", []byte("tenant-a-evidence"))
	require.NoError(t, err)

	ctx, recorder := newAuthenticatedContext(
		t, http.MethodGet,
		"/api/hub/provider/website-verification/assets/"+strconv.Itoa(asset.Id),
		nil, 42,
	)
	ctx.Params = gin.Params{{Key: "asset_id", Value: strconv.Itoa(asset.Id)}}
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantB)
	GetHubProviderWebsiteEvidence(ctx)
	assert.Equal(t, http.StatusNotFound, ctx.Writer.Status())

	ctx, recorder = newAuthenticatedContext(
		t, http.MethodGet,
		"/api/hub/provider/website-verification/assets/"+strconv.Itoa(asset.Id),
		nil, 42,
	)
	ctx.Params = gin.Params{{Key: "asset_id", Value: strconv.Itoa(asset.Id)}}
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantA)
	GetHubProviderWebsiteEvidence(ctx)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, []byte("tenant-a-evidence"), recorder.Body.Bytes())
}

func TestTenantAdminCanOnlyReadWebsiteEvidenceInCurrentTenant(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.Tenant{},
		&model.TenantMember{},
		&model.HubProvider{},
		&model.HubProviderWebsiteEvidenceAsset{},
	))
	tenantA := model.Tenant{Name: "Tenant A", Slug: "tenant-a", Status: model.TenantStatusActive}
	tenantB := model.Tenant{Name: "Tenant B", Slug: "tenant-b", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenantA).Error)
	require.NoError(t, db.Create(&tenantB).Error)
	require.NoError(t, db.Create(&model.TenantMember{
		TenantId: tenantA.Id,
		UserId:   77,
		Role:     model.TenantMemberRoleAdmin,
		Status:   model.TenantMemberStatusActive,
	}).Error)
	providerA := &model.HubProvider{
		OwnerUserId: 42,
		TenantId:    &tenantA.Id,
		Name:        "Provider A",
		Slug:        "tenant-admin-evidence-a",
	}
	providerB := &model.HubProvider{
		OwnerUserId: 43,
		TenantId:    &tenantB.Id,
		Name:        "Provider B",
		Slug:        "tenant-admin-evidence-b",
	}
	require.NoError(t, model.CreateHubProvider(providerA))
	require.NoError(t, model.CreateHubProvider(providerB))
	assetA, err := model.CreateHubProviderWebsiteEvidenceAsset(
		providerA.Id, providerA.OwnerUserId, "image/png", []byte("tenant-a-private-evidence"),
	)
	require.NoError(t, err)

	ctx, recorder := newAuthenticatedContext(
		t, http.MethodGet,
		"/api/hub/provider/website-verification/assets/"+strconv.Itoa(assetA.Id),
		nil, 77,
	)
	ctx.Params = gin.Params{{Key: "asset_id", Value: strconv.Itoa(assetA.Id)}}
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantA.Id)
	GetHubProviderWebsiteEvidence(ctx)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, []byte("tenant-a-private-evidence"), recorder.Body.Bytes())

	ctx, _ = newAuthenticatedContext(
		t, http.MethodGet,
		"/api/hub/provider/website-verification/assets/"+strconv.Itoa(assetA.Id),
		nil, 77,
	)
	ctx.Params = gin.Params{{Key: "asset_id", Value: strconv.Itoa(assetA.Id)}}
	common.SetContextKey(ctx, constant.ContextKeyTenantId, tenantB.Id)
	GetHubProviderWebsiteEvidence(ctx)
	assert.Equal(t, http.StatusNotFound, ctx.Writer.Status())
}
