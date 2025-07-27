#!/bin/bash
set -e

# Ensure we are in the repo directory
cd /app

echo "Pulling latest changes from Git..."
git pull || echo "Warning: git pull failed, using existing code."

echo "Installing updated dependencies (if any)..."
npm install

# Rebuild Sharp for the container platform (for carousel optimization)
echo "Rebuilding Sharp for carousel image processing..."
npm rebuild sharp

# Create necessary directories for carousel
echo "Setting up carousel directories..."
mkdir -p public/img/carousel/thumbnails
chmod 755 public/img/carousel/thumbnails 2>/dev/null || true

echo "Starting the app..."
exec npm start
