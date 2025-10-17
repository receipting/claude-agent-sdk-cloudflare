#!/bin/bash
# Claude Code Hook: Check setup state and inject context

SECURITY_AUDIT_MARKER=".claude/.security-audit-done"
SETUP_STATE=""
NEEDS_SETUP=false

# Check 0: Has security audit been run?
if [ ! -f "$SECURITY_AUDIT_MARKER" ]; then
    SETUP_STATE="${SETUP_STATE}🔒 Security Status: Audit NOT performed\n"
    SETUP_STATE="${SETUP_STATE}   → Recommended: Ask Claude to run the security audit\n"
    SETUP_STATE="${SETUP_STATE}   → AI-powered analysis detects malicious code, backdoors, and supply chain attacks\n\n"
fi

# Check 1: Is .env configured?
if [ ! -f .env ]; then
    SETUP_STATE="${SETUP_STATE}⚠️  Setup Status: .env file NOT found\n"
    SETUP_STATE="${SETUP_STATE}   → Run ./setup-tokens.sh in a separate terminal to configure credentials\n\n"
    NEEDS_SETUP=true
else
    # Check if .env has required variables
    if ! grep -q "CLAUDE_CODE_OAUTH_TOKEN" .env || ! grep -q "GITHUB_CLIENT_ID" .env; then
        SETUP_STATE="${SETUP_STATE}⚠️  Setup Status: .env file incomplete\n"
        SETUP_STATE="${SETUP_STATE}   → Run ./setup-tokens.sh to complete setup\n\n"
        NEEDS_SETUP=true
    else
        SETUP_STATE="${SETUP_STATE}✅ Setup Status: .env file configured\n"
    fi
fi

# Check 2: Is Docker image built?
DIR_NAME=$(basename "$(pwd)")
DIR_NAME_SAFE=$(echo "$DIR_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\+/-/g; s/^-//; s/-$//')
IMAGE_NAME="claude-code-${DIR_NAME_SAFE}"

if ! docker images | grep -q "^${IMAGE_NAME}"; then
    SETUP_STATE="${SETUP_STATE}⚠️  Docker Status: Image NOT built\n"
    SETUP_STATE="${SETUP_STATE}   → Run ./test.sh to build and start the container\n\n"
    NEEDS_SETUP=true
else
    SETUP_STATE="${SETUP_STATE}✅ Docker Status: Image built (${IMAGE_NAME})\n"
fi

# Check 3: Is container running?
CONTAINER_NAME="${IMAGE_NAME}"
if docker ps | grep -q "${CONTAINER_NAME}"; then
    SETUP_STATE="${SETUP_STATE}✅ Container Status: Running on http://localhost:8080\n"
    SETUP_STATE="${SETUP_STATE}   → Web CLI: http://localhost:8080\n"
    SETUP_STATE="${SETUP_STATE}   → REST API: POST http://localhost:8080/query\n"
elif docker ps -a | grep -q "${CONTAINER_NAME}"; then
    SETUP_STATE="${SETUP_STATE}⚠️  Container Status: Exists but NOT running\n"
    SETUP_STATE="${SETUP_STATE}   → Run: docker start ${CONTAINER_NAME}\n\n"
    NEEDS_SETUP=true
else
    if [ "$NEEDS_SETUP" = false ]; then
        SETUP_STATE="${SETUP_STATE}⚠️  Container Status: NOT created\n"
        SETUP_STATE="${SETUP_STATE}   → Run ./test.sh to create and start\n\n"
        NEEDS_SETUP=true
    fi
fi

# If setup is complete, show success message
if [ "$NEEDS_SETUP" = false ]; then
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "🎉 Setup Complete!"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo -e "$SETUP_STATE"
    echo "Application is ready to use:"
    echo "  • Web CLI: http://localhost:8080"
    echo "  • REST API: POST http://localhost:8080/query"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    exit 0
fi

# Setup is NOT complete - show status
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "📦 Claude Agent SDK Container - Setup Status"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo -e "$SETUP_STATE"

echo "💡 Quick Start:"
if [ ! -f "$SECURITY_AUDIT_MARKER" ]; then
    echo "   0. Recommended: Ask Claude to perform security audit (protects against malicious code)"
fi
echo "   1. If .env missing: Run ./setup-tokens.sh (in separate terminal)"
echo "   2. If container not running: Run ./test.sh"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Exit 0 so output gets added to context (not blocked)
exit 0
