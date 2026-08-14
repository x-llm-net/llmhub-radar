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
package controller

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/hub_provider_setting"
	"github.com/gin-gonic/gin"
)

const hubProviderOriginVerificationPrefix = "llm-hub-verification="
const hubProviderOriginRequiredCode = "hub_provider_origin_required"

var hubProviderOriginTXTLookup = net.LookupTXT
var hubProviderOriginHTTPClient = service.GetPublicNetworkHTTPClient

type hubProviderOriginClaimRequest struct {
	BaseURL            string `json:"base_url"`
	VerificationMethod string `json:"verification_method"`
}

type hubProviderOriginClaimResponse struct {
	ID                 int    `json:"id"`
	Origin             string `json:"origin"`
	Hostname           string `json:"hostname"`
	VerificationMethod string `json:"verification_method"`
	Status             string `json:"status"`
	VerifiedAt         int64  `json:"verified_at"`
	CreatedAt          int64  `json:"created_at"`
	UpdatedAt          int64  `json:"updated_at"`
	DNSRecord          string `json:"dns_record"`
	DNSValue           string `json:"dns_value"`
	HTTPURL            string `json:"http_url"`
	HTTPBody           string `json:"http_body"`
}

func newHubProviderOriginClaimResponse(claim model.HubProviderOriginClaim) hubProviderOriginClaimResponse {
	expectedValue := hubProviderOriginVerificationPrefix + claim.VerificationToken
	return hubProviderOriginClaimResponse{
		ID:                 claim.Id,
		Origin:             claim.Origin,
		Hostname:           claim.Hostname,
		VerificationMethod: claim.VerificationMethod,
		Status:             claim.Status,
		VerifiedAt:         claim.VerifiedAt,
		CreatedAt:          claim.CreatedAt,
		UpdatedAt:          claim.UpdatedAt,
		DNSRecord:          "_llm-hub-verification." + claim.Hostname,
		DNSValue:           expectedValue,
		HTTPURL:            claim.Origin + model.HubProviderOriginClaimHTTPPath,
		HTTPBody:           expectedValue,
	}
}

func GetHubProviderOriginClaims(c *gin.Context) {
	provider, err := getCurrentHubProvider(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if provider == nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderRequired)
		return
	}
	claims, err := model.ListHubProviderOriginClaims(provider.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]hubProviderOriginClaimResponse, 0, len(claims))
	for _, claim := range claims {
		items = append(items, newHubProviderOriginClaimResponse(claim))
	}
	common.ApiSuccess(c, items)
}

func CreateHubProviderOriginClaim(c *gin.Context) {
	provider, ok := requireActiveHubProvider(c)
	if !ok {
		return
	}
	var req hubProviderOriginClaimRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.VerificationMethod = strings.ToLower(strings.TrimSpace(req.VerificationMethod))
	if !model.IsValidHubProviderOriginClaimMethod(req.VerificationMethod) {
		common.ApiErrorI18n(c, i18n.MsgHubProviderOriginMethodInvalid)
		return
	}
	required, origin, hostname, err := model.HubProviderChannelOriginRequiresClaim(0, req.BaseURL)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderOriginInvalid)
		return
	}
	if !required {
		common.ApiErrorI18n(c, i18n.MsgHubProviderOriginNotRequired)
		return
	}
	if err := service.ValidatePublicNetworkURL(origin); err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderOriginInvalid)
		return
	}
	if err := model.DeleteExpiredHubProviderOriginClaims(common.GetTimestamp()); err != nil {
		common.ApiError(c, err)
		return
	}
	existing, err := model.GetHubProviderOriginClaimByOrigin(origin)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if existing != nil {
		if existing.ProviderId != provider.Id {
			common.ApiErrorI18n(c, i18n.MsgHubProviderOriginClaimed)
			return
		}
		common.ApiSuccess(c, newHubProviderOriginClaimResponse(*existing))
		return
	}
	token, err := model.GenerateHubProviderOriginVerificationToken()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	claim := &model.HubProviderOriginClaim{
		ProviderId:         provider.Id,
		Origin:             origin,
		Hostname:           hostname,
		VerificationMethod: req.VerificationMethod,
		VerificationToken:  token,
		Status:             model.HubProviderOriginClaimStatusPending,
	}
	if err := model.CreateHubProviderOriginClaim(claim); err != nil {
		if err == model.ErrHubProviderOriginAlreadyClaimed {
			common.ApiErrorI18n(c, i18n.MsgHubProviderOriginClaimed)
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, newHubProviderOriginClaimResponse(*claim))
}

func VerifyHubProviderOriginClaim(c *gin.Context) {
	provider, ok := requireActiveHubProvider(c)
	if !ok {
		return
	}
	claimID, err := strconv.Atoi(c.Param("claim_id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderOriginNotFound)
		return
	}
	claim, err := model.GetHubProviderOriginClaimByIDAndProviderID(claimID, provider.Id)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderOriginNotFound)
		return
	}
	if model.IsHubProviderOriginClaimExpired(claim, common.GetTimestamp()) {
		_ = model.DeleteHubProviderOriginClaim(claim.Id, provider.Id)
		common.ApiErrorI18n(c, i18n.MsgHubProviderOriginNotFound)
		return
	}
	if claim.Status == model.HubProviderOriginClaimStatusVerified {
		common.ApiSuccess(c, newHubProviderOriginClaimResponse(*claim))
		return
	}
	expectedValue := hubProviderOriginVerificationPrefix + claim.VerificationToken
	verificationErr := verifyHubProviderOriginClaim(c.Request.Context(), claim, expectedValue)
	updated, updateErr := model.UpdateHubProviderOriginClaimVerification(
		claim.Id,
		provider.Id,
		verificationErr == nil,
		verificationErrorMessage(verificationErr),
	)
	if updateErr != nil {
		common.ApiError(c, updateErr)
		return
	}
	if verificationErr != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.T(c, i18n.MsgHubProviderOriginVerificationFailed),
			"data":    newHubProviderOriginClaimResponse(*updated),
		})
		return
	}
	common.ApiSuccess(c, newHubProviderOriginClaimResponse(*updated))
}

func verifyHubProviderOriginClaim(ctx context.Context, claim *model.HubProviderOriginClaim, expectedValue string) error {
	switch claim.VerificationMethod {
	case model.HubProviderOriginClaimMethodDNS:
		records, err := hubProviderOriginTXTLookup("_llm-hub-verification." + claim.Hostname)
		if err != nil {
			return fmt.Errorf("DNS TXT lookup failed: %w", err)
		}
		for _, record := range records {
			if strings.TrimSpace(record) == expectedValue {
				return nil
			}
		}
		return fmt.Errorf("expected DNS TXT value was not found")
	case model.HubProviderOriginClaimMethodHTTP:
		verificationURL := claim.Origin + model.HubProviderOriginClaimHTTPPath
		requestCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, verificationURL, nil)
		if err != nil {
			return err
		}
		client := hubProviderOriginHTTPClient()
		if client == nil {
			return fmt.Errorf("HTTP client is not initialized")
		}
		response, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("verification file request failed: %w", err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return fmt.Errorf("verification file returned HTTP %d", response.StatusCode)
		}
		body, err := io.ReadAll(io.LimitReader(response.Body, 4097))
		if err != nil {
			return fmt.Errorf("verification file read failed: %w", err)
		}
		if len(body) > 4096 || strings.TrimSpace(string(body)) != expectedValue {
			return fmt.Errorf("verification file content does not match")
		}
		return nil
	default:
		return fmt.Errorf("unsupported verification method")
	}
}

func verificationErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	if len(message) > 1000 {
		return message[:1000]
	}
	return message
}

func DeleteHubProviderOriginClaim(c *gin.Context) {
	provider, ok := requireActiveHubProvider(c)
	if !ok {
		return
	}
	claimID, err := strconv.Atoi(c.Param("claim_id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderOriginNotFound)
		return
	}
	claim, err := model.GetHubProviderOriginClaimByIDAndProviderID(claimID, provider.Id)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgHubProviderOriginNotFound)
		return
	}
	if claim.Status == model.HubProviderOriginClaimStatusVerified {
		common.ApiErrorI18n(c, i18n.MsgHubProviderOriginVerifiedDelete)
		return
	}
	if err := model.DeleteHubProviderOriginClaim(claimID, provider.Id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func requireHubProviderChannelOriginClaim(providerID int, channel *model.Channel) error {
	if channel == nil {
		return fmt.Errorf("channel cannot be empty")
	}
	if !hub_provider_setting.IsOriginVerificationEnabled() {
		return nil
	}
	required, _, _, err := model.HubProviderChannelOriginRequiresClaim(channel.Type, channel.GetBaseURL())
	if err != nil {
		return err
	}
	if !required {
		return nil
	}
	verified, err := model.HasVerifiedHubProviderOriginClaim(providerID, channel.GetBaseURL())
	if err != nil {
		return err
	}
	if !verified {
		return model.ErrHubProviderOriginClaimNotFound
	}
	return nil
}

func hubProviderOriginRequiredError(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"code":    hubProviderOriginRequiredCode,
		"message": i18n.T(c, i18n.MsgHubProviderOriginRequired),
	})
}
