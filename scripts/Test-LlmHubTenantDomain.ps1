[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$RootDomain,

  [string]$ProviderSlug,

  [int]$ExpectedProviderId,

  [string]$ExpectedVersion,

  [switch]$InfrastructureOnly,

  [switch]$SkipOriginTls
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetPath = Join-Path $scriptRoot 'llm-hub\production-target.json'
$target = Get-Content -Raw -LiteralPath $targetPath | ConvertFrom-Json

function Normalize-RootDomain {
  param([Parameter(Mandatory)][string]$Value)

  $domain = $Value.Trim().ToLowerInvariant()
  if ($domain.EndsWith('..')) {
    throw "RootDomain must not end with multiple dots: '$Value'."
  }
  $domain = $domain.TrimEnd('.')
  $labels = @($domain.Split('.'))
  if ($labels.Count -ne 2) {
    throw "RootDomain must contain exactly two DNS labels: '$Value'."
  }
  foreach ($label in $labels) {
    if ($label.Length -lt 1 -or $label.Length -gt 63 -or $label -notmatch '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$') {
      throw "RootDomain contains an invalid DNS label: '$Value'."
    }
  }
  if ($labels[1] -notmatch '[a-z]') {
    throw "RootDomain top-level label must contain an ASCII letter: '$Value'."
  }
  return $domain
}

function Assert-ProviderArguments {
  if ([string]::IsNullOrWhiteSpace($ProviderSlug) -and $ExpectedProviderId -ne 0) {
    throw 'ExpectedProviderId requires ProviderSlug.'
  }
  if (-not [string]::IsNullOrWhiteSpace($ProviderSlug) -and $ExpectedProviderId -le 0) {
    throw 'ProviderSlug requires a positive ExpectedProviderId.'
  }
  if ($InfrastructureOnly -and (-not [string]::IsNullOrWhiteSpace($ProviderSlug) -or $ExpectedProviderId -ne 0)) {
    throw 'InfrastructureOnly cannot be combined with provider route checks.'
  }
  if (-not [string]::IsNullOrWhiteSpace($ProviderSlug) -and ($ProviderSlug.Length -gt 63 -or $ProviderSlug -notmatch '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$')) {
    throw "ProviderSlug is invalid: '$ProviderSlug'."
  }
}

function Resolve-PublicHost {
  param([Parameter(Mandatory)][string]$Hostname)

  try {
    $addresses = @([System.Net.Dns]::GetHostAddresses($Hostname) | ForEach-Object { $_.IPAddressToString } | Sort-Object -Unique)
  } catch {
    throw "DNS resolution failed for '$Hostname': $($_.Exception.Message)"
  }
  if ($addresses.Count -eq 0) {
    throw "DNS resolution returned no address for '$Hostname'."
  }
  Write-Host "DNS_OK host=$Hostname addresses=$($addresses -join ',')"
}

function Get-PublicJson {
  param(
    [Parameter(Mandatory)][string]$Hostname,
    [Parameter(Mandatory)][string]$Path
  )

  $uri = "https://$Hostname$Path"
  try {
    $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 0
  } catch {
    throw "HTTPS request failed for '$uri': $($_.Exception.Message)"
  }
  if ([int]$response.StatusCode -ne 200) {
    throw "HTTPS request returned status $([int]$response.StatusCode) for '$uri'."
  }
  try {
    $payload = $response.Content | ConvertFrom-Json
  } catch {
    throw "Response was not valid JSON for '$uri'."
  }
  if (-not $payload.success) {
    throw "API reported failure for '$uri'."
  }
  Write-Host "HTTPS_OK uri=$uri status=200"
  return $payload
}

function Assert-OriginWildcardCertificate {
  param(
    [Parameter(Mandatory)][string]$Hostname,
    [Parameter(Mandatory)][string]$Domain
  )

  $command = "printf '' | openssl s_client -connect 127.0.0.1:443 -servername '$Hostname' 2>/dev/null | openssl x509 -noout -ext subjectAltName"
  $output = & ssh $target.sshTarget $command 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Caddy did not present an origin certificate for '$Hostname'."
  }
  $text = [string]($output -join "`n")
  $wildcard = [regex]::Escape("*.$Domain")
  $exactHost = [regex]::Escape($Hostname)
  if ($text -notmatch "DNS:$wildcard(?:,|\s|$)" -and $text -notmatch "DNS:$exactHost(?:,|\s|$)") {
    throw "Caddy origin certificate does not cover '*.$Domain'."
  }
  Write-Host "ORIGIN_TLS_OK host=$Hostname san=*.$Domain"
}

function Assert-TrustedSessionOrigin {
  param([Parameter(Mandatory)][string]$Domain)

  $origin = "https://$Domain"
  $command = "docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' '$($target.container)' | sed -n 's/^SESSION_COOKIE_TRUSTED_URL=//p' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -Fx '$origin' >/dev/null"
  & ssh $target.sshTarget $command
  if ($LASTEXITCODE -ne 0) {
    throw "Production container does not trust session origin '$origin'."
  }
  Write-Host "SESSION_ORIGIN_OK origin=$origin"
}

$root = Normalize-RootDomain -Value $RootDomain
Assert-ProviderArguments
$probeLabel = 'zz-tenant-check-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$probeHost = "$probeLabel.$root"

Resolve-PublicHost -Hostname $root
Resolve-PublicHost -Hostname $probeHost

$rootStatus = Get-PublicJson -Hostname $root -Path '/api/status'
$probeStatus = Get-PublicJson -Hostname $probeHost -Path '/api/status'
$rootVersion = [string]$rootStatus.data.version
$probeVersion = [string]$probeStatus.data.version
if ($rootVersion -eq '' -or $rootVersion -ne $probeVersion) {
  throw "Root and wildcard hosts returned different versions: root='$rootVersion', wildcard='$probeVersion'."
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion) -and $rootVersion -ne $ExpectedVersion) {
  throw "Expected version '$ExpectedVersion', got '$rootVersion'."
}
Write-Host "VERSION_OK version=$rootVersion"

if (-not $SkipOriginTls) {
  Assert-OriginWildcardCertificate -Hostname $probeHost -Domain $root
}
Assert-TrustedSessionOrigin -Domain $root

if ($InfrastructureOnly) {
  Write-Host "TENANT_INFRASTRUCTURE_OK root=$root version=$rootVersion"
  return
}

$brand = Get-PublicJson -Hostname $root -Path '/api/hub/public/brand'
if (-not $brand.data.is_tenant_host) {
  throw "Platform does not recognize '$root' as an active verified tenant domain."
}
$brandName = [string]$brand.data.brand.name
Write-Host "TENANT_BRAND_OK host=$root brand=$brandName"

if (-not [string]::IsNullOrWhiteSpace($ProviderSlug)) {
  $normalizedSlug = $ProviderSlug.Trim().ToLowerInvariant()
  $providerHost = "$normalizedSlug.$root"
  Resolve-PublicHost -Hostname $providerHost
  $provider = Get-PublicJson -Hostname $providerHost -Path "/api/hub/public/providers/$normalizedSlug"
  $actualProviderId = [int]$provider.data.provider.id
  $actualPublicUrl = [string]$provider.data.provider.public_url
  $expectedPublicUrl = "https://$providerHost/"
  if ($actualProviderId -ne $ExpectedProviderId) {
    throw "Provider route mismatch for '$providerHost': expected ID $ExpectedProviderId, got $actualProviderId."
  }
  if ($actualPublicUrl -ne $expectedPublicUrl) {
    throw "Provider public URL mismatch: expected '$expectedPublicUrl', got '$actualPublicUrl'."
  }
  Write-Host "PROVIDER_ROUTE_OK host=$providerHost provider_id=$actualProviderId public_url=$actualPublicUrl"
}

Write-Host "TENANT_DOMAIN_OK root=$root version=$rootVersion provider_checked=$(-not [string]::IsNullOrWhiteSpace($ProviderSlug))"
