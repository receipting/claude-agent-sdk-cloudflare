# Claude Code Hooks

This directory contains Claude Code hooks that enhance the development experience and security.

## security-audit.sh

**Type:** SessionStart hook (matcher: "startup")
**Purpose:** Prompt for AI-powered security audit on first repository access

### What it does

When you first start Claude Code in this repository, this hook displays a prompt asking you to request a security audit.

**The audit uses a Claude Code subagent to intelligently analyze:**
- 🔍 `package.json` for malicious install scripts and obfuscated code
- 🔍 `Dockerfile` for security antipatterns (curl | bash, hardcoded secrets)
- 🔍 Source code for hardcoded secrets, backdoors, and suspicious patterns
- 🔍 Overall repository structure for supply chain attack indicators

### How it works

1. **Runs on SessionStart** with source="startup" (first time opening repo)
2. **Displays prompt** asking user to request security audit
3. **User asks Claude** "Please perform the security audit for this repository"
4. **Claude delegates** to the `security-auditor` custom agent (`.claude/agents/security-auditor.md`)
5. **Agent analyzes** repository files with isolated context:
   - ✅ Analyzes package.json, Dockerfile, source code, .claude/hooks/, .claude/settings.json
   - ❌ Cannot spawn sub-agents (built-in loop prevention)
   - ❌ Does NOT read .claude/agents/ (other agent definitions)
   - ❌ Does NOT read ~/.claude/projects/ (conversation logs)
6. **Agent provides report** with detailed security findings and risk assessment
7. **Agent creates marker** `.claude/.security-audit-done` when complete
8. **Hook stops** showing prompt on future sessions

### Why AI-powered analysis?

**Traditional regex patterns:**
- ❌ Miss context and intent
- ❌ Generate false positives (flags test/example code)
- ❌ Can't detect novel attack patterns
- ❌ Don't explain WHY something is suspicious

**Claude Code subagent:**
- ✅ Understands code context and logic
- ✅ Detects obfuscated malicious intent
- ✅ Adapts to new attack patterns
- ✅ Provides detailed explanations and recommendations
- ✅ Can analyze complex multi-file attacks

### Benefits

- **Intelligent detection:** AI understands malicious intent, not just patterns
- **Supply chain protection:** Catches sophisticated npm/Docker attacks (500+ packages compromised in 2025)
- **Contextual analysis:** Knows difference between test code and production code
- **Actionable reports:** Explains what's wrong and how to fix it

### Example hook output (first startup)

```
╔═══════════════════════════════════════════════════════════════╗
║           🔒 SECURITY AUDIT RECOMMENDED                      ║
╔═══════════════════════════════════════════════════════════════╗

You've just opened a repository from GitHub.

⚠️  IMPORTANT: Before running 'npm install' or 'docker build', it's
   recommended to check this repository for security issues.

Why this matters:
  • Supply chain attacks are increasing (500+ npm packages compromised in 2025)
  • Malicious install scripts can steal credentials and data
  • Backdoors in Dockerfiles can compromise your system
  • This check happens BEFORE any code executes

What the security audit does:
  ✓ Uses AI to analyze code with context understanding (not just regex)
  ✓ Checks package.json for malicious install/postinstall scripts
  ✓ Reviews Dockerfile for security antipatterns (curl | bash, secrets)
  ✓ Scans source code for hardcoded credentials and backdoors
  ✓ Detects obfuscated code that hides malicious intent
  ✓ Provides detailed explanations of any issues found

───────────────────────────────────────────────────────────────

💡 To perform the security audit, ask Claude Code:
   "Please perform the security audit for this repository"

Or skip the audit (not recommended):
   touch .claude/.security-audit-done

╔═══════════════════════════════════════════════════════════════╗
```

**Then the user asks:** "Please perform the security audit for this repository"

**Claude Code delegates to the security-auditor custom agent** that intelligently analyzes the code and provides a detailed security report before any installation happens. The custom agent has its own isolated context window and cannot spawn additional sub-agents (preventing recursive loops).

### Re-running the audit

To re-run the security audit, delete the marker file:
```bash
rm .claude/.security-audit-done
```

Then restart Claude Code.

## check-setup.sh

**Type:** UserPromptSubmit hook
**Purpose:** Guide users through setup until complete

### What it does

Checks on every prompt until setup is complete:
- ✅ Is `.env` configured with required credentials?
- ✅ Is Docker image built?
- ✅ Is container running?

Once all checks pass, creates a marker file and stops running.

### How it works

1. **Runs before each prompt** until setup is complete
2. **Checks setup state** using Docker commands and file checks
3. **Shows status** with actionable next steps
4. **Creates marker file** (`.claude/.setup-complete`) when all checks pass
5. **Stops running** - no more status messages after setup is done

### Benefits

- **Guided setup:** Clear status on what's missing
- **Automatic completion:** Detects when you're done and stops
- **No clutter:** Once set up, messages disappear
- **Contextual help:** Claude sees status and can guide appropriately

### Re-running setup checks

To re-trigger setup status messages:
```bash
rm .claude/.setup-complete
```

The hook will run again on your next prompt.

### Example output

When nothing is set up:
```
═══════════════════════════════════════════════════════════
📦 Claude Agent SDK Container - Setup Status
═══════════════════════════════════════════════════════════

⚠️  Setup Status: .env file NOT found
   → Run ./setup-tokens.sh in a separate terminal to configure credentials

⚠️  Docker Status: Image NOT built
   → Run ./test.sh to build and start the container

💡 Quick Start:
   1. If .env missing: Run ./setup-tokens.sh (in separate terminal)
   2. If container not running: Run ./test.sh
═══════════════════════════════════════════════════════════
```

When everything is ready (final message):
```
═══════════════════════════════════════════════════════════
🎉 Setup Complete!
═══════════════════════════════════════════════════════════

✅ Setup Status: .env file configured
✅ Docker Status: Image built (claude-code-my-project)
✅ Container Status: Running on http://localhost:8080
   → Web CLI: http://localhost:8080
   → REST API: POST http://localhost:8080/query

Application is ready to use:
  • Web CLI: http://localhost:8080
  • REST API: POST http://localhost:8080/query

This setup check will no longer run on subsequent prompts.
═══════════════════════════════════════════════════════════
```

After this, the hook stops running until you delete `.claude/.setup-complete`.

## Modifying hooks

To disable this hook, edit `.claude/settings.json` and remove the `UserPromptSubmit` hook configuration.

To modify behavior, edit `check-setup.sh` directly.

## Learn more

- [Claude Code Hooks Documentation](https://docs.claude.com/en/docs/claude-code/hooks-guide)
- [UserPromptSubmit Hook Reference](https://docs.claude.com/en/docs/claude-code/hooks)
