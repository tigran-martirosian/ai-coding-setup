// Tests for hooks/lib/changelog.mjs: readChangelog read directly, with the bridge line a 26.1 install also reads.
// Run: node tests/test-changelog.mjs
import { fileURLToPath, pathToFileURL } from "node:url";

const { readChangelog } = await import(
  pathToFileURL(
    fileURLToPath(new URL("../hooks/lib/changelog.mjs", import.meta.url)),
  ).href
);
let fail = 0,
  total = 0;
const report = (ok, name) => {
  total++;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// the error readChangelog throws for the text, or "" when it reads it
const thrown = (text) => {
  try {
    readChangelog(text);
    return "";
  } catch (e) {
    return e.message;
  }
};
// The 26.1 update check's reader (git show v26.1:hooks/update-check.mjs, ~line 127)
const OLD_READER = /^- (\d+(?:\.\d+)*) \(([^)]*)\): (.+?)\r?$/gm;

const bridged = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "- Not out yet.",
  "",
  "## [26.2] - 2026-11-20",
  "",
  "- 26.2 (Nov 20, 2026): Maps are faster; backups run on their own.",
  "- A second bullet",
  "",
  "## [26.1] - 2026-11-13",
  "",
  "The 26.1 notes.",
  "",
].join("\r\n");
report(
  same(readChangelog(bridged), [
    {
      version: "26.2",
      date: "2026-11-20",
      text: "Maps are faster; backups run on their own. A second bullet.",
    },
    { version: "26.1", date: "2026-11-13", text: "The 26.1 notes." },
  ]),
  "bridge line: read as the version's first bullet, no version or date in the text",
);
report(
  same(
    [...bridged.matchAll(OLD_READER)].map(([, v, date, text]) => ({
      v,
      date,
      text,
    })),
    [
      {
        v: "26.2",
        date: "Nov 20, 2026",
        text: "Maps are faster; backups run on their own.",
      },
    ],
  ),
  "bridge line: the 26.1 reader finds it, with its date in words, and nothing else",
);
report(
  /line 3: .*opens version 26\.2 but names version 26\.1/.test(
    thrown("## [26.2] - 2026-11-20\n\n- 26.1 (Nov 20, 2026): Wrong.\n"),
  ),
  "bridge line with another version than its heading: throws with the line",
);
report(
  /line 3: the date "2026-11-20"/.test(
    thrown("## [26.2] - 2026-11-20\n\n- 26.2 (2026-11-20): Text.\n"),
  ),
  "bridge line with a date not in words: throws with the line",
);
report(
  /line 5: the heading "## Notes"/.test(
    thrown("## [26.2] - 2026-11-20\n\n- Text.\n\n## Notes\n\n- More.\n"),
  ),
  "unknown ## heading: throws with the line",
);
report(
  /line 1: the heading "## \[26\.2\] - Nov 20, 2026"/.test(
    thrown("## [26.2] - Nov 20, 2026\n\n- Text.\n"),
  ),
  "heading with a bad date: throws with the line",
);
report(
  /version 26\.2 twice/.test(
    thrown(
      "## [26.2] - 2026-11-20\n\n- One.\n\n## [26.2] - 2026-11-21\n\n- Two.\n",
    ),
  ),
  "a version twice: throws",
);
report(
  same(
    readChangelog(
      "## [26.2] - 2026-11-20\n\n- A bullet that runs\n  over two lines\n- Short\n",
    ),
    [
      {
        version: "26.2",
        date: "2026-11-20",
        text: "A bullet that runs over two lines. Short.",
      },
    ],
  ),
  "wrapped bullet: one line, one full stop at its end",
);

console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
