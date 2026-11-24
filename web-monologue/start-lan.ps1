param(
  [string]$LanAddress,
  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)
$ErrorActionPreference = 'Stop'
if (-not $LanAddress) {
  $addresses = @(Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Where-Object { $_ -and $_ -notmatch '^(127\.|169\.254\.)' } |
    Select-Object -Unique)
  if ($addresses.Count -ne 1) {
    throw 'LAN 주소를 하나로 결정할 수 없습니다. -LanAddress에 이 PC의 IPv4 주소를 지정하세요.'
  }
  $LanAddress = $addresses[0]
}
$localAddresses = @(Get-NetIPAddress -AddressFamily IPv4 | Select-Object -ExpandProperty IPAddress)
if ($LanAddress -notin $localAddresses -or $LanAddress -match '^(0\.|127\.|169\.254\.)') {
  throw 'LanAddress에는 이 PC에 할당된 LAN IPv4 주소를 지정하세요.'
}
$entry = Join-Path $PSScriptRoot 'dist/main.cjs'
if (-not (Test-Path -LiteralPath $entry)) {
  throw '웹앱 번들이 없습니다. web-monologue 폴더에서 npm run build를 먼저 실행하세요.'
}
$previous = @{}
foreach ($name in @('LISTEN_HOST', 'WEB_ALLOWED_HOSTS', 'PORT')) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  $env:LISTEN_HOST = '0.0.0.0'
  $env:WEB_ALLOWED_HOSTS = $LanAddress
  $env:PORT = [string]$Port
  & node $entry
  $serverExitCode = $LASTEXITCODE
} finally {
  foreach ($name in $previous.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
  }
}
exit $serverExitCode
