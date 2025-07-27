#!/bin/bash

# Production deployment script for carousel image optimization

echo "🚀 Deploying Image2Image Website with Carousel Optimization..."

# Update dependencies
echo "📦 Installing/updating dependencies..."
npm install --production

# Rebuild Sharp for the current platform
echo "🔧 Rebuilding Sharp for production platform..."
npm rebuild sharp

# Create necessary directories
echo "📁 Creating carousel directories..."
mkdir -p public/img/carousel/thumbnails

# Set proper permissions
echo "🔐 Setting permissions..."
chmod 755 public/img/carousel
chmod 755 public/img/carousel/thumbnails

# Clear existing thumbnails to force regeneration
echo "🧹 Clearing old thumbnails..."
rm -f public/img/carousel/thumbnails/*

echo "✅ Deployment complete!"
echo "💡 To test carousel optimization:"
echo "   - Visit /debug/carousel for debug info"
echo "   - Check /img/carousel/[filename] for optimized images"
