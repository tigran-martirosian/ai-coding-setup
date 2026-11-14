// Reads CHANGELOG.md into its releases, newest first, as the file lists them: [{ version, date, text }].
// Two forms are read, also mixed in one file:
//   ## [26.1] - 2026-11-13          a heading per version (from 26.1 on); its text is the lines under it, a bullet's
//   - Short bullet.                 "- " taken off and the lines joined into one, each ending in a full stop; an
//     indented line goes on.        indented line that is no bullet goes on the bullet above it, before its stop
//   - 1.0.84 (Nov 3, 2026): text    one line per version (the form before 26.1)
// A heading's first bullet may be a bridge line in the old form with the heading's version, "- 26.2 (Nov 20, 2026):
// text": the update check of a 26.1 install reads only old-form lines, so this line carries the notes to it. Its
// text is read as a bullet; a bridge line with another version than its heading throws.
// `date` is YYYY-MM-DD in both. `## [Unreleased]` (`## Unreleased` in the old form) and `## Before 1.0.0 - …` hold
// no version and are skipped.
// A changelog with another heading, an unreadable date, a version twice or no version at all throws, with the line.
// Used by hooks/update-check.mjs (the missed notes) and skills/update-setup/update.mjs (--files-only).

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const HEADING = /^## \[(\d+(?:\.\d+)*)\] - (\d{4}-\d{2}-\d{2})$/;
const OLD_LINE = /^- (\d+(?:\.\d+)*) \(([^)]*)\): (.+)$/;
const NO_VERSION = /^## (\[Unreleased\]|Unreleased|Before \d+(?:\.\d+)* - .+)$/;

// "Nov 3, 2026" → "2026-11-03"; anything else throws
function isoDate(words, where) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(words);
  const month = m && MONTHS.indexOf(m[1]) + 1;
  if (!month || Number(m[2]) < 1 || Number(m[2]) > 31)
    throw new Error(
      `CHANGELOG.md ${where}: the date "${words}" is not like "Nov 3, 2026"`,
    );
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// "2026-11-01" → "Nov 1, 2026", for a line the user reads; an answer stored before 26.2 already holds "Nov 1, 2026"
export function shownDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : date;
}

export function readChangelog(changelog) {
  const releases = [];
  let open = null; // the heading release whose lines are being read, or null under a section with no version
  const close = () => {
    if (!open) return;
    const items = [];
    for (const l of open.lines) {
      const t = l.trim();
      if (!t) continue;
      if (/^\s/.test(l) && !t.startsWith("- ") && items.length)
        items[items.length - 1] += ` ${t}`;
      else items.push(l.replace(/^- /, "").trim());
    }
    const text = items.map((l) => (/[.!?:]$/.test(l) ? l : `${l}.`)).join(" ");
    if (!text)
      throw new Error(
        `CHANGELOG.md line ${open.at}: version ${open.version} has no text under its heading`,
      );
    releases.push({ version: open.version, date: open.date, text });
    open = null;
  };
  String(changelog)
    .split(/\r?\n/)
    .forEach((line, i) => {
      const where = `line ${i + 1}`;
      let m;
      if (line.startsWith("## ")) {
        close();
        if ((m = HEADING.exec(line)))
          open = { version: m[1], date: m[2], at: i + 1, lines: [] };
        else if (!NO_VERSION.test(line))
          throw new Error(
            `CHANGELOG.md ${where}: the heading "${line}" is not "## [<version>] - YYYY-MM-DD", "## [Unreleased]" or "## Before <version> - …"`,
          );
      } else if (
        (m = OLD_LINE.exec(line)) &&
        open &&
        !open.lines.some((l) => l.trim())
      ) {
        if (m[1] !== open.version)
          throw new Error(
            `CHANGELOG.md ${where}: the line "${line}" opens version ${open.version} but names version ${m[1]}`,
          );
        isoDate(m[2], where);
        open.lines.push(`- ${m[3]}`);
      } else if (m) {
        close();
        releases.push({
          version: m[1],
          date: isoDate(m[2], where),
          text: m[3].trim(),
        });
      } else if (open) open.lines.push(line);
    });
  close();
  if (!releases.length)
    throw new Error(
      'CHANGELOG.md has no version: no "## [<version>] - YYYY-MM-DD" heading and no "- <version> (<date>): <text>" line',
    );
  const seen = new Set();
  for (const r of releases) {
    if (seen.has(r.version))
      throw new Error(`CHANGELOG.md lists version ${r.version} twice`);
    seen.add(r.version);
  }
  return releases;
}
