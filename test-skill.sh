#!/bin/bash

# Test skill-test skill
# Usage: ./test-skill.sh [port]

PORT=${1:-8787}
API_KEY=$(grep API_KEY .dev.vars | cut -d= -f2)

if [ -z "$API_KEY" ]; then
  echo "Error: API_KEY not found in .dev.vars"
  exit 1
fi

echo "Testing skill-test skill on localhost:$PORT..."
echo ""

curl -X POST "http://localhost:$PORT/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "query": "Run the skill-test skill"
  }' | jq .

echo ""
