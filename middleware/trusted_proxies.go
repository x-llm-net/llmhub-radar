package middleware

import (
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

var defaultTrustedProxyCIDRs = []string{
	"127.0.0.0/8",
	"::1",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"fc00::/7",
}

var trustedProxyState = struct {
	sync.RWMutex
	networks []*net.IPNet
}{}

func updateTrustedProxyState(entries []string) error {
	networks := make([]*net.IPNet, 0, len(entries))
	for _, entry := range entries {
		if ip := net.ParseIP(entry); ip != nil {
			bits := 128
			if ip.To4() != nil {
				ip = ip.To4()
				bits = 32
			}
			networks = append(networks, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
			continue
		}
		_, network, err := net.ParseCIDR(entry)
		if err != nil {
			return err
		}
		networks = append(networks, network)
	}
	trustedProxyState.Lock()
	trustedProxyState.networks = networks
	trustedProxyState.Unlock()
	return nil
}

func isTrustedImmediateProxy(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(remoteAddr))
	if err != nil {
		host = strings.Trim(strings.TrimSpace(remoteAddr), "[]")
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	trustedProxyState.RLock()
	defer trustedProxyState.RUnlock()
	for _, network := range trustedProxyState.networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func ConfigureTrustedProxies(engine *gin.Engine) error {
	rawTrustedProxies := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if rawTrustedProxies == "" {
		log.Print("WARNING: TRUSTED_PROXIES is unset or blank; trusting loopback, RFC 1918, and IPv6 ULA proxy addresses for compatibility. Set TRUSTED_PROXIES=none to trust no proxies, or configure explicit proxy IPs/CIDRs to replace these defaults.")
		if err := engine.SetTrustedProxies(defaultTrustedProxyCIDRs); err != nil {
			return err
		}
		return updateTrustedProxyState(defaultTrustedProxyCIDRs)
	}
	if strings.EqualFold(rawTrustedProxies, "none") {
		if err := engine.SetTrustedProxies(nil); err != nil {
			return err
		}
		return updateTrustedProxyState(nil)
	}

	parts := strings.Split(rawTrustedProxies, ",")
	trustedProxies := make([]string, 0, len(parts))
	for _, part := range parts {
		trustedProxy := strings.TrimSpace(part)
		if trustedProxy == "" {
			continue
		}
		if strings.EqualFold(trustedProxy, "none") {
			return errors.New("TRUSTED_PROXIES=none must be used alone")
		}
		trustedProxies = append(trustedProxies, trustedProxy)
	}
	if len(trustedProxies) == 0 {
		return errors.New("TRUSTED_PROXIES does not contain an IP address or CIDR")
	}
	if err := engine.SetTrustedProxies(trustedProxies); err != nil {
		return fmt.Errorf("invalid TRUSTED_PROXIES: %w", err)
	}
	if err := updateTrustedProxyState(trustedProxies); err != nil {
		return fmt.Errorf("invalid TRUSTED_PROXIES: %w", err)
	}
	return nil
}
