#!/usr/bin/env bash
# Runs both scanners with the same options (--days N, --project TEXT) and writes their reports, one after
# the other, to audits/review-<date>-numbers.md (review-<date>-2-numbers.md and so on when the day already
# has one: an earlier run's numbers are never overwritten). Prints the file's path and its number of lines.
here="$(cd "$(dirname "$0")" && pwd)"
dir="$here/../../../audits"
out="$dir/review-$(date +%F)-numbers.md"
n=2
while [ -e "$out" ]; do out="$dir/review-$(date +%F)-$n-numbers.md"; n=$((n + 1)); done
node "$HOME/.claude/skills/usage-report/usage-scan.mjs" "$@" > "$out" || exit 1
echo >> "$out"
node "$here/review-scan.mjs" "$@" >> "$out" || exit 1
echo "$(wc -l < "$out") lines -> $(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
