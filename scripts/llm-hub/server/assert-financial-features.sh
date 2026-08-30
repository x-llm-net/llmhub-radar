#!/bin/sh
set -eu

source_dir="${1:?source directory is required}"

contains() {
  file="$1"
  text="$2"
  test -f "$source_dir/$file"
  grep -Fq -- "$text" "$source_dir/$file"
}

contains model/tenant.go 'PlatformFeeBasisPoints *int'
contains model/hub_tenant_settlement_settings.go 'func ResolveHubTenantPlatformFeeBasisPoints'
contains model/hub_tenant_settlement_settings.go 'func UpdateHubTenantPlatformFeeBasisPoints'
contains model/hub_provider_settlement.go 'ResolveHubTenantPlatformFeeBasisPoints(tenantId)'
contains model/hub_provider_settlement.go '"platform_fee_basis_points":'
contains model/hub_supply_pricing.go 'TenantPlatformFeeBasisPoints'
contains model/hub_supply_pricing.go 'tenants.platform_fee_basis_points'
contains relay/helper/price.go 'pricing.TenantPlatformFeeBasisPoints'
contains model/hub_tenant_settlement.go 'resolveHubTenantPlatformFeeBasisPoints(tx, tenantID)'
contains controller/hub_tenant_admin.go 'func AdminUpdateHubTenantSettlementSettings'
contains router/api-router.go '"/:id/settlement-settings"'
contains model/hub_tenant_settlement_test.go 'TestPrepareHubProviderEarningUsesTenantPlatformFee'

printf 'FINANCIAL_FEATURES_OK source=%s\n' "$source_dir"
