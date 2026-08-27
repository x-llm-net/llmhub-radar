package model

import (
	"errors"
	"net"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const defaultHubProviderRootDomain = "llm-hub.store"

var ErrHubProviderHostInvalid = errors.New("hub provider host is invalid")
var ErrHubProviderHostNotFound = errors.New("hub provider host was not found")

type HubProviderHostResolution struct {
	IsProviderHost bool
	Provider       HubProviderRoutingInfo
}

func HubProviderRootDomain() string {
	root := configuredHubProviderRootDomain()
	normalized, err := NormalizeTenantRootDomain(root)
	if err != nil {
		return defaultHubProviderRootDomain
	}
	return normalized
}

func configuredHubProviderRootDomain() string {
	root := strings.ToLower(strings.TrimSpace(os.Getenv("HUB_PROVIDER_ROOT_DOMAIN")))
	if root == "" {
		return defaultHubProviderRootDomain
	}
	return root
}

func normalizeRequestHostname(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	} else if strings.Count(host, ":") == 1 {
		host = strings.SplitN(host, ":", 2)[0]
	}
	return strings.TrimSuffix(strings.Trim(host, "[]"), ".")
}

func ResolveHubProviderHost(host string) (HubProviderHostResolution, error) {
	hostname := normalizeRequestHostname(host)
	if hostname == "" {
		return HubProviderHostResolution{}, ErrHubProviderHostInvalid
	}
	if net.ParseIP(hostname) != nil || hostname == "localhost" || hostname == HubProviderRootDomain() {
		return HubProviderHostResolution{}, nil
	}

	var slug string
	var provider HubProviderRoutingInfo
	var ok bool
	if strings.HasSuffix(hostname, ".localhost") {
		slug = strings.TrimSuffix(hostname, ".localhost")
	} else {
		slug, hostname, ok = strings.Cut(hostname, ".")
		if !ok || slug == "" || hostname == "" {
			return HubProviderHostResolution{}, nil
		}
		var tenantHost TenantHostResolution
		var configured bool
		if common.MemoryCacheEnabled {
			tenantHost, provider, configured, ok = getCachedTenantProviderRouting(hostname, slug)
		} else {
			var lookupErr error
			tenantHost, configured, lookupErr = resolveExactTenantHostname(hostname)
			if lookupErr != nil {
				return HubProviderHostResolution{}, lookupErr
			}
		}
		if configured {
			if !tenantHost.IsTenantHost {
				return HubProviderHostResolution{}, ErrHubProviderHostNotFound
			}
			if !common.MemoryCacheEnabled {
				provider, ok = GetHubProviderRoutingByTenantAndSlug(tenantHost.TenantID, slug)
			}
		} else if hostname == HubProviderRootDomain() {
			// Compatibility for pre-tenant installations and local test data.
			// Duplicate slugs are intentionally treated as ambiguous.
			provider, ok = GetHubProviderRoutingBySlug(slug)
		} else {
			if strings.HasSuffix(hostname, "."+HubProviderRootDomain()) {
				return HubProviderHostResolution{}, ErrHubProviderHostInvalid
			}
			return HubProviderHostResolution{}, nil
		}
	}
	if strings.Contains(slug, ".") {
		return HubProviderHostResolution{}, ErrHubProviderHostInvalid
	}
	if _, reserved := hubProviderReservedSlugs[slug]; reserved {
		return HubProviderHostResolution{}, nil
	}
	normalizedSlug, err := NormalizeHubProviderSlug(slug)
	if err != nil {
		return HubProviderHostResolution{}, ErrHubProviderHostInvalid
	}
	if strings.HasSuffix(normalizeRequestHostname(host), ".localhost") {
		provider, ok = GetHubProviderRoutingBySlug(normalizedSlug)
	} else if provider.Slug != normalizedSlug {
		ok = false
	}
	if !ok {
		return HubProviderHostResolution{}, ErrHubProviderHostNotFound
	}
	return HubProviderHostResolution{IsProviderHost: true, Provider: provider}, nil
}
