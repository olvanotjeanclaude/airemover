#!/usr/bin/env bash
# Deploy for airemover — a standalone app, not part of the Varotranaka stack.
#
# It shares the VPS (and the `deploy` user's PM2 daemon) with the varotranaka
# apps, but it has its own repo, its own checkout, its own PM2 entry and its own
# port. Nothing here touches backend/deploy.sh or that workspace.
#
# What it does:
#   1. Pulls the repo (skip with --no-pull)
#   2. Skips `npm install` when package-lock.json is unchanged
#   3. Skips the rebuild when HEAD didn't move (override with --force)
#   4. Builds, then copies public/ + .next/static next to standalone/server.js
#   5. Reloads the PM2 app and waits for the port to answer
#
# Usage (on the VPS):
#   bash /home/olvanot/airemover/deploy.sh
#   bash /home/olvanot/airemover/deploy.sh --force     # rebuild even if HEAD is unchanged
#   bash /home/olvanot/airemover/deploy.sh --no-pull   # deploy the working tree as-is

set -euo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SELF")" && pwd)"
cd "$ROOT"

# Nothing can answer a credential prompt over SSH; fail instead of hanging.
export GIT_TERMINAL_PROMPT=0

# The live PM2 daemon belongs to `deploy`. Root has its own, and it is empty —
# reloading against it would START a second copy on port 3011 instead of
# reloading the running one, leaving two processes fighting for the port.
export PM2_HOME="${PM2_HOME:-/home/deploy/.pm2}"

APP_NAME="airemover"
PORT=3011
STATE_FILE="$ROOT/.git/airemover-deploy-state"
LOCK_FILE="$ROOT/.deploy.lock"

FORCE=0
NO_PULL=0
for arg in "$@"; do
  case "$arg" in
    --force)   FORCE=1 ;;
    --no-pull) NO_PULL=1 ;;
    -h|--help) sed -n '2,/^$/p' "$SELF"; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf "\n\033[1;36m==>\033[0m \033[1m%s\033[0m\n" "$*"; }
info() { printf "    \033[2m%s\033[0m\n" "$*"; }
warn() { printf "    \033[33m! %s\033[0m\n" "$*"; }
die()  { printf "\n\033[31mFAILED: %s\033[0m\n" "$*" >&2; exit 1; }

MISSING=()
for tool in git node npm pm2 curl; do
  command -v "$tool" >/dev/null 2>&1 || MISSING+=("$tool")
done
[ "${#MISSING[@]}" -eq 0 ] || die "missing command(s): ${MISSING[*]} (PATH=$PATH)"

# Two pushes a minute apart must not build into the same .next at once.
if [ -z "${AIREMOVER_DEPLOY_LOCKED:-}" ] && command -v flock >/dev/null 2>&1; then
  [ -e "$LOCK_FILE" ] || { : > "$LOCK_FILE"; chmod 0666 "$LOCK_FILE" 2>/dev/null || true; }
  export AIREMOVER_DEPLOY_LOCKED=1
  exec flock --timeout 900 "$LOCK_FILE" bash "$SELF" "$@"
fi

# ---------- 1. Pull ----------
if [ "$NO_PULL" -eq 1 ]; then
  info "skipping git pull (--no-pull)"
else
  log "Pulling $APP_NAME"
  # `npm install` below rewrites package-lock.json in place, leaving the tracked
  # file dirty here. git pull --ff-only then refuses as soon as an incoming
  # commit touches that lockfile, aborting on a file nobody edited on purpose.
  # The lockfile in git is the source of truth, never npm's local rewrite.
  git checkout -- package-lock.json 2>/dev/null || true
  git pull --ff-only 2>&1 | sed 's/^/    /'
fi

HEAD_SHA="$(git rev-parse HEAD)"
PREV_SHA="$(cat "$STATE_FILE" 2>/dev/null || echo "")"

# ---------- 2. Dependencies ----------
# `npm install`, not `npm ci`: the lockfile is generated on Windows, and the
# wasm fallback packages (@tailwindcss/oxide-wasm32-wasi, @img/sharp-wasm32)
# pull nested @emnapi/* deps that npm only records for the resolving platform.
# `npm ci` rejects that as out-of-sync on Linux; `npm install` reconciles it.
# Same choice the varotranaka stack's deploy.sh makes, for the same reason.
LOCK_SHA="$(sha256sum package-lock.json | cut -d' ' -f1)"
LOCK_STAMP="$ROOT/node_modules/.installed-lock-sha"
if [ ! -d node_modules ] || [ "$(cat "$LOCK_STAMP" 2>/dev/null || echo)" != "$LOCK_SHA" ]; then
  log "Installing dependencies"
  npm install --no-audit --no-fund --prefer-offline 2>&1 | sed 's/^/    /'
  echo "$LOCK_SHA" > "$LOCK_STAMP"
else
  info "dependencies unchanged, skipping install"
fi

# ---------- 3. Build ----------
# `next build` DELETES .next/standalone before rewriting it, so a build killed
# by the OOM reaper leaves no server.js at all and the app cannot restart.
# Refuse to start one when the box has no headroom.
if [ "$FORCE" -eq 0 ] && [ "$HEAD_SHA" = "$PREV_SHA" ] && [ -f ".next/standalone/server.js" ]; then
  log "No changes since last deploy ($(git rev-parse --short HEAD)) — nothing to do"
  exit 0
fi

AVAILABLE_MB="$(free -m | awk '/^Mem:/ {print $7}')"
info "available memory: ${AVAILABLE_MB} MB"
[ "$AVAILABLE_MB" -ge 700 ] || die "only ${AVAILABLE_MB} MB available; a next build here risks OOM-killing the box"

log "Building $APP_NAME"
NODE_OPTIONS="--max-old-space-size=1024" npm run build 2>&1 | sed 's/^/    /'

# Standalone output does not include these; they have to sit next to server.js.
log "Copying static assets into .next/standalone"
[ -d public ] && cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/

# The directory survives a killed build; the entrypoint does not. Check the file.
[ -f ".next/standalone/server.js" ] || die ".next/standalone/server.js missing after build"

# ---------- 4. Reload ----------
# Reload via the ecosystem file, not the bare PM2 name, so a changed script path
# or env is picked up instead of the stale saved definition.
log "PM2: reloading $APP_NAME (PM2_HOME=$PM2_HOME)"
pm2 startOrReload "$ROOT/ecosystem.config.js" --only "$APP_NAME" --update-env
pm2 save
# `pm2 save` as root rewrites dump.pm2 root-owned, after which the deploy-owned
# daemon can no longer update it.
chown deploy:deploy "$PM2_HOME/dump.pm2" 2>/dev/null || true

echo "$HEAD_SHA" > "$STATE_FILE"

# ---------- 5. Verify ----------
log "Waiting for port $PORT"
for attempt in $(seq 1 20); do
  CODE="$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"
  if [ "$CODE" != "000" ] && [ -n "$CODE" ]; then
    info "ready after ${attempt}s (HTTP $CODE)"
    log "Deployed $APP_NAME at $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

warn "no response on port $PORT after 20s — check: PM2_HOME=$PM2_HOME pm2 logs $APP_NAME"
exit 1
