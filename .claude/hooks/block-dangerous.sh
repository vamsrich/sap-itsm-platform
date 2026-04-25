#!/usr/bin/env bash
#
# block-dangerous.sh — Claude Code PreToolUse safety net
#
# Reads the tool invocation JSON from stdin, blocks dangerous commands.
# Exit 2 = BLOCK (Claude sees stderr as error message, command does not run).
# Exit 0 = ALLOW (command proceeds normally).
#
# This is a defense-in-depth layer ON TOP of the deny list in settings.json.
# The deny list catches literal patterns; this hook catches sneaky variants.

set -uo pipefail

# Read the entire stdin (tool invocation JSON) into a variable
INPUT=$(cat)

# Extract the command being run. We don't have jq guaranteed on Windows,
# so we use grep + sed to extract the "command" field from the tool_input.
COMMAND=$(echo "$INPUT" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')

# If we couldn't extract a command, allow (defensive — don't block on parse errors)
if [ -z "$COMMAND" ]; then
  exit 0
fi

# Helper to block with a clear message
block() {
  echo "BLOCKED by block-dangerous.sh: $1" >&2
  echo "Command: $COMMAND" >&2
  echo "Reason: $2" >&2
  echo "If you're sure this is safe and intentional, edit .claude/hooks/block-dangerous.sh to add an exception." >&2
  exit 2
}

# ─────────────────────────────────────────────────────────────────
# RULE 1 — Block prisma migrate (CLAUDE.md hard rule #1)
# ─────────────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE '(prisma|prisma-client) migrate (deploy|dev|reset|resolve)'; then
  block "prisma migrate" "Use 'npx prisma db push' instead. See CLAUDE.md hard rule #1."
fi

# ─────────────────────────────────────────────────────────────────
# RULE 2 — Block force-push to main/master
# ─────────────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE 'git push.*--force.*(main|master)'; then
  block "force push to main/master" "Force-pushing to protected branch is denied. Use --force-with-lease at minimum, or rewrite the change as a normal commit."
fi
if echo "$COMMAND" | grep -qE 'git push.*-f.*(main|master)'; then
  block "force push to main/master" "Short-form -f detected. Force-pushing to protected branch is denied."
fi

# ─────────────────────────────────────────────────────────────────
# RULE 3 — Block catastrophic rm -rf
# ─────────────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE 'rm[[:space:]]+-rf?[[:space:]]+(/|/\*|~|\$HOME|\.\.)'; then
  block "catastrophic rm -rf" "rm -rf targeting / or ~ is blocked. Use explicit relative paths inside the project."
fi

# ─────────────────────────────────────────────────────────────────
# RULE 4 — Block pipe-to-shell from network
# ─────────────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE '(curl|wget)[[:space:]].*\|[[:space:]]*(bash|sh|zsh)'; then
  block "pipe-to-shell" "Piping network downloads to a shell is blocked. Download, inspect, then run."
fi

# ─────────────────────────────────────────────────────────────────
# RULE 5 — Block disk-overwrite operations
# ─────────────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE 'dd[[:space:]]+if=.*of=/dev/'; then
  block "dd to /dev/" "dd writing to a device is destructive."
fi
if echo "$COMMAND" | grep -qE '>[[:space:]]*/dev/sd'; then
  block "redirect to /dev/sd" "Redirecting output to a disk device is destructive."
fi

# ─────────────────────────────────────────────────────────────────
# RULE 6 — Block mass chmod 777
# ─────────────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE 'chmod[[:space:]]+(-R[[:space:]]+)?777[[:space:]]+(/|/\*|~)'; then
  block "chmod 777 on root" "Mass permission opening on root paths is blocked."
fi

# All checks passed — allow the command
exit 0
