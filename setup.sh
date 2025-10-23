#!/bin/bash

# Gut Matrix Setup Script
# This script helps you set up the project for local development

echo "🧠 Gut Matrix Setup"
echo "==================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "✅ Node.js detected: $(node --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "⚠️  Wrangler CLI not found globally. Using local version from node_modules."
    WRANGLER="npx wrangler"
else
    echo "✅ Wrangler CLI detected: $(wrangler --version)"
    WRANGLER="wrangler"
fi

echo ""
echo "🔑 Setting up Cloudflare KV namespace..."
echo ""
echo "Please run the following command to create a KV namespace:"
echo ""
echo "  $WRANGLER kv:namespace create \"MATRIX_STORE\""
echo ""
echo "Then update wrangler.toml with the returned namespace ID."
echo ""
echo "================================================"
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Create KV namespace (see command above)"
echo "  2. Update wrangler.toml with your KV namespace ID"
echo "  3. Run: npm run dev"
echo "  4. Visit: http://localhost:8788"
echo ""
echo "For deployment:"
echo "  1. Run: $WRANGLER login"
echo "  2. Run: npm run deploy"
echo ""
echo "See README.md for full documentation."
echo "================================================"
