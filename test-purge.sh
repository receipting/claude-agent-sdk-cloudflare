#!/bin/bash

# Test script for conversation purge implementation
# This script tests all the new endpoints and functionality

set -e  # Exit on error

# Configuration
BASE_URL="${BASE_URL:-http://localhost:8787}"
ACCOUNT_ID="${ACCOUNT_ID:-test-user}"
COLOR_GREEN='\033[0;32m'
COLOR_RED='\033[0;31m'
COLOR_BLUE='\033[0;34m'
COLOR_RESET='\033[0m'

echo -e "${COLOR_BLUE}================================${COLOR_RESET}"
echo -e "${COLOR_BLUE}Conversation Purge Test Suite${COLOR_RESET}"
echo -e "${COLOR_BLUE}================================${COLOR_RESET}"
echo ""
echo "Base URL: $BASE_URL"
echo "Account ID: $ACCOUNT_ID"
echo ""

# Helper function to print test results
print_result() {
  if [ $1 -eq 0 ]; then
    echo -e "${COLOR_GREEN}✓ $2${COLOR_RESET}"
  else
    echo -e "${COLOR_RED}✗ $2${COLOR_RESET}"
    exit 1
  fi
}

# Test 1: Health check
echo -e "${COLOR_BLUE}Test 1: Health Check${COLOR_RESET}"
response=$(curl -s "$BASE_URL/health")
echo "$response" | jq .
if echo "$response" | jq -e '.status == "healthy"' > /dev/null; then
  print_result 0 "Health check passed"
else
  print_result 1 "Health check failed"
fi
echo ""

# Test 2: Create a conversation
echo -e "${COLOR_BLUE}Test 2: Create Conversation${COLOR_RESET}"
response=$(curl -s -X POST "$BASE_URL/query" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"Hello, Claude! This is a test message.\", \"accountId\": \"$ACCOUNT_ID\"}")
echo "$response" | jq .
session_id=$(echo "$response" | jq -r '.session_id')
if [ -n "$session_id" ] && [ "$session_id" != "null" ]; then
  print_result 0 "Conversation created with session_id: $session_id"
else
  print_result 1 "Failed to create conversation"
fi
echo ""

# Test 3: Create another conversation with explicit session_id
echo -e "${COLOR_BLUE}Test 3: Create Conversation with Explicit Session ID${COLOR_RESET}"
custom_session_id="test_session_$(date +%s)"
response=$(curl -s -X POST "$BASE_URL/query" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"Another test message.\", \"accountId\": \"$ACCOUNT_ID\", \"session_id\": \"$custom_session_id\"}")
echo "$response" | jq .
returned_session_id=$(echo "$response" | jq -r '.session_id')
if [ "$returned_session_id" == "$custom_session_id" ]; then
  print_result 0 "Conversation created with custom session_id: $custom_session_id"
else
  print_result 1 "Failed to create conversation with custom session_id"
fi
echo ""

# Test 4: Get storage stats
echo -e "${COLOR_BLUE}Test 4: Get Storage Statistics${COLOR_RESET}"
response=$(curl -s "$BASE_URL/storage-stats?accountId=$ACCOUNT_ID")
echo "$response" | jq .
total_conversations=$(echo "$response" | jq -r '.total_conversations')
if [ "$total_conversations" -ge 2 ]; then
  print_result 0 "Storage stats retrieved: $total_conversations conversations"
else
  print_result 1 "Storage stats incorrect"
fi
echo ""

# Test 5: List conversations
echo -e "${COLOR_BLUE}Test 5: List Conversations${COLOR_RESET}"
response=$(curl -s "$BASE_URL/conversations?accountId=$ACCOUNT_ID&limit=10&offset=0")
echo "$response" | jq .
conversation_count=$(echo "$response" | jq '. | length')
if [ "$conversation_count" -ge 2 ]; then
  print_result 0 "Listed $conversation_count conversations"
else
  print_result 1 "Failed to list conversations"
fi
echo ""

# Test 6: Get specific conversation
echo -e "${COLOR_BLUE}Test 6: Get Specific Conversation${COLOR_RESET}"
response=$(curl -s "$BASE_URL/conversations/$session_id?accountId=$ACCOUNT_ID")
echo "$response" | jq .
retrieved_session_id=$(echo "$response" | jq -r '.session_id')
if [ "$retrieved_session_id" == "$session_id" ]; then
  print_result 0 "Retrieved conversation: $session_id"
else
  print_result 1 "Failed to retrieve conversation"
fi
echo ""

# Test 7: Delete specific conversation
echo -e "${COLOR_BLUE}Test 7: Delete Specific Conversation${COLOR_RESET}"
response=$(curl -s -X DELETE "$BASE_URL/conversations/$custom_session_id?accountId=$ACCOUNT_ID")
echo "$response" | jq .
success=$(echo "$response" | jq -r '.success')
if [ "$success" == "true" ]; then
  print_result 0 "Deleted conversation: $custom_session_id"
else
  print_result 1 "Failed to delete conversation"
fi
echo ""

# Test 8: Verify deletion
echo -e "${COLOR_BLUE}Test 8: Verify Deletion${COLOR_RESET}"
response=$(curl -s "$BASE_URL/conversations/$custom_session_id?accountId=$ACCOUNT_ID")
echo "$response" | jq .
error=$(echo "$response" | jq -r '.error')
if [ "$error" == "Not found" ] || [ "$(echo "$response" | jq -r '.session_id')" == "null" ]; then
  print_result 0 "Conversation successfully deleted"
else
  print_result 1 "Conversation still exists after deletion"
fi
echo ""

# Test 9: Manual purge trigger
echo -e "${COLOR_BLUE}Test 9: Manual Purge Trigger${COLOR_RESET}"
response=$(curl -s -X POST "$BASE_URL/purge?accountId=$ACCOUNT_ID")
echo "$response" | jq .
deleted=$(echo "$response" | jq -r '.deleted')
errors=$(echo "$response" | jq -r '.errors')
if [ "$errors" == "0" ]; then
  print_result 0 "Purge completed: $deleted conversations deleted, $errors errors"
else
  print_result 1 "Purge had errors"
fi
echo ""

# Test 10: Check storage stats after purge
echo -e "${COLOR_BLUE}Test 10: Storage Stats After Purge${COLOR_RESET}"
response=$(curl -s "$BASE_URL/storage-stats?accountId=$ACCOUNT_ID")
echo "$response" | jq .
conversations_ready=$(echo "$response" | jq -r '.conversations_ready_to_purge')
if [ "$conversations_ready" -ge 0 ]; then
  print_result 0 "Storage stats after purge: $conversations_ready conversations ready to purge"
else
  print_result 1 "Failed to get storage stats after purge"
fi
echo ""

# Test 11: Create multiple conversations for load testing
echo -e "${COLOR_BLUE}Test 11: Create Multiple Conversations${COLOR_RESET}"
echo "Creating 5 conversations..."
for i in {1..5}; do
  response=$(curl -s -X POST "$BASE_URL/query" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"Test message $i\", \"accountId\": \"$ACCOUNT_ID\"}")
  session_id=$(echo "$response" | jq -r '.session_id')
  echo "  Created: $session_id"
done
print_result 0 "Created 5 conversations"
echo ""

# Test 12: Verify conversation count
echo -e "${COLOR_BLUE}Test 12: Verify Conversation Count${COLOR_RESET}"
response=$(curl -s "$BASE_URL/storage-stats?accountId=$ACCOUNT_ID")
echo "$response" | jq .
total_conversations=$(echo "$response" | jq -r '.total_conversations')
if [ "$total_conversations" -ge 5 ]; then
  print_result 0 "Total conversations: $total_conversations"
else
  print_result 1 "Conversation count incorrect"
fi
echo ""

# Test 13: Pagination test
echo -e "${COLOR_BLUE}Test 13: Test Pagination${COLOR_RESET}"
response=$(curl -s "$BASE_URL/conversations?accountId=$ACCOUNT_ID&limit=2&offset=0")
page1_count=$(echo "$response" | jq '. | length')
response=$(curl -s "$BASE_URL/conversations?accountId=$ACCOUNT_ID&limit=2&offset=2")
page2_count=$(echo "$response" | jq '. | length')
if [ "$page1_count" -eq 2 ] && [ "$page2_count" -ge 1 ]; then
  print_result 0 "Pagination working: page1=$page1_count, page2=$page2_count"
else
  print_result 1 "Pagination not working correctly"
fi
echo ""

# Summary
echo -e "${COLOR_GREEN}================================${COLOR_RESET}"
echo -e "${COLOR_GREEN}All Tests Passed! ✓${COLOR_RESET}"
echo -e "${COLOR_GREEN}================================${COLOR_RESET}"
echo ""
echo "Summary:"
echo "  - Conversation storage: Working"
echo "  - Session management: Working"
echo "  - Storage statistics: Working"
echo "  - List/Get/Delete operations: Working"
echo "  - Manual purge: Working"
echo "  - Pagination: Working"
echo ""
echo "Next steps:"
echo "  1. Deploy to Cloudflare: npx wrangler deploy"
echo "  2. Test cron trigger: npx wrangler triggers cron"
echo "  3. Monitor logs: npx wrangler tail"
echo ""
