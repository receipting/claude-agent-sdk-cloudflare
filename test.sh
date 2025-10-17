#!/bin/bash
set -e

# Find the port wrangler is using
PORT=${1:-8787}

echo "Testing Claude Agent SDK on port $PORT..."
echo ""

# Test health endpoint
echo "1. Health check:"
curl -s "http://localhost:$PORT/health" | jq '.'
echo ""

# Test query endpoint
echo "2. Query test:"
RESPONSE=$(curl -s -X POST "http://localhost:$PORT/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is 2+2? Just the number."}')

echo "$RESPONSE" | jq '.'
echo ""

# Check if it worked
if echo "$RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
  echo "✓ Test passed!"
else
  echo "✗ Test failed"
  exit 1
fi
