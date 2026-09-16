# Install sn-cli at main (if needed) and put the Read-only CLI (`sn` -> src/cli.ts) on PATH.
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$HTTPS_REMOTE = "https://github.com/skylen15/sn-cli.git"
$SSH_REMOTE = "git@github.com:skylen15/sn-cli.git"
$BRANCH = "main"
$DEFAULT_DIR = Join-Path $HOME "sn-cli"

function Die {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

function Need {
    param([string]$CommandName)
    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        Die "missing ``$CommandName`` — please install Node.js, Git, and pnpm, then retry."
    }
}

Need "git"
Need "node"
Need "pnpm"

$DEST = if ($env:SN_INSTALL_DIR) { $env:SN_INSTALL_DIR } else { $DEFAULT_DIR }

if (Test-Path $DEST) {
    Set-Location $DEST
    $gitDir = git rev-parse --git-dir 2>$null
    if ($LASTEXITCODE -ne 0) {
        Die "not a git repo: $DEST (remove it, or set SN_INSTALL_DIR to an empty path to clone)."
    }

    $origin = (git remote get-url origin 2>$null).Trim()
    $status = git status --porcelain
    if ($status) {
        Die "working tree is dirty in $DEST — commit or stash, then retry."
    }

    if ($origin -eq $SSH_REMOTE) {
        git remote set-url origin $HTTPS_REMOTE
    } elseif ($origin -ne $HTTPS_REMOTE) {
        Die "origin remote is `"$origin`", expected $HTTPS_REMOTE"
    }

    git fetch --quiet origin $BRANCH
    git checkout --quiet $BRANCH
    git merge --ff-only --quiet "origin/$BRANCH"
} else {
    $parentDir = Split-Path -Parent $DEST
    if ($parentDir -and -not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }
    git clone --branch $BRANCH -- $HTTPS_REMOTE $DEST
    Set-Location $DEST
}

pnpm install
pnpm add --global .

if (-not (Get-Command "sn" -ErrorAction SilentlyContinue)) {
    $globalBin = (pnpm bin -g 2>$null)
    $binHint = if ($globalBin) { " (e.g. $globalBin)" } else { "" }
    Die "``sn`` is not on PATH after install. Add pnpm's global bin to PATH$binHint and open a new PowerShell window."
}

sn --help | Out-Null
$snPath = (Get-Command "sn").Source
Write-Host "sn ready: $snPath"
Write-Host "Next: sn auth add https://your-instance.service-now.com --alias dev"
