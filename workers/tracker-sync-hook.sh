#!/bin/sh
# The body of a repo's post-commit hook for tracker-sync (tracker-sync.mjs --install adds the line that runs it).
# When the new commit's message has a `Step: ` line, it starts tracker-sync.mjs --commit for that commit, detached,
# so it never slows or fails the commit; the sync writes its own log. It exits 0 in every case, also when node or
# the worker is missing. TRACKER_SYNC=off turns it off.
# The setup folder: USERPROFILE first, as node's home folder on Windows is USERPROFILE and Git Bash's HOME can
# point at another folder.
[ "$TRACKER_SYNC" = off ] && exit 0
claude="${USERPROFILE:-$HOME}/.claude"
worker="$claude/workers/tracker-sync.mjs"
[ -f "$worker" ] || exit 0
git log -1 --format=%B HEAD 2>/dev/null | grep -q '^Step: ' || exit 0
# A git client started from a desktop app can have a PATH without node.
node=$(command -v node 2>/dev/null)
for n in /usr/local/bin/node /opt/homebrew/bin/node "C:/Program Files/nodejs/node.exe"; do
  [ -n "$node" ] && break
  [ -x "$n" ] && node=$n
done
[ -n "$node" ] || exit 0
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
sha=$(git rev-parse HEAD 2>/dev/null) || exit 0
state=${TRACKER_SYNC_STATE_DIR:-$claude/state/tracker-sync}
mkdir -p "$state" 2>/dev/null || exit 0
"$node" "$worker" --commit "$top" "$sha" </dev/null >/dev/null 2>>"$state/tracker-sync.log" &
exit 0
