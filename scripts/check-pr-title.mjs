#!/usr/bin/env node
// check-pr-title: the pull-request title check of CI. The title becomes the squash commit's subject on main, so it
// follows the commit rule: "<type>: <what the person gains>", type from the list below, at most 72 characters.
// The length comes from the commit hook's own rule file; open plan rows and session ids are checked on the PC only.
//   node scripts/check-pr-title.mjs "<title>"
// Exit code 1 with the reason when the title breaks the rule, 2 when no title is given.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSubject } from "../hooks/lib/commit-subject.mjs";

export const TYPES = [
  "feat",
  "fix",
  "docs",
  "test",
  "ci",
  "refactor",
  "perf",
  "build",
  "chore",
];

/** Nothing when the title follows the rule, else a one-line reason. */
export function checkTitle(title) {
  const t = String(title);
  const m = /^([a-z]+): \S/.exec(t);
  if (!m || !TYPES.includes(m[1]))
    return `the title must start with one of ${TYPES.join(", ")} and ": "`;
  return checkSubject(t);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const title = process.argv[2];
  if (title === undefined || !title.trim()) {
    console.error('usage: node scripts/check-pr-title.mjs "<title>"');
    process.exit(2);
  }
  const reason = checkTitle(title);
  if (reason) {
    console.error(`pull-request title "${title}": ${reason}`);
    process.exit(1);
  }
  console.log(`pull-request title OK: ${title}`);
}
