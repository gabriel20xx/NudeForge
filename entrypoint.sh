#!/bin/bash
set -e

# Ensure we are in the repo directory
cd /app

echo "Pulling latest changes from Git..."
git pull || echo "Warning: git pull failed, using existing code."

echo "Installing updated dependencies (if any)..."
npm install

echo "Starting the app..."
exec npm start
