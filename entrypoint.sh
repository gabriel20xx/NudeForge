#!/bin/bash
set -e

# Check if GIT_REPO env var is set
if [ -z "$GIT_REPO" ]; then
  echo "Error: GIT_REPO environment variable is not set."
  exit 1
fi

# Clean /app folder if anything exists (optional, to avoid conflicts)
rm -rf /app/*

# Clone the repo into /app
echo "Cloning repository $GIT_REPO..."
git clone "$GIT_REPO" /app

# Change directory to /app
cd /app

# Install dependencies
echo "Installing npm dependencies..."
npm install

# Run the app
echo "Starting the app..."
exec npm start
