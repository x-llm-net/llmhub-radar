/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
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

import "github.com/QuantumNous/new-api/common"

const (
	HubBusinessContactNameOption        = "HubBusinessContactName"
	HubBusinessContactTypeOption        = "HubBusinessContactType"
	HubBusinessContactValueOption       = "HubBusinessContactValue"
	HubBusinessContactDescriptionOption = "HubBusinessContactDescription"
)

type BusinessContact struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Value       string `json:"value"`
	Description string `json:"description"`
}

type TenantBrandConfig struct {
	Name            string          `json:"name"`
	LogoURL         string          `json:"logo_url"`
	BusinessContact BusinessContact `json:"business_contact"`
}

func (tenant Tenant) Brand() TenantBrandConfig {
	var brand TenantBrandConfig
	if tenant.BrandConfig == "" {
		return brand
	}
	if err := common.UnmarshalJsonStr(tenant.BrandConfig, &brand); err != nil {
		return TenantBrandConfig{}
	}
	return brand
}

func EncodeTenantBrandConfig(brand TenantBrandConfig) (string, error) {
	data, err := common.Marshal(brand)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
