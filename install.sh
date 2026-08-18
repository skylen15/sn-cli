#!/usr/bin/env bash
# install.sh — install the sn CLI from source
set -euo pipefail

REPO="https://github.com/skylen15/sn-cli.git"
DEST="${SN_CLI_DIR:-$HOME/.sn-cli}"

# ── prerequisites ────────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "error: node not found. Install Node.js 24 or later from https://nodejs.org" >&2
  exit 1
fi

NODE_MAJOR=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "error: Node.js 24+ required (found $NODE_MAJOR)." >&2
  exit 1
fi

if ! command -v pnpm &>/dev/null; then
  echo "pnpm not found — installing pnpm@11.20.0..."
  npm install -g pnpm@11.20.0
fi

# ── clone or update ──────────────────────────────────────────────────────────

if [ -d "$DEST/.git" ]; then
  echo "Updating existing clone at $DEST..."
  git -C "$DEST" pull --ff-only
else
  echo "Cloning sn-cli into $DEST..."
  git clone "$REPO" "$DEST"
fi

# ── install ──────────────────────────────────────────────────────────────────

cd "$DEST"
pnpm add --global .

# ── done ─────────────────────────────────────────────────────────────────────

echo ""
echo "sn installed successfully."
echo ""
echo "Next: authenticate with your ServiceNow instance."
echo "  cd $DEST && pnpm now-sdk:auth"
echo ""
echo "Or create a .env file using .env.example as a template."
