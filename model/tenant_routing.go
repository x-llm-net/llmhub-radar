package model

import (
	"errors"
	"net"
	"strings"

	"gorm.io/gorm"
)

var ErrTenantHostInvalid = errors.New("tenant host is invalid")

// TenantHostResolution distinguishes an unknown host from a configured host
// that is not currently trusted or available.
type TenantHostResolution struct {
	IsConfigured       bool
	IsTenantHost       bool
	TenantID           int
	DomainID           int
	Host               string
	TenantStatus       string
	DomainStatus       string
	VerificationStatus string
}

func normalizeTenantHost(host string) (string, error) {
	hostname := normalizeRequestHostname(host)
	if hostname == "" || hostname == "localhost" || net.ParseIP(hostname) != nil || !strings.Contains(hostname, ".") {
		return "", ErrTenantHostInvalid
	}
	return hostname, nil
}

// NormalizeTenantHost exposes the same hostname normalization used by
// trusted Host resolution for administrator-managed domain records.
func NormalizeTenantHost(host string) (string, error) {
	return normalizeTenantHost(host)
}

func ResolveTenantHost(host string) (TenantHostResolution, error) {
	hostname, err := normalizeTenantHost(host)
	if err != nil {
		return TenantHostResolution{}, err
	}

	var resolution TenantHostResolution
	err = DB.Table("tenant_domains AS domains").
		Select(
			"domains.id AS domain_id, domains.tenant_id, domains.host, "+
				"domains.status AS domain_status, domains.verification_status, "+
				"tenants.status AS tenant_status",
		).
		Joins("JOIN tenants ON tenants.id = domains.tenant_id").
		Where("domains.host = ?", hostname).
		Take(&resolution).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return TenantHostResolution{}, nil
	}
	if err != nil {
		return TenantHostResolution{}, err
	}

	resolution.IsConfigured = true
	resolution.IsTenantHost = resolution.TenantID > 0 &&
		resolution.TenantStatus == TenantStatusActive &&
		resolution.DomainStatus == TenantDomainStatusActive &&
		resolution.VerificationStatus == TenantDomainVerificationVerified
	return resolution, nil
}
