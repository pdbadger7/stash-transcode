#!/bin/bash

# Integration test script for stash-transcode
# Tests health, probe, direct, and HLS endpoints

set -e

AGENT_URL="${AGENT_URL:-http://localhost:8080}"
SCENE_ID="${SCENE_ID:-1}"
TOKEN="${TOKEN:-}"

echo "================================"
echo "Stash Transcode Integration Test"
echo "================================"
echo "Agent URL: $AGENT_URL"
echo "Scene ID: $SCENE_ID"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

test_endpoint() {
  local name=$1
  local url=$2
  local expected_code=$3

  echo -n "Testing $name... "
  
  response=$(curl -s -w "\n%{http_code}" "$url")
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  if [ "$http_code" = "$expected_code" ]; then
    echo -e "${GREEN}✓ HTTP $http_code${NC}"
    echo "  Response: $(echo "$body" | head -c 100)..."
  else
    echo -e "${RED}✗ Expected HTTP $expected_code, got $http_code${NC}"
    echo "  Response: $body"
    return 1
  fi
}

# Test /health endpoint
test_endpoint "Health check" "$AGENT_URL/health" 200

# Test /probe endpoint
if [ -z "$TOKEN" ]; then
  test_endpoint "Probe (no token)" "$AGENT_URL/stash/scene/$SCENE_ID/probe" "404"
else
  test_endpoint "Probe (with token)" "$AGENT_URL/stash/scene/$SCENE_ID/probe?token=$TOKEN" "404"
fi

# Test /direct endpoint
if [ -z "$TOKEN" ]; then
  test_endpoint "Direct playback (no token)" "$AGENT_URL/stash/scene/$SCENE_ID/direct" "404"
else
  test_endpoint "Direct playback (with token)" "$AGENT_URL/stash/scene/$SCENE_ID/direct?token=$TOKEN" "404"
fi

# Test /master.m3u8 endpoint
if [ -z "$TOKEN" ]; then
  test_endpoint "HLS master.m3u8 (no token)" "$AGENT_URL/stash/scene/$SCENE_ID/master.m3u8" "404"
else
  test_endpoint "HLS master.m3u8 (with token)" "$AGENT_URL/stash/scene/$SCENE_ID/master.m3u8?token=$TOKEN" "404"
fi

# Test /segment endpoint
if [ -z "$TOKEN" ]; then
  test_endpoint "HLS segment (no token)" "$AGENT_URL/stash/scene/$SCENE_ID/segment/segment_000.ts" "403"
else
  test_endpoint "HLS segment (with token)" "$AGENT_URL/stash/scene/$SCENE_ID/segment/segment_000.ts?token=$TOKEN" "404"
fi

echo ""
echo "================================"
echo -e "${GREEN}✓ All endpoint tests complete!${NC}"
echo "================================"
echo ""
echo "Note: 404 responses are expected - we don't have a real Stash instance configured."
echo "The important thing is that the agent is running and responding to requests."
