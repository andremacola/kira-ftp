#!/bin/bash

# Antigravity IDE wrapper script using open -a command
# This script allows rmate-server to use "open -a Antigravity IDE"
# instead of a direct binary (works better with file arguments)

# Check if Antigravity IDE is installed
if ! osascript -e 'id of application "Antigravity IDE"' &>/dev/null; then
    echo "Error: Antigravity IDE is not installed or not accessible" >&2
    exit 1
fi

# Pass all arguments to Antigravity IDE using open -a (most reliable method)
exec open -a "Antigravity IDE" "$@"
