/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package model

// Registration source kinds are intentionally small and stable. They are
// analytics labels only; callers must not use them for access control,
// routing, billing, or invitation behavior.
const (
	RegistrationSourceTenantDirect   = "tenant_direct"
	RegistrationSourceProviderDomain = "provider_subdomain"
	RegistrationSourceUnknown        = "unknown"
)

// UserRegistrationSource is captured when a user account is first created.
// IDs are stored on User, while this value is also used in OAuth flow state so
// the original host remains authoritative through the callback.
type UserRegistrationSource struct {
	Kind       string `json:"kind,omitempty"`
	TenantID   int    `json:"tenant_id,omitempty"`
	ProviderID int    `json:"provider_id,omitempty"`
}

// ResolveUserRegistrationSource resolves a request host to the tenant or
// provider domain that originated a registration. Resolution is best effort:
// a failure must never block account creation because this data is only for
// administrative statistics.
//
// Provider hosts are checked before tenant hosts because ResolveTenantHost
// intentionally inherits a provider subdomain's tenant scope. Without this
// order every provider registration would be mislabeled as tenant-direct.
func ResolveUserRegistrationSource(host string) UserRegistrationSource {
	if providerResolution, err := ResolveHubProviderHost(host); err == nil &&
		providerResolution.IsProviderHost &&
		providerResolution.Provider.Status == HubProviderStatusActive {
		provider := providerResolution.Provider
		source := UserRegistrationSource{
			Kind:       RegistrationSourceProviderDomain,
			ProviderID: provider.Id,
		}
		if provider.TenantId != nil {
			// A provider in a disabled tenant is not a trusted registration
			// origin. Keep the source unknown rather than attributing it to a
			// tenant that is no longer active.
			if DB == nil {
				return UserRegistrationSource{Kind: RegistrationSourceUnknown}
			}
			if _, tenantErr := GetActiveTenantByID(*provider.TenantId); tenantErr != nil {
				return UserRegistrationSource{Kind: RegistrationSourceUnknown}
			}
			source.TenantID = *provider.TenantId
		}
		return source
	}

	if tenantResolution, err := ResolveTenantHost(host); err == nil &&
		tenantResolution.IsTenantHost && tenantResolution.TenantID > 0 {
		return UserRegistrationSource{
			Kind:     RegistrationSourceTenantDirect,
			TenantID: tenantResolution.TenantID,
		}
	}

	return UserRegistrationSource{Kind: RegistrationSourceUnknown}
}

func (user *User) SetRegistrationSource(source UserRegistrationSource) {
	if source.Kind == "" {
		source.Kind = RegistrationSourceUnknown
	}
	user.RegistrationSource = source.Kind
	user.RegistrationTenantId = source.TenantID
	user.RegistrationProviderId = source.ProviderID
}

// EnrichUserRegistrationSources fills display names for a user list in two
// bounded queries. Historical rows and installations that predate tenant
// tables remain valid and simply keep their IDs/names empty.
func EnrichUserRegistrationSources(users []*User) error {
	if len(users) == 0 || DB == nil {
		return nil
	}

	tenantIDs := make([]int, 0)
	providerIDs := make([]int, 0)
	tenantSeen := make(map[int]struct{})
	providerSeen := make(map[int]struct{})
	for _, user := range users {
		if user == nil {
			continue
		}
		if user.RegistrationTenantId > 0 {
			if _, ok := tenantSeen[user.RegistrationTenantId]; !ok {
				tenantSeen[user.RegistrationTenantId] = struct{}{}
				tenantIDs = append(tenantIDs, user.RegistrationTenantId)
			}
		}
		if user.RegistrationProviderId > 0 {
			if _, ok := providerSeen[user.RegistrationProviderId]; !ok {
				providerSeen[user.RegistrationProviderId] = struct{}{}
				providerIDs = append(providerIDs, user.RegistrationProviderId)
			}
		}
	}

	tenantNames := make(map[int]string, len(tenantIDs))
	if len(tenantIDs) > 0 && DB.Migrator().HasTable(&Tenant{}) {
		var tenants []Tenant
		if err := DB.Select("id", "name").Where("id IN ?", tenantIDs).Find(&tenants).Error; err != nil {
			return err
		}
		for _, tenant := range tenants {
			tenantNames[tenant.Id] = tenant.Name
		}
	}

	providerNames := make(map[int]string, len(providerIDs))
	if len(providerIDs) > 0 && DB.Migrator().HasTable(&HubProvider{}) {
		var providers []HubProvider
		if err := DB.Select("id", "name").Where("id IN ?", providerIDs).Find(&providers).Error; err != nil {
			return err
		}
		for _, provider := range providers {
			providerNames[provider.Id] = provider.Name
		}
	}

	for _, user := range users {
		if user == nil {
			continue
		}
		user.RegistrationTenantName = tenantNames[user.RegistrationTenantId]
		user.RegistrationProviderName = providerNames[user.RegistrationProviderId]
	}
	return nil
}
