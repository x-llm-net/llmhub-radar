[CmdletBinding()]
param(
  [ValidateSet('Preflight', 'Prepare', 'Deploy', 'Verify', 'Rollback')]
  [string]$Action = 'Preflight',

  [string]$Commit = 'HEAD',

  [string]$ReleaseTag,

  [switch]$ConfirmProductionSwitch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptRoot '..')).Path
$targetPath = Join-Path $scriptRoot 'llm-hub\production-target.json'
$sourcePath = Join-Path $scriptRoot 'llm-hub\production-source.json'
$serverScriptDir = Join-Path $scriptRoot 'llm-hub\server'
$target = Get-Content -Raw -LiteralPath $targetPath | ConvertFrom-Json
$source = Get-Content -Raw -LiteralPath $sourcePath | ConvertFrom-Json

function Assert-TargetManifest {
  $expected = [ordered]@{
    deploymentId = 'llm-hub-store-production-v2'
    sshTarget = 'llm-hub'
    remoteHostname = 'llm-hub'
    remoteAddress = '159.195.18.119'
    composeDir = '/opt/llm-hub'
    composeFile = '/opt/llm-hub/compose.yml'
    composeProject = 'llm-hub'
    service = 'new-api'
    container = 'llm-hub-new-api'
    imageRepository = 'llm-hub/new-api'
    publicBaseUrl = 'https://llm-hub.store'
  }

  foreach ($entry in $expected.GetEnumerator()) {
    if ([string]$target.($entry.Key) -ne $entry.Value) {
      throw "Production target manifest mismatch for $($entry.Key). Expected '$($entry.Value)'."
    }
  }

  $expectedHealthUrls = @(
    'https://llm-hub.store',
    'https://app.llm-hub.store',
    'https://edge.llm-hub.store',
    'https://zz-infra-check.llm-hub.store',
    'https://343246113.xyz'
  )
  if ((@($target.publicHealthUrls) -join '|') -ne ($expectedHealthUrls -join '|')) {
    throw 'Production public health URL manifest mismatch.'
  }
}

function Assert-ProductionSource {
  $expected = [ordered]@{
    sourceId = 'llm-hub-store-production-v2'
    repository = 'x-llm-net/llmhub-radar'
    releaseTarget = 'llm-hub'
    releaseScript = 'scripts/Release-LlmHub.ps1'
  }

  foreach ($entry in $expected.GetEnumerator()) {
    if ([string]$source.($entry.Key) -ne $entry.Value) {
      throw "Production source marker mismatch for $($entry.Key). Expected '$($entry.Value)'."
    }
  }
}

function Invoke-Git {
  param([Parameter(Mandatory)][string[]]$Arguments)

  $output = & git -C $repoRoot @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed:`n$($output -join "`n")"
  }
  return [string]($output -join "`n")
}

function Invoke-Ssh {
  param([Parameter(Mandatory)][string]$Command)

  # Docker writes normal build progress to stderr. Treat the ssh exit code as
  # authoritative so PowerShell does not stop on a successful remote build.
  $previousErrorActionPreference = $ErrorActionPreference
  $exitCode = 0
  try {
    $ErrorActionPreference = 'Continue'
    $output = & ssh $target.sshTarget $Command 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "Remote command failed on the LLM-Hub target:`n$($output -join "`n")"
  }
  return [string]($output -join "`n")
}

function Copy-ToRemote {
  param(
    [Parameter(Mandatory)][string]$LocalPath,
    [Parameter(Mandatory)][string]$RemotePath
  )

  $output = & scp $LocalPath "$($target.sshTarget):$RemotePath" 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to copy '$LocalPath' to the LLM-Hub target:`n$($output -join "`n")"
  }
}

function Assert-LocalIdentity {
  $actualRoot = (Invoke-Git -Arguments @('rev-parse', '--show-toplevel')).Trim()
  if ((Resolve-Path $actualRoot).Path -ne $repoRoot) {
    throw "Release script must run from the llmhub-radar repository. Actual root: $actualRoot"
  }

  $origin = (Invoke-Git -Arguments @('remote', 'get-url', 'origin')).Trim()
  if ($target.gitRemotes -notcontains $origin) {
    throw "Unexpected origin '$origin'. LLM-Hub production only accepts x-llm-net/llmhub-radar."
  }

  $trackedChanges = (Invoke-Git -Arguments @('status', '--porcelain', '--untracked-files=no')).Trim()
  if ($trackedChanges) {
    throw "Tracked files are not clean. Commit the intended release before preparing production:`n$trackedChanges"
  }

  $commitExpression = $Commit + '^{commit}'
  return (Invoke-Git -Arguments @('rev-parse', $commitExpression)).Trim()
}

function Assert-ReleaseTag {
  param([Parameter(Mandatory)][string]$CommitSha)

  if ([string]::IsNullOrWhiteSpace($ReleaseTag)) {
    throw 'ReleaseTag is required for Prepare, Deploy, Verify, and Rollback.'
  }
  if ($ReleaseTag -notmatch '^llmhub-([0-9a-f]{7,12})-[0-9]{8}-[0-9]+$') {
    throw "Invalid ReleaseTag '$ReleaseTag'. Expected llmhub-<commit>-<YYYYMMDD>-<sequence>."
  }
  if (-not $CommitSha.StartsWith($Matches[1], [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "ReleaseTag '$ReleaseTag' does not match commit $CommitSha."
  }

  & git -C $repoRoot show-ref --verify --quiet "refs/tags/$ReleaseTag"
  if ($LASTEXITCODE -eq 0) {
    throw "ReleaseTag '$ReleaseTag' already exists as a Git tag. LLM-Hub release versions must only be local Docker image tags."
  }
  if ($LASTEXITCODE -ne 1) {
    throw "Unable to verify whether '$ReleaseTag' exists as a Git tag."
  }
}

function Assert-RemoteIdentity {
  $probeCommand = 'set -- $SSH_CONNECTION; printf ''host=%s deployment=%s remote=%s\n'' "$(hostname)" "$(cat /opt/llm-hub/.deployment-id 2>/dev/null)" "$3"'
  $probe = Invoke-Ssh -Command $probeCommand
  $expectedProbe = "host=$($target.remoteHostname) deployment=$($target.deploymentId) remote=$($target.remoteAddress)"
  if ($probe.Trim() -ne $expectedProbe) {
    throw "SSH target identity mismatch. Expected '$expectedProbe', got '$($probe.Trim())'."
  }

  $localScript = Join-Path $serverScriptDir 'assert-target.sh'
  $remoteScript = '/tmp/llm-hub-assert-target.sh'
  Copy-ToRemote -LocalPath $localScript -RemotePath $remoteScript
  $result = Invoke-Ssh -Command "chmod 700 $remoteScript && $remoteScript"
  if ($result -notmatch 'TARGET_OK deployment=llm-hub-store-production-v2') {
    throw "Remote target did not return the expected LLM-Hub identity:`n$result"
  }
  Write-Host $result
}

function Get-CommittedInfrastructureHashes {
  param([Parameter(Mandatory)][string]$CommitSha)

  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "llm-hub-infra-$PID-$([guid]::NewGuid().ToString('N'))"
  $archive = Join-Path $tempDir 'infrastructure.tar'
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
  try {
    Invoke-Git -Arguments @(
      'archive',
      '--format=tar',
      "--output=$archive",
      $CommitSha,
      '--',
      'scripts/llm-hub/production/compose.yml',
      'scripts/llm-hub/caddy/Caddyfile'
    ) | Out-Null
    $extractOutput = & tar -xf $archive -C $tempDir 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to extract committed infrastructure files:`n$($extractOutput -join "`n")"
    }

    return [pscustomobject]@{
      Compose = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $tempDir 'scripts\llm-hub\production\compose.yml')).Hash.ToLowerInvariant()
      Caddy = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $tempDir 'scripts\llm-hub\caddy\Caddyfile')).Hash.ToLowerInvariant()
    }
  } finally {
    if (Test-Path -LiteralPath $tempDir) {
      [System.IO.Directory]::Delete($tempDir, $true)
    }
  }
}

function Assert-RemoteInfrastructure {
  param([Parameter(Mandatory)][string]$CommitSha)

  $committed = Get-CommittedInfrastructureHashes -CommitSha $CommitSha
  $remote = Invoke-Ssh -Command 'sha256sum /opt/llm-hub/compose.yml /opt/llm-hub/Caddyfile'
  $remoteComposeMatch = [regex]::Match($remote, '(?m)^([0-9a-f]{64})\s+/opt/llm-hub/compose\.yml$')
  $remoteCaddyMatch = [regex]::Match($remote, '(?m)^([0-9a-f]{64})\s+/opt/llm-hub/Caddyfile$')
  if (-not $remoteComposeMatch.Success -or $remoteComposeMatch.Groups[1].Value -ne $committed.Compose) {
    throw "Remote production compose does not match commit $CommitSha."
  }
  if (-not $remoteCaddyMatch.Success -or $remoteCaddyMatch.Groups[1].Value -ne $committed.Caddy) {
    throw "Remote production Caddyfile does not match commit $CommitSha."
  }
  Write-Host "INFRASTRUCTURE_OK commit=$CommitSha compose=$($committed.Compose) caddy=$($committed.Caddy)"
}

function Test-PublicStatus {
  param([string]$ExpectedVersion)

  foreach ($baseUrl in @($target.publicHealthUrls)) {
    $statusRequest = @{
      Uri = "$baseUrl/api/status"
      Method = 'Get'
      TimeoutSec = 30
    }
    if ($baseUrl -eq 'https://edge.llm-hub.store') {
      # The fixed CNAME target is an infrastructure alias. It intentionally
      # uses the origin certificate and is not a user-facing HTTPS origin.
      $statusRequest.SkipCertificateCheck = $true
    }
    $status = Invoke-RestMethod @statusRequest
    if (-not $status.success) {
      throw "Public /api/status did not report success for '$baseUrl'."
    }
    if ($ExpectedVersion -and [string]$status.data.version -ne $ExpectedVersion) {
      throw "Public version mismatch for '$baseUrl'. Expected '$ExpectedVersion', got '$($status.data.version)'."
    }
  }

  foreach ($path in @('/', '/provider/onboarding', '/providers')) {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$($target.publicBaseUrl)$path" -Method Get -TimeoutSec 30 -MaximumRedirection 5
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
      throw "Public page '$path' returned HTTP $($response.StatusCode)."
    }
  }

  Write-Host "PUBLIC_OK urls=$(@($target.publicHealthUrls) -join ',') version=$ExpectedVersion"
}

function Get-RemoteVersion {
  return (Invoke-Ssh -Command "docker exec $($target.container) /new-api --version").Trim()
}

function Assert-RemoteProviderSlugRollbackCompatible {
  param([Parameter(Mandatory)][string]$BackupDir)

  $oldImage = (Invoke-Ssh -Command "test -f $BackupDir/release.txt && sed -n 's/^current_ref=//p' $BackupDir/release.txt").Trim()
  if ($oldImage -notmatch '^llm-hub/new-api:[a-zA-Z0-9._-]+$') {
    throw "Unexpected rollback target image '$oldImage'."
  }

  # This unversioned orchestration guard also protects historical release
  # directories whose immutable rollback tools predate tenant-scoped slugs.
  $localScript = Join-Path $serverScriptDir 'assert-provider-slug-rollback-compatible.sh'
  $remoteScript = "/tmp/llm-hub-provider-slug-rollback-$PID.sh"
  Copy-ToRemote -LocalPath $localScript -RemotePath $remoteScript
  $result = Invoke-Ssh -Command "chmod 700 $remoteScript && $remoteScript $oldImage"
  if ($result -notmatch 'ROLLBACK_COMPATIBLE') {
    throw "Rollback compatibility check returned an unexpected result:`n$result"
  }
  Write-Host $result
}

function Copy-VersionedServerScripts {
  param(
    [Parameter(Mandatory)][string]$ReleaseDir,
    [Parameter(Mandatory)][string]$LocalServerScriptDir
  )

  $remoteTools = "$ReleaseDir/tools"
  Invoke-Ssh -Command "mkdir -p $remoteTools" | Out-Null
  foreach ($file in Get-ChildItem -LiteralPath $LocalServerScriptDir -Filter '*.sh' -File) {
    Copy-ToRemote -LocalPath $file.FullName -RemotePath "$remoteTools/$($file.Name)"
  }
  Invoke-Ssh -Command "chmod 700 $remoteTools/*.sh" | Out-Null
}

function Assert-VersionedServerScripts {
  param([Parameter(Mandatory)][string]$ReleaseDir)

  Write-Host (Invoke-Ssh -Command "$ReleaseDir/tools/assert-release-tools.sh $ReleaseTag")
}

Assert-TargetManifest
Assert-ProductionSource
$commitSha = Assert-LocalIdentity
Assert-RemoteIdentity
Assert-RemoteInfrastructure -CommitSha $commitSha

if ($Action -eq 'Preflight') {
  $currentVersion = Get-RemoteVersion
  Test-PublicStatus -ExpectedVersion $currentVersion
  Write-Host "PREFLIGHT_OK commit=$commitSha target=$($target.deploymentId)"
  exit 0
}

Assert-ReleaseTag -CommitSha $commitSha
$releaseDir = "$($target.composeDir)/releases/$ReleaseTag"
$backupDir = "$($target.composeDir)/backups/pre-$ReleaseTag"

switch ($Action) {
  'Prepare' {
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "llm-hub-release\$ReleaseTag-$PID"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $archive = Join-Path $tempDir 'source.tar'

    $archiveOutput = & git -C $repoRoot archive --format=tar --output=$archive $commitSha 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "git archive failed:`n$($archiveOutput -join "`n")"
    }
    $localHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
    $extractOutput = & tar -xf $archive -C $tempDir scripts/llm-hub/server 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to extract versioned release tools:`n$($extractOutput -join "`n")"
    }
    $committedServerScriptDir = Join-Path $tempDir 'scripts\llm-hub\server'

    $remoteHash = (Invoke-Ssh -Command "if test -f $releaseDir/source.tar; then sha256sum $releaseDir/source.tar | cut -d' ' -f1; fi").Trim()
    if ($remoteHash) {
      if ($remoteHash -ne $localHash) {
        throw "Immutable release '$ReleaseTag' already exists with a different source archive."
      }
    } else {
      Invoke-Ssh -Command "mkdir -p $releaseDir" | Out-Null
      Copy-ToRemote -LocalPath $archive -RemotePath "$releaseDir/source.tar"
      $remoteHash = (Invoke-Ssh -Command "sha256sum $releaseDir/source.tar | cut -d' ' -f1").Trim()
      if ($remoteHash -ne $localHash) {
        throw 'Uploaded release archive checksum mismatch.'
      }
    }

    Invoke-Ssh -Command "cd $releaseDir && printf '%s  source.tar\n' $localHash > source.tar.sha256" | Out-Null
    Copy-VersionedServerScripts -ReleaseDir $releaseDir -LocalServerScriptDir $committedServerScriptDir
    Write-Host (Invoke-Ssh -Command "$releaseDir/tools/build-release.sh $ReleaseTag")
    Assert-VersionedServerScripts -ReleaseDir $releaseDir
    Write-Host (Invoke-Ssh -Command "$releaseDir/tools/preflight-image.sh $ReleaseTag")
    Write-Host (Invoke-Ssh -Command "$releaseDir/tools/preflight-mysql.sh $ReleaseTag")
    Write-Host "PREPARE_OK release=$ReleaseTag commit=$commitSha sha256=$localHash"
  }

  'Deploy' {
    if (-not $ConfirmProductionSwitch) {
      throw 'Production switch blocked. Obtain explicit user confirmation, then rerun with -ConfirmProductionSwitch.'
    }

    Assert-VersionedServerScripts -ReleaseDir $releaseDir
    Invoke-Ssh -Command "docker image inspect $($target.imageRepository):$ReleaseTag >/dev/null" | Out-Null
    $backupState = (Invoke-Ssh -Command "if test -f $backupDir/release.txt; then echo exists; else echo missing; fi").Trim()
    if ($backupState -eq 'missing') {
      Write-Host (Invoke-Ssh -Command "$releaseDir/tools/backup-release.sh $ReleaseTag")
    } elseif ($backupState -ne 'exists') {
      throw "Unexpected backup state: $backupState"
    }

    Assert-RemoteProviderSlugRollbackCompatible -BackupDir $backupDir

    try {
      Write-Host (Invoke-Ssh -Command "$releaseDir/tools/deploy-release.sh $ReleaseTag")
      Write-Host (Invoke-Ssh -Command "$releaseDir/tools/verify-release.sh $ReleaseTag")
      Test-PublicStatus -ExpectedVersion $ReleaseTag
    } catch {
      $deploymentFailure = $_
      try {
        Write-Warning 'Deployment verification failed; restoring the previous production release.'
        Assert-RemoteProviderSlugRollbackCompatible -BackupDir $backupDir
        Write-Host (Invoke-Ssh -Command "$releaseDir/tools/rollback-release.sh $ReleaseTag")
        $rollbackVersion = Get-RemoteVersion
        Test-PublicStatus -ExpectedVersion $rollbackVersion
      } catch {
        throw "Deployment failed: $deploymentFailure`nAutomatic rollback also failed: $_"
      }
      throw "Deployment failed and the previous release was restored: $deploymentFailure"
    }
    Write-Host "DEPLOY_COMPLETE release=$ReleaseTag"
  }

  'Verify' {
    Assert-VersionedServerScripts -ReleaseDir $releaseDir
    Write-Host (Invoke-Ssh -Command "$releaseDir/tools/verify-release.sh $ReleaseTag")
    Test-PublicStatus -ExpectedVersion $ReleaseTag
    Write-Host "VERIFY_OK release=$ReleaseTag"
  }

  'Rollback' {
    if (-not $ConfirmProductionSwitch) {
      throw 'Production rollback blocked. Obtain explicit user confirmation, then rerun with -ConfirmProductionSwitch.'
    }

    Assert-VersionedServerScripts -ReleaseDir $releaseDir
    Assert-RemoteProviderSlugRollbackCompatible -BackupDir $backupDir
    Write-Host (Invoke-Ssh -Command "$releaseDir/tools/rollback-release.sh $ReleaseTag")
    $rollbackVersion = Get-RemoteVersion
    Test-PublicStatus -ExpectedVersion $rollbackVersion
    Write-Host "ROLLBACK_COMPLETE release=$ReleaseTag"
  }
}
