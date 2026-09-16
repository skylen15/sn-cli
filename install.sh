#!/usr/bin/env bash
# Install sn-cli at main (if needed) and put the Read-only CLI (`sn` → src/cli.ts) on PATH.
set -euo pipefail

readonly HTTPS_REMOTE="https://github.com/skylen15/sn-cli.git"
readonly SSH_REMOTE="git@github.com:skylen15/sn-cli.git"
readonly BRANCH="main"
readonly DEFAULT_DIR="${HOME}/sn-cli"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 ||
    die "missing \`$1\` — set up Node, Git, and pnpm via go/devconfig, then retry."
}

need git
need node
need pnpm

DEST="${SN_INSTALL_DIR:-$DEFAULT_DIR}"

if [[ -e "$DEST" ]]; then
  cd "$DEST"
  git rev-parse --git-dir >/dev/null 2>&1 ||
    die "not a git repo: $DEST (remove it, or set SN_INSTALL_DIR to an empty path to clone)."

  origin="$(git remote get-url origin 2>/dev/null || true)"
  [[ -z "$(git status --porcelain)" ]] ||
    die "working tree is dirty in $DEST — commit or stash, then retry."

  case "$origin" in
    "$SSH_REMOTE") git remote set-url origin "$HTTPS_REMOTE" ;;
    "$HTTPS_REMOTE") ;;
    *) die "origin remote is \"$origin\", expected $HTTPS_REMOTE" ;;
  esac

  git fetch --quiet origin "$BRANCH"
  git checkout --quiet "$BRANCH"
  git merge --ff-only --quiet "origin/$BRANCH"
else
  mkdir -p "$(dirname "$DEST")"
  git clone --branch "$BRANCH" -- "$HTTPS_REMOTE" "$DEST"
  cd "$DEST"
fi

pnpm install
pnpm add --global .

if ! command -v sn >/dev/null 2>&1; then
  global_bin="$(pnpm bin -g 2>/dev/null || true)"
  die "\`sn\` is not on PATH after install. Add pnpm's global bin to PATH${global_bin:+ (e.g. $global_bin)} and open a new shell."
fi

sn --help >/dev/null
printf 'sn ready: %s\n' "$(command -v sn)"
printf 'Next: sn auth add https://your-instance.service-now.com --alias dev\n'
