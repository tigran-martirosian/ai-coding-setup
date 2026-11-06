// Tests for hooks/lib/map-file.mjs: loadMap, normRel, mapFolderFor.
// Run: node tests/test-map-file.mjs
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { MAP_REL, loadMap, normRel, mapFolderFor } = await import(pathToFileURL(fileURLToPath(new URL("../hooks/lib/map-file.mjs", import.meta.url))).href);
const dir = mkdtempSync(join(tmpdir(), "map-file-"));
let fail = 0, total = 0;
const report = (ok, name) => { total++; if (!ok) fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
const put = (root, text) => { mkdirSync(join(root, ".claude"), { recursive: true }); writeFileSync(join(root, MAP_REL), text); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

report(MAP_REL === ".claude/systems-map.json", "MAP_REL names the map file");

// loadMap
const proj = join(dir, "proj");
mkdirSync(proj);
report(loadMap(proj) === null, "loadMap: no map file gives null");
put(proj, '﻿{"nodes":[{"id":"a"}]}');
report(same(loadMap(proj), { nodes: [{ id: "a" }] }), "loadMap: reads a map, BOM and all");
put(proj, "{ not json");
let threw = false;
try { loadMap(proj); } catch { threw = true; }
report(threw, "loadMap: invalid JSON throws");

// normRel
report(normRel(".\\Src\\Cart.JS") === "src/cart.js", "normRel: slashes, ./ and case");
report(normRel("././a/B") === "a/b", "normRel: several ./ at the start");
report(normRel(undefined) === "" && normRel(5) === "", "normRel: a non-string gives empty");

// mapFolderFor
put(proj, "{}");
const inside = mapFolderFor(proj, "src/Cart.js");
report(inside && inside.dir === proj && inside.rel === "src/Cart.js" && inside.file === join(proj, "src", "Cart.js"), "mapFolderFor: a file in the project (relative) keeps its case");
const abs = mapFolderFor(proj, join(proj, "a", "b.js"));
report(abs && abs.rel === "a/b.js", "mapFolderFor: an absolute path in the project");
const wt = join(dir, "worktrees", "w1");
mkdirSync(wt, { recursive: true });
const outsideNoMap = mapFolderFor(proj, join(wt, "x.js"));
report(outsideNoMap === null, "mapFolderFor: a file outside the project with no map above it gives null");
put(join(dir, "worktrees"), "{}");
const up = mapFolderFor(proj, join(wt, "x.js"));
report(up && up.dir === join(dir, "worktrees") && up.rel === "w1/x.js", "mapFolderFor: a file outside the project uses the nearest map above it");
report(mapFolderFor(proj, proj) === null, "mapFolderFor: the project folder itself is no file");

rmSync(dir, { recursive: true, force: true });
console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
