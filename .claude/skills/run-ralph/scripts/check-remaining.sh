#!/bin/bash
# check-remaining.sh — Report how many Ralph user stories still have passes:false.
#
# Usage:
#   check-remaining.sh [path/to/prd.json]
#
# Defaults to ./ralph/prd.json relative to the current working directory.
# Prints a single integer (the count of remaining stories) on stdout.
# Exit codes:
#   0  count printed (including 0 when everything is complete)
#   2  prd.json missing
#   3  jq missing
#   4  prd.json present but malformed / no parseable stories

set -e

PRD="${1:-ralph/prd.json}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found on PATH" >&2
  exit 3
fi

if [ ! -f "$PRD" ]; then
  echo "PRD file not found: $PRD" >&2
  exit 2
fi

# Count every object anywhere in the JSON tree that has a "passes" field
# whose value is not true. This handles both top-level {userStories:[...]}
# and other shapes Ralph may evolve to without hard-coding the path.
remaining=$(jq '[.. | objects | select(has("passes")) | select(.passes != true)] | length' "$PRD" 2>/dev/null || echo "")

if [ -z "$remaining" ]; then
  echo "Could not parse $PRD" >&2
  exit 4
fi

echo "$remaining"
