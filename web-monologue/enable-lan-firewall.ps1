[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)]
  [System.Net.IPAddress]$LanAddress,
  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)
$ErrorActionPreference = 'Stop'
$address = $LanAddress.IPAddressToString
if ($LanAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
    $address -match '^(0\.|127\.|169\.254\.)' -or
    -not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $address -ErrorAction SilentlyContinue)) {
  throw 'LanAddress에는 이 PC에 할당된 LAN IPv4 주소를 지정하세요.'
}
$ruleName = 'IyagiMonologue-LAN-' + $address.Replace('.', '-') + '-' + $Port
if ($PSCmdlet.ShouldProcess("$address TCP $Port / LocalSubnet", 'LAN 웹앱 방화벽 허용')) {
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Windows 관리자 권한으로 PowerShell을 열고 다시 실행하세요.'
  }
  $rule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
  if ($rule) {
    $rule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any
    $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -LocalAddress $address -RemoteAddress LocalSubnet
    $rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port -RemotePort Any
  } else {
    New-NetFirewallRule -Name $ruleName -DisplayName "이야기 혼잣말 LAN $address`:$Port" `
      -Direction Inbound -Action Allow -Enabled True -Protocol TCP -LocalPort $Port `
      -LocalAddress $address -RemoteAddress LocalSubnet -Profile Any | Out-Null
  }
  Write-Output "LAN 접속 허용: http://$address`:$Port (같은 서브넷만 허용)"
}
