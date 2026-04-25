#!/usr/bin/env bash
#
# format-on-save.sh — Claude Code PostToolUse hook
#
# Runs after Claude Code edits a file (Edit | Write | MultiEdit).
# Auto-formats the edited file with Prettier.
#
# Always exits 0 — PostToolUse hooks can't block (edit already happened).
# We just want to format the file. Fail gracefully if prettier isn't available.

set -uo pipefail

# Read the entire stdin (tool invocation JSON) into a variable
INPUT=$(cat)

# Extract the file path that was just edited
FILE_PATH=$(echo "$INPUT" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/^"file_path"[[:space:]]*:[[:space:]]*"//; s/"$//')

# If no file path found, silently exit
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Determine the project root (this script lives in .claude/hooks/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Skip files outside the project (defensive)
case "$FILE_PATH" in
  "$PROJECT_ROOT"/*) ;;
  *) exit 0 ;;
esac

# Skip files that don't need formatting
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.md|*.css|*.scss|*.html) ;;
  *) exit 0 ;;
esac

# Determine which workspace the file is in
WORKSPACE=""
case "$FILE_PATH" in
  "$PROJECT_ROOT"/backend/*) WORKSPACE="backend" ;;
  "$PROJECT_ROOT"/frontend/*) WORKSPACE="frontend" ;;
esac

# Run prettier from the appropriate workspace, on just this file
if [ -n "$WORKSPACE" ]; then
  PRETTIER_BIN="$PROJECT_ROOT/$WORKSPACE/node_modules/.bin/prettier"
  if [ -x "$PRETTIER_BIN" ]; then
    if "$PRETTIER_BIN" --write "$FILE_PATH" 2>/dev/null; then
      echo "format-on-save: prettier formatted $FILE_PATH" >&2
    fi
  fi
fi

# Always exit 0 — PostToolUse can't block anyway
exit 0
