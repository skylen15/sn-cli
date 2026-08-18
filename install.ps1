# install.ps1 - install the sn CLI from source in PowerShell
$ErrorActionPreference = "Stop"

$repo = "https://github.com/skylen15/sn-cli.git"
$destination = if ($env:SN_CLI_DIR) { $env:SN_CLI_DIR } else { Join-Path $HOME ".sn-cli" }

function Get-Executable([string[]] $names) {
  foreach ($name in $names) {
    $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($command) { return $command.Source }
  }
  return $null
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nodeCommand) { $node = $nodeCommand.Name } else { $node = $null }
if (-not $node) {
  throw "node not found in PowerShell's PATH. Restart PowerShell after installing Node.js 24+ or add its install directory to PATH."
}

$nodeVersion = & $node --version
$nodeMajor = [int]((& $node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 24) {
  throw "Node.js 24+ required (found $nodeVersion)."
}

$pnpm = Get-Executable @("pnpm.cmd", "pnpm.exe", "pnpm")
if (-not $pnpm) {
  $npm = Get-Executable @("npm.cmd", "npm.exe", "npm")
  if (-not $npm) { throw "npm not found in PowerShell's PATH. It should be installed with Node.js." }
  Write-Host "pnpm not found - installing pnpm@11.20.0..."
  & $npm install -g pnpm@11.20.0
  if ($LASTEXITCODE -ne 0) { throw "pnpm installation failed" }
  $pnpm = Get-Executable @("pnpm.cmd", "pnpm.exe", "pnpm")
}
if (-not $pnpm) {
  throw "pnpm installation completed but pnpm is not in PowerShell's PATH. Restart PowerShell and run this script again."
}

$git = Get-Executable @("git.exe", "git")
if (-not $git) {
  throw "git not found in PowerShell's PATH. Install Git from https://git-scm.com and restart PowerShell."
}

if (Test-Path -LiteralPath (Join-Path $destination ".git")) {
  Write-Host "Updating existing clone at $destination..."
  & $git -C $destination pull --ff-only
} else {
  Write-Host "Cloning sn-cli into $destination..."
  & $git clone $repo $destination
}
if ($LASTEXITCODE -ne 0) { throw "git operation failed" }

Push-Location $destination
try {
  & $pnpm add --global .
  if ($LASTEXITCODE -ne 0) { throw "pnpm installation failed" }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "sn installed successfully."
Write-Host ""
Write-Host "Next: authenticate with your ServiceNow instance."
Write-Host "  Set-Location '$destination'; pnpm now-sdk:auth"
Write-Host ""
Write-Host "Or create a .env file using .env.example as a template."
