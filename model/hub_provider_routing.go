package model

import (
	"errors"
	"net"
	"os"
	"strings"
)

const defaultHubProviderRootDomain = "llm-hub.store"

var ErrHubProviderHostInvalid = errors.New("hub provider host is invalid")
var ErrHubProviderHostNotFound = errors.New("hub provider host was not found")

type HubProviderHostResolution struct {
	IsProviderHost bool
	Provider       HubProviderRoutingInfo
}

func HubProviderRootDomain() string {
	root := strings.ToLower(strings.TrimSpace(os.Getenv("HUB_PROVIDER_ROOT_DOMAIN")))
	root = strings.TrimSuffix(root, ".")
	if root == "" || strings.ContainsAny(root, "/:\\") || net.ParseIP(root) != nil {
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
	switch {
	case strings.HasSuffix(hostname, ".localhost"):
		slug = strings.TrimSuffix(hostname, ".localhost")
	case strings.HasSuffix(hostname, "."+HubProviderRootDomain()):
		slug = strings.TrimSuffix(hostname, "."+HubProviderRootDomain())
	default:
		// Custom platform domains remain platform hosts unless explicitly configured.
		return HubProviderHostResolution{}, nil
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
	provider, ok := GetHubProviderRoutingBySlug(normalizedSlug)
	if !ok {
		return HubProviderHostResolution{}, ErrHubProviderHostNotFound
	}
	return HubProviderHostResolution{IsProviderHost: true, Provider: provider}, nil
}
