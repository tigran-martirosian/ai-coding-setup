#!/usr/bin/env bash
# Runs both scanners with the same options (--days N, --project TEXT) and writes their reports, one after
# the other, to audits/review-<date>-numbers.md. Prints the file's path and its number of lines.
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../../audits/review-$(date +%F)-numbers.md"
node "$HOME/.claude/skills/usage-report/usage-scan.mjs" "$@" > "$out" || exit 1
echo >> "$out"
node "$here/review-scan.mjs" "$@" >> "$out" || exit 1
echo "$(wc -l < "$out") lines -> $(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
