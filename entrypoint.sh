#!/bin/bash
set -e

# Ensure we are in the repo directory
cd /app

# Load environment variables from .env if present
#!/bin/bash
set -e

# Ensure we are in the repo directory
cd /app

# Load env file if exists
if [ -f .env ]; then
	set -a; . ./.env; set +a
fi

echo "Pulling latest changes from Git (NudeForge)..."
git pull || echo "Warning: git pull failed, using existing code."

NUDESHARED_REPO=${NUDESHARED_REPO:-"https://github.com/gabriel20xx/NudeShared.git"}
NUDESHARED_BRANCH=${NUDESHARED_BRANCH:-"master"}
NUDESHARED_DIR=${NUDESHARED_DIR:-"../NudeShared"}

echo "Preparing NudeShared (repo: $NUDESHARED_REPO branch: $NUDESHARED_BRANCH)"
AUTHED_REPO="$NUDESHARED_REPO"
if [ -n "$GITHUB_TOKEN" ] && [[ "$NUDESHARED_REPO" == https://github.com/* ]] && [[ "$NUDESHARED_REPO" != *"@github.com"* ]]; then
	AUTHED_REPO="${NUDESHARED_REPO/https:\/\/github.com\//https://$GITHUB_TOKEN@github.com/}"
fi

if [ ! -d "$NUDESHARED_DIR/.git" ]; then
	echo "Cloning NudeShared..."
	git clone --depth=1 "$AUTHED_REPO" "$NUDESHARED_DIR" || echo "Warning: failed to clone NudeShared"
else
	echo "Updating existing NudeShared clone..."
	(cd "$NUDESHARED_DIR" && git fetch --depth=1 origin "$NUDESHARED_BRANCH" && git reset --hard "origin/$NUDESHARED_BRANCH" || echo "Warning: failed to update NudeShared")
fi

SHARED_DIR="$NUDESHARED_DIR"
echo "Syncing shared theme and logger..."
mkdir -p src/public/css src/utils
if [ -f "$SHARED_DIR/theme.css" ]; then
	cp -f "$SHARED_DIR/theme.css" src/public/css/theme.css
else
	echo "Warning: Shared theme.css not found"
fi
if [ -f "$SHARED_DIR/logger.js" ]; then
	cp -f "$SHARED_DIR/logger.js" src/utils/logger.js
else
	echo "Warning: Shared logger.js not found"
fi

echo "Installing updated dependencies (if any)..."
npm install

echo "Rebuilding Sharp for carousel image processing..."
npm rebuild sharp || echo "Sharp rebuild failed (continuing)"

echo "Setting up carousel directories..."
mkdir -p public/images/carousel/thumbnails
chmod 755 public/images/carousel/thumbnails 2>/dev/null || true

echo "Starting the app..."
exec npm start
