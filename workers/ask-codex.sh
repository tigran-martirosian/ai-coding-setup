#!/usr/bin/env bash
# ask-codex: runs the Codex worker with the flags this setup needs, so the command stays short
# enough for the permission popup (the command-explain hook refuses long commands).
#
#   ask-codex.sh [--web] [--think] "<short task>"
#   ask-codex.sh [--web] [--think] <path to a text file holding the task>
#
# --web    web research (codex --search)
# --think  default reasoning effort instead of low, for a hard research question
# Read-only: Codex can read files but not change them. ASK_CODEX_DRY=1 prints the command instead of running it.

web=()
effort=(-c 'model_reasoning_effort="low"')
while [ $# -gt 0 ]; do
  case "$1" in
    --web) web=(--search); shift ;;
    --think) effort=(); shift ;;
    *) break ;;
  esac
done

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo 'ask-codex: give one task, as text or as the path of a text file. Usage: ask-codex.sh [--web] [--think] "<task>"' >&2
  exit 2
fi

task="$1"
if [ -f "$task" ]; then
  task="$(cat "$task")"
  if [ -z "$task" ]; then
    echo "ask-codex: the task file $1 is empty" >&2
    exit 2
  fi
fi

cmd=(codex "${web[@]}" exec --skip-git-repo-check -s read-only -c 'windows.sandbox="unelevated"' "${effort[@]}")

if [ -n "${ASK_CODEX_DRY:-}" ]; then
  printf '%s\n' "${cmd[@]}" "TASK: $task"
  exit 0
fi

"${cmd[@]}" "$task" < /dev/null
