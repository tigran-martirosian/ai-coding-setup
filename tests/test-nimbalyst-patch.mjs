// node tests/test-nimbalyst-patch.mjs
// The patcher's core on a fake install (tests/lib/nimbalyst-patch-fixture.mjs): apply, a second run, restore,
// a patch that grew, a changed anchor, all-or-nothing, retired and dry run. Guards: test-nimbalyst-patch-guards.mjs;
// the real patch files: test-nimbalyst-patch-real.mjs.
import fs from "node:fs";
import {
  check,
  cleanup,
  DEP,
  hashOf,
  LABEL,
  MAIN,
  MAINP,
  makeApp,
  patchDir,
  R_CHUNKS,
  R_MAIN,
  readAsar,
  run,
  stateOf,
  summary,
} from "./lib/nimbalyst-patch-fixture.mjs";

try {
  // 1. apply: three patches, the third needs the second
  const A = makeApp("apply"),
    before = hashOf(A.asar),
    orig = readAsar(A.asar);
  const ALL = patchDir("all", { label: LABEL, main: MAINP, dep: DEP });
  let st = run(["--status", "--app", A.res, "--patches", ALL]);
  check(
    "status before: version, no marker, fuse off, per-user, all would apply",
    st.code === 0 &&
      /Nimbalyst 0\.83\.0/.test(st.out) &&
      /marker: none/.test(st.out) &&
      /IntegrityValidation: off/.test(st.out) &&
      /install: per-user/.test(st.out) &&
      ["label", "main", "dep"].every((id) =>
        stateOf(st.out, id).startsWith("would apply"),
      ),
    st.out,
  );
  let r = run(["--app", A.res, "--patches", ALL]);
  const got = readAsar(A.asar);
  check(
    "apply: exit 0, all three applied now",
    r.code === 0 &&
      ["label", "main", "dep"].every((id) =>
        stateOf(r.out, id).startsWith("applied now"),
      ),
    r.out,
  );
  check(
    "apply: the renderer chunk has the new label",
    got["out/renderer/assets/index-AAAA1111.js"].data
      .toString()
      .includes('"Changed Files"'),
  );
  check(
    "apply: main has both edits and the dependant's edit",
    got["out/main/index.js"].data.toString() ===
      MAIN.replace("return a;}", "return a.slice().sort();}").replace(
        'label: "Edited Files"',
        'label: "Changed Files", patched: true, dep: 1',
      ),
  );
  check(
    "apply: untouched files are byte-identical (package.json, preload, other chunk, binary icon)",
    [
      "package.json",
      "out/preload/index.js",
      "out/renderer/assets/index-BBBB2222.js",
      "icon.png",
    ].every(
      (p) =>
        got[p].data.equals(orig[p].data) &&
        JSON.stringify(got[p].entry.integrity) ===
          JSON.stringify(orig[p].entry.integrity),
    ),
  );
  check(
    "apply: changed files lost their stale integrity, sizes match",
    ["out/main/index.js", "out/renderer/assets/index-AAAA1111.js"].every(
      (p) =>
        !got[p].entry.integrity && got[p].entry.size === got[p].data.length,
    ),
  );
  check(
    "apply: the unpacked entry is kept as it was",
    JSON.stringify(got["node_modules/sdk/claude.exe"].entry) ===
      JSON.stringify(orig["node_modules/sdk/claude.exe"].entry),
  );
  check(
    "apply: app.asar.orig is the original, byte for byte; no tmp left",
    hashOf(A.orig) === before && !fs.existsSync(A.asar + ".patched-tmp"),
  );
  const marker = JSON.parse(fs.readFileSync(A.marker, "utf8"));
  check(
    "apply: marker has the version and the applied patches",
    marker.version === "0.83.0" && marker.patches.join() === "main,dep,label",
    JSON.stringify(marker),
  );
  st = run(["--status", "--app", A.res, "--patches", ALL]);
  check(
    "status after: all applied, marker and backup shown",
    ["label", "main", "dep"].every((id) =>
      stateOf(st.out, id).startsWith("applied"),
    ) &&
      /marker: 0\.83\.0, patches main, dep, label/.test(st.out) &&
      /app\.asar\.orig: present/.test(st.out),
    st.out,
  );

  // 2. a second run changes nothing
  const once = hashOf(A.asar),
    markerOnce = fs.readFileSync(A.marker, "utf8");
  r = run(["--app", A.res, "--patches", ALL]);
  check(
    "second apply: already applied, app.asar byte-identical, backup and marker unchanged",
    r.code === 0 &&
      /already applied/.test(r.out) &&
      hashOf(A.asar) === once &&
      hashOf(A.orig) === before &&
      fs.readFileSync(A.marker, "utf8") === markerOnce,
    r.out,
  );

  // 3. restore
  r = run(["--restore", "--app", A.res]);
  check(
    "restore: the original is back, backup and marker gone",
    r.code === 0 &&
      hashOf(A.asar) === before &&
      !fs.existsSync(A.orig) &&
      !fs.existsSync(A.marker),
    r.out,
  );
  r = run(["--restore", "--app", A.res]);
  check(
    "restore without a backup: clear error, exit 1",
    r.code === 1 && /app\.asar\.orig does not exist/.test(r.out),
    r.out,
  );

  // 3b. a patch that gained an edit since it was applied: apply plans again on app.asar.orig and puts it in
  const G = makeApp("grown"),
    gBefore = hashOf(G.asar);
  const ONE = `files: ${R_MAIN}, edits: [{ anchor: "function sortThemes(a){return a;}", replace: "function sortThemes(a){return a.slice().sort();}" }], upstream: "UPSTREAM_SORT_FIX"`;
  const G1 = patchDir("grown1", { label: LABEL, main: ONE });
  r = run(["--app", G.res, "--patches", G1]);
  check(
    "grown patch: first apply puts the one-edit version in",
    r.code === 0 && stateOf(r.out, "main").startsWith("applied now"),
    r.out,
  );
  const G2 = patchDir("grown2", { label: LABEL, main: MAINP });
  st = run(["--status", "--app", G.res, "--patches", G2]);
  check(
    "grown patch: status shows it partly applied",
    /^SKIPPED, partly applied \(1 of 2 edits\)/.test(stateOf(st.out, "main")),
    st.out,
  );
  r = run(["--app", G.res, "--patches", G2]);
  const gGot = readAsar(G.asar)["out/main/index.js"].data.toString();
  check(
    "grown patch: apply rebuilds from app.asar.orig, both edits in once, label still in, backup untouched",
    r.code === 0 &&
      /patch main was partly applied: every patch planned again on/.test(
        r.out,
      ) &&
      stateOf(r.out, "main").startsWith("applied now") &&
      stateOf(r.out, "label").startsWith("applied now") &&
      gGot ===
        MAIN.replace("return a;}", "return a.slice().sort();}").replace(
          'label: "Edited Files"',
          'label: "Changed Files", patched: true',
        ) &&
      readAsar(G.asar)
        ["out/renderer/assets/index-AAAA1111.js"].data.toString()
        .includes('"Changed Files"') &&
      hashOf(G.orig) === gBefore,
    r.out,
  );
  r = run(["--app", G.res, "--patches", G2]);
  check(
    "grown patch: the next apply finds everything applied",
    r.code === 0 && /already applied/.test(r.out),
    r.out,
  );
  fs.rmSync(G.orig);
  const G3 = patchDir("grown3", {
    label: LABEL,
    main: MAINP.replace("patched: true", "patched: 2"),
  });
  r = run(["--app", G.res, "--patches", G3]);
  check(
    "grown patch without app.asar.orig: skipped, nothing written",
    r.code === 0 && /^SKIPPED, partly applied/.test(stateOf(r.out, "main")),
    r.out,
  );

  // 3c. a dependant that rewrites the middle of its base patch's replace text: status still shows both applied
  const O = makeApp("overlap");
  const OVER = `files: ${R_MAIN}, requires: ["main"], edits: [{ anchor: '"Changed Files", patched', replace: '"Changed Files!", patched' }], upstream: "UPSTREAM_OVER_FIX"`;
  const OD = patchDir("overlap", { main: MAINP, over: OVER });
  r = run(["--app", O.res, "--patches", OD]);
  st = run(["--status", "--app", O.res, "--patches", OD]);
  check(
    "overlap: after apply, status shows the base patch and the dependant applied, not partly",
    r.code === 0 &&
      readAsar(O.asar)["out/main/index.js"].data.toString().includes('"Changed Files!", patched: true') &&
      ["main", "over"].every((id) => stateOf(st.out, id).startsWith("applied")),
    r.out + st.out,
  );

  // 4. a changed anchor skips the patch and its dependant; an anchor found twice skips too; others still apply
  const S = makeApp("skip"),
    sBefore = hashOf(S.asar);
  const SK = patchDir("skip", {
    label: LABEL,
    main: MAINP.replace(
      "function sortThemes(a){return a;}",
      "function sortThemes(list){return list;}",
    ),
    dep: DEP,
    twice: `files: ${R_CHUNKS}, edits: [{ anchor: "export const", replace: "export let" }], upstream: "UPSTREAM_TWICE"`,
  });
  r = run(["--app", S.res, "--patches", SK]);
  check(
    "changed anchor: SKIPPED with the anchor named",
    r.code === 0 &&
      /^SKIPPED, anchor changed: "function sortThemes\(list\)/.test(
        stateOf(r.out, "main"),
      ),
    r.out,
  );
  check(
    "changed anchor: the dependant is skipped through requires",
    /^SKIPPED, requires main, which was skipped/.test(stateOf(r.out, "dep")),
    r.out,
  );
  check(
    "anchor found twice: SKIPPED",
    /^SKIPPED, anchor changed: "export const" found 2x in 2 matching/.test(
      stateOf(r.out, "twice"),
    ),
    r.out,
  );
  const sGot = readAsar(S.asar);
  check(
    "changed anchor: the other patch applied, main left as it was",
    stateOf(r.out, "label").startsWith("applied now") &&
      sGot["out/main/index.js"].data.toString() === MAIN &&
      hashOf(S.orig) === sBefore,
    r.out,
  );

  // 5. all-or-nothing, retired, dry run: nothing written
  const N = makeApp("none"),
    nBefore = hashOf(N.asar);
  const NP = patchDir("none", {
    half: `files: ${R_MAIN}, edits: [{ anchor: "function sortThemes(a){return a;}", replace: "function sortThemes(a){return [];}" }, { anchor: "NOT_THERE", replace: "X" }], upstream: "UPSTREAM_HALF"`,
    gone: `files: ${R_MAIN}, edits: [{ anchor: 'label: "Edited Files"', replace: 'label: "Gone"' }], upstream: "module.exports = { label"`,
  });
  r = run(["--app", N.res, "--patches", NP]);
  check(
    "all-or-nothing: the second edit's anchor is missing, so the first is not applied either",
    r.code === 0 &&
      /^SKIPPED, anchor changed: "NOT_THERE" found 0x/.test(
        stateOf(r.out, "half"),
      ) &&
      /nothing to apply/.test(r.out) &&
      hashOf(N.asar) === nBefore &&
      !fs.existsSync(N.orig) &&
      !fs.existsSync(N.marker),
    r.out,
  );
  check(
    "retired: the upstream text is there",
    /^RETIRED/.test(stateOf(r.out, "gone")),
    r.out,
  );
  r = run(["--dry-run", "--app", N.res, "--patches", ALL]);
  check(
    "dry run: reports, compiles, writes nothing",
    r.code === 0 &&
      /dry run: 2 file\(s\) would change and compile; nothing written/.test(
        r.out,
      ) &&
      hashOf(N.asar) === nBefore &&
      !fs.existsSync(N.orig),
    r.out,
  );
} finally {
  cleanup();
}
summary();
