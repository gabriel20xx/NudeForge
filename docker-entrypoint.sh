#!/bin/sh
set -e

# Fetch application source from GitHub at runtime if repo/branch are provided
APP_REPO="${APP_REPO:-gabriel20xx/NudeForge}"
APP_REF="${APP_REF:-master}"
APP_DIR="${APP_DIR:-/app}"

if [ ! -f "$APP_DIR/package.json" ]; then
  echo "[entrypoint] Cloning application source: $APP_REPO@$APP_REF"
  AUTH_PREFIX=""
  if [ -n "$GITHUB_TOKEN" ]; then AUTH_PREFIX="$GITHUB_TOKEN@"; fi
  git init "$APP_DIR"
  cd "$APP_DIR"
  git remote add origin "https://${AUTH_PREFIX}github.com/${APP_REPO}.git"
  if ! git fetch --depth 1 origin "$APP_REF"; then
    echo "[entrypoint] git fetch failed; check APP_REPO/APP_REF or token" >&2
    exit 1
  fi
  git checkout -B runtime-fetch FETCH_HEAD
else
  echo "[entrypoint] Existing source detected; skipping clone"
  cd "$APP_DIR"
fi

# If NPM_TOKEN provided at runtime, configure GitHub Packages auth
if [ -n "$NPM_TOKEN" ]; then
  npm config set @gabriel20xx:registry https://npm.pkg.github.com
  npm config set //npm.pkg.github.com/:_authToken "$NPM_TOKEN"
fi

# Install production deps if node_modules is missing or empty
if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  echo "[entrypoint] Installing production dependencies..."
  (npm ci --omit=dev || npm install --omit=dev)
fi

# Ensure shared theme file is present from the installed package
node -e "const fs=require('fs');try{const src=require.resolve('@gabriel20xx/nude-shared/theme.css');fs.mkdirSync('src/public/css',{recursive:true});fs.copyFileSync(src,'src/public/css/theme.css');console.log('[entrypoint] theme.css copied from package');}catch(e){console.warn('[entrypoint] theme.css copy skipped:', e.message)}"

exec "$@"
