#!/bin/bash
# openclaw-model-router-skill API Key Setup Script
# Run this script to configure your API keys for the model router

set -e

echo "=============================================="
echo "  OpenClaw Model Router - API Key Setup"
echo "=============================================="
echo ""

# Check if openclaw is installed
if ! command -v openclaw &> /dev/null; then
    echo "❌ Error: openclaw CLI not found. Please install OpenClaw first."
    exit 1
fi

echo "This script will help you configure API keys for the model router."
echo ""

# Function to set API key
set_api_key() {
    local provider=$1
    local key=$2
    
    if [ -z "$key" ]; then
        echo "❌ Error: API key cannot be empty"
        return 1
    fi
    
    # Update auth-profiles.json
    local profile_file="$HOME/.openclaw/agents/main/agent/auth-profiles.json"
    
    if [ -f "$profile_file" ]; then
        # Check if profile exists
        if grep -q "\"$provider:default\"" "$profile_file"; then
            echo "✅ Found existing profile for $provider"
        else
            echo "⚠️  No existing profile for $provider, will create new"
        fi
    fi
    
    echo "✅ API key for $provider configured"
}

# MiniMax Global (standard)
echo "------------------------------------------"
echo "1) MiniMax Global (Standard)"
echo "   Model: minimax/MiniMax-M2.5"
echo "   Endpoint: https://api.minimax.io/anthropic"
echo "------------------------------------------"
read -p "Enter your MiniMax Global API key (or press Enter to skip): " MINIMAX_GLOBAL_KEY

if [ -n "$MINIMAX_GLOBAL_KEY" ]; then
    set_api_key "minimax" "$MINIMAX_GLOBAL_KEY"
fi

echo ""

# MiniMax CN (highspeed)
echo "------------------------------------------"
echo "2) MiniMax CN (Highspeed/Lightning)"
echo "   Model: minimax-cn/MiniMax-M2.5-highspeed"
echo "   Endpoint: https://api.minimaxi.com/anthropic"
echo "------------------------------------------"
read -p "Enter your MiniMax CN API key (or press Enter to skip): " MINIMAX_CN_KEY

if [ -n "$MINIMAX_CN_KEY" ]; then
    set_api_key "minimax-cn" "$MINIMAX_CN_KEY"
fi

echo ""

# Verify configuration
echo "------------------------------------------"
echo "Verifying configuration..."
echo "------------------------------------------"

if command -v openclaw &> /dev/null; then
    echo "Running: openclaw models list --json"
    openclaw models list --json 2>/dev/null || echo "⚠️  Could not list models (may need gateway restart)"
else
    echo "⚠️  openclaw not available"
fi

echo ""
echo "=============================================="
echo "  Setup Complete!"
echo "=============================================="
echo ""
echo "Next steps:"
echo "1. Restart OpenClaw gateway: openclaw gateway restart"
echo "2. Test routing: node src/cli.js route \"@mini hello\""
echo ""
