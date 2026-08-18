#!/usr/bin/env bash
# install.sh — install the sn CLI from source
set -euo pipefail

REPO="https://github.com/skylen15/sn-cli.git"
DEST="${SN_CLI_DIR:-$HOME/.sn-cli}"

die() {
  echo "error: $*" >&2
  exit 1
}

# Git Bash can inherit a stale PATH from a parent process. Resolve Node once,
# then use that path for every check so the diagnostic matches the command run.
NODE_COMMAND="$(command -v node 2>/dev/null || command -v node.exe 2>/dev/null || true)"
if [ -z "$NODE_COMMAND" ]; then
  die "node not found in this shell's PATH. Restart Git Bash after installing Node.js 24+ or add its install directory to PATH."
fi

# ── prerequisites ────────────────────────────────────────────────────────────

NODE_VERSION_OUTPUT=$("$NODE_COMMAND" --version 2>&1) || die "could not run $NODE_COMMAND: $NODE_VERSION_OUTPUT"
NODE_MAJOR=$("$NODE_COMMAND" -e 'process.stdout.write(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "error: Node.js 24+ required (found $NODE_MAJOR)." >&2
  exit 1
fi

PNPM_COMMAND="$(command -v pnpm 2>/dev/null || command -v pnpm.cmd 2>/dev/null || true)"
if [ -z "$PNPM_COMMAND" ]; then
  echo "pnpm not found — installing pnpm@11.20.0..."
  NPM_COMMAND="$(command -v npm 2>/dev/null || command -v npm.cmd 2>/dev/null || true)"
  [ -n "$NPM_COMMAND" ] || die "npm not found in this shell's PATH. It should be installed with Node.js."
  "$NPM_COMMAND" install -g pnpm@11.20.0
  PNPM_COMMAND="$(command -v pnpm 2>/dev/null || command -v pnpm.cmd 2>/dev/null || true)"
fi
[ -n "$PNPM_COMMAND" ] || die "pnpm installation completed but pnpm is not in this shell's PATH. Restart Git Bash and run this script again."

GIT_COMMAND="$(command -v git 2>/dev/null || command -v git.exe 2>/dev/null || true)"
[ -n "$GIT_COMMAND" ] || die "git not found in this shell's PATH. Install Git from https://git-scm.com and restart this shell."

# ── clone or update ──────────────────────────────────────────────────────────

if [ -d "$DEST/.git" ]; then
  echo "Updating existing clone at $DEST..."
  "$GIT_COMMAND" -C "$DEST" pull --ff-only
else
  echo "Cloning sn-cli into $DEST..."
  "$GIT_COMMAND" clone "$REPO" "$DEST"
fi

# ── install ──────────────────────────────────────────────────────────────────

cd "$DEST"
"$PNPM_COMMAND" add --global .

# ── done ─────────────────────────────────────────────────────────────────────

echo ""
echo "sn installed successfully."
echo ""
echo "Next: authenticate with your ServiceNow instance."
echo "  cd $DEST && pnpm now-sdk:auth"
echo ""
echo "Or create a .env file using .env.example as a template."
