package model

import (
	"errors"
	"fmt"
	"net"
	"strings"

	"github.com/QuantumNous/new-api/common"
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

func normalizeTenantRequestHost(host string) (string, error) {
	hostname := normalizeRequestHostname(host)
	if hostname == "" || hostname == "localhost" || net.ParseIP(hostname) != nil || !strings.Contains(hostname, ".") {
		return "", ErrTenantHostInvalid
	}
	return hostname, nil
}

func validTenantDomainLabel(label string) bool {
	if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
		return false
	}
	for _, char := range label {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
			return false
		}
	}
	return true
}

func containsASCIILetter(value string) bool {
	for _, char := range value {
		if char >= 'a' && char <= 'z' {
			return true
		}
	}
	return false
}

// NormalizeTenantRootDomain accepts only the supported two-label root-domain shape.
// Tenant subdomains are intentionally unsupported in the first version.
func NormalizeTenantRootDomain(host string) (string, error) {
	rawHost := strings.ToLower(strings.TrimSpace(host))
	if strings.HasSuffix(rawHost, "..") {
		return "", ErrTenantHostInvalid
	}
	rawHost = strings.TrimSuffix(rawHost, ".")
	if strings.ContainsAny(rawHost, "/\\:") {
		return "", ErrTenantHostInvalid
	}
	hostname, err := normalizeTenantRequestHost(rawHost)
	if err != nil {
		return "", err
	}
	labels := strings.Split(hostname, ".")
	if len(labels) != 2 || !validTenantDomainLabel(labels[0]) || !validTenantDomainLabel(labels[1]) || !containsASCIILetter(labels[1]) {
		return "", ErrTenantHostInvalid
	}
	return hostname, nil
}

func loadTenantHostRoutingCache() (map[string]TenantHostResolution, error) {
	tenantByHost := make(map[string]TenantHostResolution)
	if DB == nil || !DB.Migrator().HasTable(&TenantDomain{}) || !DB.Migrator().HasTable(&Tenant{}) {
		return tenantByHost, nil
	}

	var tenantHosts []TenantHostResolution
	if err := DB.Table("tenant_domains AS domains").
		Select(
			"domains.id AS domain_id, domains.tenant_id, domains.host, " +
				"domains.status AS domain_status, domains.verification_status, " +
				"tenants.status AS tenant_status",
		).
		Joins("JOIN tenants ON tenants.id = domains.tenant_id").
		Scan(&tenantHosts).Error; err != nil {
		return nil, err
	}
	for _, tenantHost := range tenantHosts {
		normalizedHost, err := NormalizeTenantRootDomain(tenantHost.Host)
		if err != nil {
			return nil, fmt.Errorf("invalid tenant root domain %q: %w", tenantHost.Host, err)
		}
		tenantHost.Host = normalizedHost
		tenantHost.IsConfigured = true
		tenantHost.IsTenantHost = tenantHost.TenantID > 0 &&
			tenantHost.TenantStatus == TenantStatusActive &&
			tenantHost.DomainStatus == TenantDomainStatusActive &&
			tenantHost.VerificationStatus == TenantDomainVerificationVerified
		if existing, found := tenantByHost[tenantHost.Host]; found && existing.DomainID != tenantHost.DomainID {
			return nil, fmt.Errorf("duplicate normalized tenant root domain %q", tenantHost.Host)
		}
		tenantByHost[tenantHost.Host] = tenantHost
	}
	return tenantByHost, nil
}

// ValidateTenantRoutingConfiguration rejects unsupported tenant domains before
// the service starts accepting traffic.
func ValidateTenantRoutingConfiguration() error {
	configuredRoot := configuredHubProviderRootDomain()
	if _, err := NormalizeTenantRootDomain(configuredRoot); err != nil {
		return fmt.Errorf("invalid hub provider root domain %q: %w", configuredRoot, err)
	}
	_, err := loadTenantHostRoutingCache()
	return err
}

func resolveExactTenantHostname(hostname string) (TenantHostResolution, bool, error) {
	if common.MemoryCacheEnabled {
		hubSupplyPricingMu.RLock()
		resolution, found := hubTenantRoutingByHost[hostname]
		hubSupplyPricingMu.RUnlock()
		return resolution, found, nil
	}
	if DB == nil || !DB.Migrator().HasTable(&TenantDomain{}) || !DB.Migrator().HasTable(&Tenant{}) {
		return TenantHostResolution{}, false, nil
	}
	var resolution TenantHostResolution
	err := DB.Table("tenant_domains AS domains").
		Select(
			"domains.id AS domain_id, domains.tenant_id, domains.host, "+
				"domains.status AS domain_status, domains.verification_status, "+
				"tenants.status AS tenant_status",
		).
		Joins("JOIN tenants ON tenants.id = domains.tenant_id").
		Where("domains.host = ?", hostname).
		Take(&resolution).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return TenantHostResolution{}, false, nil
	}
	if err != nil {
		return TenantHostResolution{}, false, err
	}

	resolution.IsConfigured = true
	resolution.IsTenantHost = resolution.TenantID > 0 &&
		resolution.TenantStatus == TenantStatusActive &&
		resolution.DomainStatus == TenantDomainStatusActive &&
		resolution.VerificationStatus == TenantDomainVerificationVerified
	return resolution, true, nil
}

func ResolveTenantHost(host string) (TenantHostResolution, error) {
	hostname, err := normalizeTenantRequestHost(host)
	if err != nil {
		return TenantHostResolution{}, err
	}

	resolution, found, err := resolveExactTenantHostname(hostname)
	if err != nil {
		return TenantHostResolution{}, err
	}
	if !found {
		// Provider subdomains inherit the brand and tenant scope of the
		// provider they expose. The platform root remains resolved through
		// tenant_domains above, while legacy platform providers stay unscoped.
		providerHost, providerErr := ResolveHubProviderHost(hostname)
		if providerErr != nil || !providerHost.IsProviderHost ||
			providerHost.Provider.Status != HubProviderStatusActive ||
			providerHost.Provider.TenantId == nil {
			return TenantHostResolution{}, nil
		}
		tenant, tenantErr := GetActiveTenantByID(*providerHost.Provider.TenantId)
		if errors.Is(tenantErr, ErrTenantNotFound) {
			return TenantHostResolution{}, nil
		}
		if tenantErr != nil {
			return TenantHostResolution{}, tenantErr
		}
		return TenantHostResolution{
			IsConfigured:       true,
			IsTenantHost:       true,
			TenantID:           tenant.Id,
			Host:               hostname,
			TenantStatus:       tenant.Status,
			DomainStatus:       TenantDomainStatusActive,
			VerificationStatus: TenantDomainVerificationVerified,
		}, nil
	}
	return resolution, nil
}
