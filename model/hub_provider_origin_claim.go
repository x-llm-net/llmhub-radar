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
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"golang.org/x/net/idna"
	"gorm.io/gorm"
)

const (
	HubProviderOriginClaimStatusPending  = "pending"
	HubProviderOriginClaimStatusVerified = "verified"
	HubProviderOriginClaimStatusConflict = "conflict"
	HubProviderOriginClaimMethodDNS      = "dns"
	HubProviderOriginClaimMethodHTTP     = "http"
	HubProviderOriginClaimMethodLegacy   = "legacy"
	HubProviderOriginClaimHTTPPath       = "/.well-known/llm-hub-provider-verification.txt"
	HubProviderOriginClaimPendingTTL     = int64(24 * 60 * 60)
)

var ErrHubProviderOriginAlreadyClaimed = errors.New("hub provider origin already claimed")
var ErrHubProviderOriginClaimNotFound = errors.New("hub provider origin claim not found")

type HubProviderOriginClaim struct {
	Id                 int    `json:"id" gorm:"primaryKey"`
	ProviderId         int    `json:"provider_id" gorm:"not null;index"`
	Origin             string `json:"origin" gorm:"type:varchar(191);not null;uniqueIndex"`
	Hostname           string `json:"hostname" gorm:"type:varchar(253);not null"`
	VerificationMethod string `json:"verification_method" gorm:"type:varchar(16);not null"`
	VerificationToken  string `json:"verification_token" gorm:"type:varchar(128);not null"`
	Status             string `json:"status" gorm:"type:varchar(24);not null;index"`
	LastError          string `json:"last_error" gorm:"type:varchar(1000);not null;default:''"`
	VerifiedAt         int64  `json:"verified_at" gorm:"bigint;not null;default:0"`
	CreatedAt          int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt          int64  `json:"updated_at" gorm:"bigint"`
}

func (HubProviderOriginClaim) TableName() string {
	return "hub_provider_origin_claims"
}

func (claim *HubProviderOriginClaim) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if claim.Status == "" {
		claim.Status = HubProviderOriginClaimStatusPending
	}
	claim.CreatedAt = now
	claim.UpdatedAt = now
	return nil
}

func NormalizeHubProviderOrigin(rawURL string) (string, string, error) {
	rawURL = strings.TrimSpace(rawURL)
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", "", errors.New("invalid upstream URL")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", "", errors.New("upstream URL must use HTTP or HTTPS")
	}
	if parsed.User != nil {
		return "", "", errors.New("upstream URL must not contain credentials")
	}
	hostname := strings.ToLower(strings.TrimRight(parsed.Hostname(), "."))
	if hostname == "" || net.ParseIP(hostname) != nil || hostname == "localhost" {
		return "", "", errors.New("upstream URL must use a public hostname")
	}
	hostname, err = idna.Lookup.ToASCII(hostname)
	hostname = strings.ToLower(strings.TrimRight(hostname, "."))
	if err != nil || len(hostname) > 253 || net.ParseIP(hostname) != nil || hostname == "localhost" {
		return "", "", errors.New("upstream URL must use a valid hostname")
	}
	port := parsed.Port()
	if port != "" {
		portNumber, portErr := strconv.Atoi(port)
		if portErr != nil || portNumber < 1 || portNumber > 65535 {
			return "", "", errors.New("upstream URL must use a valid port")
		}
		port = strconv.Itoa(portNumber)
	}
	origin := parsed.Scheme + "://" + hostname
	if port != "" && !((parsed.Scheme == "http" && port == "80") || (parsed.Scheme == "https" && port == "443")) {
		origin = fmt.Sprintf("%s://%s", parsed.Scheme, net.JoinHostPort(hostname, port))
	}
	if len(origin) > 191 {
		return "", "", errors.New("upstream URL origin is too long")
	}
	return origin, hostname, nil
}

func GenerateHubProviderOriginVerificationToken() (string, error) {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func IsHubProviderOriginClaimExpired(claim *HubProviderOriginClaim, now int64) bool {
	return claim != nil && claim.Status == HubProviderOriginClaimStatusPending &&
		claim.CreatedAt > 0 && claim.CreatedAt+HubProviderOriginClaimPendingTTL <= now
}

func DeleteExpiredHubProviderOriginClaims(now int64) error {
	cutoff := now - HubProviderOriginClaimPendingTTL
	return DB.Where("status = ? AND created_at > 0 AND created_at <= ?", HubProviderOriginClaimStatusPending, cutoff).
		Delete(&HubProviderOriginClaim{}).Error
}

func IsValidHubProviderOriginClaimMethod(method string) bool {
	return method == HubProviderOriginClaimMethodDNS || method == HubProviderOriginClaimMethodHTTP
}

func ResetHubProviderOriginClaim(claim *HubProviderOriginClaim, method, token string) error {
	if claim == nil || claim.Id <= 0 || claim.ProviderId <= 0 || !IsValidHubProviderOriginClaimMethod(method) || token == "" {
		return errors.New("invalid hub provider origin claim reset")
	}
	if claim.Status == HubProviderOriginClaimStatusVerified {
		return nil
	}
	return DB.Model(&HubProviderOriginClaim{}).Where("id = ? AND provider_id = ?", claim.Id, claim.ProviderId).
		Updates(map[string]any{
			"verification_method": method,
			"verification_token":  token,
			"status":              HubProviderOriginClaimStatusPending,
			"last_error":          "",
			"verified_at":         0,
			"updated_at":          common.GetTimestamp(),
		}).Error
}

func CreateHubProviderOriginClaim(claim *HubProviderOriginClaim) error {
	if claim == nil || claim.ProviderId <= 0 || claim.Origin == "" || claim.Hostname == "" ||
		!IsValidHubProviderOriginClaimMethod(claim.VerificationMethod) || claim.VerificationToken == "" {
		return errors.New("invalid hub provider origin claim")
	}
	if err := DB.Create(claim).Error; err != nil {
		var existing HubProviderOriginClaim
		if lookupErr := DB.Where("origin = ?", claim.Origin).First(&existing).Error; lookupErr == nil {
			return ErrHubProviderOriginAlreadyClaimed
		}
		return err
	}
	return nil
}

func GetHubProviderOriginClaimByOrigin(origin string) (*HubProviderOriginClaim, error) {
	var claim HubProviderOriginClaim
	err := DB.Where("origin = ?", origin).First(&claim).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &claim, err
}

func GetHubProviderOriginClaimByIDAndProviderID(id, providerID int) (*HubProviderOriginClaim, error) {
	var claim HubProviderOriginClaim
	err := DB.Where("id = ? AND provider_id = ?", id, providerID).First(&claim).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrHubProviderOriginClaimNotFound
	}
	return &claim, err
}

func ListHubProviderOriginClaims(providerID int) ([]HubProviderOriginClaim, error) {
	if err := DeleteExpiredHubProviderOriginClaims(common.GetTimestamp()); err != nil {
		return nil, err
	}
	claims := make([]HubProviderOriginClaim, 0)
	err := DB.Where("provider_id = ?", providerID).Order("id DESC").Find(&claims).Error
	return claims, err
}

func UpdateHubProviderOriginClaimVerification(id, providerID int, verified bool, lastError string) (*HubProviderOriginClaim, error) {
	status := HubProviderOriginClaimStatusPending
	verifiedAt := int64(0)
	if verified {
		status = HubProviderOriginClaimStatusVerified
		verifiedAt = common.GetTimestamp()
	}
	result := DB.Model(&HubProviderOriginClaim{}).
		Where("id = ? AND provider_id = ?", id, providerID).
		Updates(map[string]any{
			"status":      status,
			"last_error":  strings.TrimSpace(lastError),
			"verified_at": verifiedAt,
			"updated_at":  common.GetTimestamp(),
		})
	if result.Error != nil {
		return nil, result.Error
	}
	return GetHubProviderOriginClaimByIDAndProviderID(id, providerID)
}

func DeleteHubProviderOriginClaim(id, providerID int) error {
	result := DB.Where("id = ? AND provider_id = ?", id, providerID).Delete(&HubProviderOriginClaim{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrHubProviderOriginClaimNotFound
	}
	return nil
}

func HasVerifiedHubProviderOriginClaim(providerID int, rawURL string) (bool, error) {
	origin, _, err := NormalizeHubProviderOrigin(rawURL)
	if err != nil {
		return false, err
	}
	var count int64
	err = DB.Model(&HubProviderOriginClaim{}).
		Where("provider_id = ? AND origin = ? AND status = ?", providerID, origin, HubProviderOriginClaimStatusVerified).
		Count(&count).Error
	return count > 0, err
}
