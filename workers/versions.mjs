#!/usr/bin/env node
// versions: answers "what is the current version of X" and "is version Y available" from the places
// that actually know - the project's own release list or registry - instead of a search engine or a
// model's memory. Every answer carries the URL it came from and the date, and a lookup that fails says
// so loudly rather than guessing (measured 2026-10-27: a search engine gave stale June figures and a
// free LLM worker gave the major version without the current minor, while these calls answer exactly
// in under a second).
//
//   versions.mjs <target>...                 current version(s) of each target
//   versions.mjs <target> --has <version>    is that version there? prints YES or NO and the evidence
//   versions.mjs <target> --all              every version, not just the newest few
//   versions.mjs --list                      the target forms
//
// A NO is only ever "not in this list", never "it does not exist": endoflife.date carries no betas or
// release candidates at all, and no source here is guaranteed to have a release from the last few hours.
// A YES that is only a pre-release says PRE-RELEASE in as many words (npm, PyPI, GitHub releases and
// NuGet all list them). Never turn a NO from here into "unavailable" without reading the project's page.
//
// Target forms:
//   postgresql            end-of-life database: every supported branch, its latest version and EOL date
//   gh:owner/repo         GitHub releases, newest first (falls back to tags when there are no releases)
//   npm:name              npm registry
//   pypi:name             Python package index
//   crates:name           crates.io
//   docker:image          Docker Hub tags (library images: docker:postgres)
//   mvn:group:artifact    Maven Central
//   nuget:name            NuGet
//   <bare name>           tries the end-of-life database, then npm, then PyPI, and says which answered
//
// Exit codes: 0 answered; 2 bad usage; 4 nothing could answer (the message says what to try instead);
//             5 --has was asked and the answer is NO.
import { argv, exit } from "node:process";

const UA = { "User-Agent": "claude-versions-check", Accept: "application/json" };
const TIMEOUT_MS = 20000;
let SHOW_ALL = false; // set by main(); the end-of-life source reads it when it builds its rows

async function getJson(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: UA, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const day = (s) => (s ? String(s).slice(0, 10) : "");

// Each source returns { source, lines: [...], versions: [...] } or throws
const SOURCES = {
  async eol(name) {
    const url = `https://endoflife.date/api/v1/products/${encodeURIComponent(name)}/`;
    const { result } = await getJson(url);
    const versions = [];
    const row = (r) => `  ${r.name.padEnd(8)} latest ${String(r.latest?.name || "?").padEnd(10)} ` +
      `released ${day(r.latest?.date)}  ends ${day(r.eolFrom) || "-"}  ${r.isMaintained ? "supported" : "END OF LIFE"}`;
    for (const r of result.releases) versions.push(r.latest?.name, r.name);
    // Only the branches a person can still use, unless --all: the dead ones go back decades
    const live = result.releases.filter((r) => r.isMaintained);
    const shown = SHOW_ALL ? result.releases : (live.length ? live : result.releases.slice(0, 5));
    const lines = shown.map(row);
    if (!SHOW_ALL && shown.length < result.releases.length) {
      lines.push(`  (${result.releases.length - shown.length} older branches are end-of-life; --all lists them)`);
    }
    return { source: `https://endoflife.date/${name}`, versions, label: `${result.label || name} (end-of-life database)`, lines };
  },

  async gh(repo) {
    if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error(`gh: needs owner/repo, got "${repo}"`);
    const rels = await getJson(`https://api.github.com/repos/${repo}/releases?per_page=20`);
    if (Array.isArray(rels) && rels.length) {
      return {
        source: `https://github.com/${repo}/releases`,
        label: `${repo} (GitHub releases)`,
        versions: rels.map((r) => r.tag_name).concat(rels.map((r) => r.name)),
        lines: rels.map((r) => `  ${String(r.tag_name).padEnd(20)} ${day(r.published_at)}` +
          `${r.prerelease ? "  (pre-release)" : ""}${r.draft ? "  (draft)" : ""}`),
      };
    }
    const tags = await getJson(`https://api.github.com/repos/${repo}/tags?per_page=20`);
    if (!Array.isArray(tags) || !tags.length) throw new Error(`${repo} has no releases and no tags`);
    return {
      source: `https://github.com/${repo}/tags`,
      label: `${repo} (GitHub tags - this repo publishes no releases)`,
      versions: tags.map((t) => t.name),
      lines: tags.map((t) => `  ${t.name}`),
    };
  },

  async npm(name) {
    const d = await getJson(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
    const tags = d["dist-tags"] || {};
    const all = Object.keys(d.versions || {});
    // "latest" is the one that matters, so it goes first whatever order the registry used
    const order = ["latest", ...Object.keys(tags).filter((t) => t !== "latest")];
    return {
      source: `https://www.npmjs.com/package/${name}`,
      label: `${name} (npm)`,
      versions: all.concat(Object.values(tags)),
      lines: [
        ...order.filter((t) => tags[t]).map((t) => `  ${t.padEnd(12)} ${tags[t]}  (published ${day(d.time?.[tags[t]])})`),
        `  ${String(all.length)} versions in all, oldest ${all[0] || "?"}`,
      ],
    };
  },

  async pypi(name) {
    const d = await getJson(`https://pypi.org/pypi/${name}/json`);
    const all = Object.keys(d.releases || {});
    const files = d.releases?.[d.info.version] || [];
    return {
      source: `https://pypi.org/project/${name}/`,
      label: `${name} (PyPI)`,
      versions: all.concat([d.info.version]),
      lines: [
        `  latest       ${d.info.version}  (uploaded ${day(files[0]?.upload_time)})`,
        `  requires     Python ${d.info.requires_python || "unstated"}`,
        `  ${all.length} versions in all`,
      ],
    };
  },

  async crates(name) {
    const d = await getJson(`https://crates.io/api/v1/crates/${name}`);
    return {
      source: `https://crates.io/crates/${name}`,
      label: `${name} (crates.io)`,
      versions: (d.versions || []).map((v) => v.num).concat([d.crate?.max_stable_version]),
      lines: [
        `  latest stable ${d.crate?.max_stable_version}  (newest including pre-release: ${d.crate?.max_version})`,
        `  updated       ${day(d.crate?.updated_at)}`,
      ],
    };
  },

  async docker(image) {
    const repo = image.includes("/") ? image : `library/${image}`;
    const d = await getJson(`https://hub.docker.com/v2/repositories/${repo}/tags?page_size=40&ordering=last_updated`);
    const tags = (d.results || []).map((t) => t.name);
    return {
      source: `https://hub.docker.com/r/${repo}/tags`,
      label: `${image} (Docker Hub, 40 newest tags)`,
      versions: tags,
      lines: [`  ${tags.join(", ")}`],
    };
  },

  async mvn(coord) {
    const [g, a] = coord.split(":");
    if (!g || !a) throw new Error(`mvn: needs group:artifact, got "${coord}"`);
    const d = await getJson(`https://search.maven.org/solrsearch/select?q=g:"${g}"+AND+a:"${a}"&core=gav&rows=20&wt=json`);
    const docs = d.response?.docs || [];
    if (!docs.length) throw new Error(`nothing on Maven Central for ${coord}`);
    return {
      source: `https://central.sonatype.com/artifact/${g}/${a}/versions`,
      label: `${coord} (Maven Central)`,
      versions: docs.map((x) => x.v),
      lines: docs.map((x) => `  ${String(x.v).padEnd(18)} ${day(new Date(x.timestamp).toISOString())}`),
    };
  },

  async nuget(name) {
    const d = await getJson(`https://api.nuget.org/v3-flatcontainer/${name.toLowerCase()}/index.json`);
    const all = d.versions || [];
    return {
      source: `https://www.nuget.org/packages/${name}`,
      label: `${name} (NuGet)`,
      versions: all,
      lines: [`  latest ${all.at(-1)}`, `  ${all.length} versions in all`],
    };
  },
};

const PREFIXED = /^(gh|npm|pypi|crates|docker|mvn|nuget|eol):(.+)$/;
const BARE_ORDER = ["eol", "npm", "pypi"];

async function resolve(target) {
  const m = PREFIXED.exec(target);
  if (m) {
    const [, kind, rest] = m;
    return { ...(await SOURCES[kind](rest)), tried: [kind] };
  }
  const problems = [];
  for (const kind of BARE_ORDER) {
    try {
      return { ...(await SOURCES[kind](target)), tried: [kind] };
    } catch (e) {
      problems.push(`${kind}: ${e.message}`);
    }
  }
  const err = new Error(`no source knows "${target}"\n  ${problems.join("\n  ")}\n` +
    `  Name the source instead: gh:owner/repo, npm:name, pypi:name, crates:name, docker:image, mvn:group:artifact, nuget:name.\n` +
    `  Or read the project's own download page with WebFetch.`);
  err.exhausted = true;
  throw err;
}

const clean = (v) => String(v).replace(/^v/i, "");
// A version nobody should be told is "available" without the word pre-release next to it.
// Covers npm/semver (`-rc1`, `-beta.2`), PEP 440 (`4.0.0a1`, `5.0.0.dev1`) and Maven (`-SNAPSHOT`).
export const isPreRelease = (v) =>
  /[-._](?:alpha|beta|rc|dev|pre|next|canary|nightly|snapshot)[.\d]*\b/i.test(clean(v)) ||
  /-(?:a|b)[.\d]/i.test(clean(v)) ||
  /\d+(?:a|b|rc|dev)\d+/i.test(clean(v));

// Newest first, so the evidence quoted for a YES is the current version and not the oldest alpha.
// When one side runs out of parts, what the other side has next decides: a further number means it is
// newer (4.4.1 > 4.4), a word means it is a pre-release and therefore older (4.4.0 > 4.4.0-rc1).
export function byVersionDesc(a, b) {
  const parts = (v) => clean(v).split(/[.\-+]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (x === undefined) return typeof y === "number" ? 1 : -1;
    if (y === undefined) return typeof x === "number" ? -1 : 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return y - x;
    if (typeof x === "number") return -1; // 4.4.0 beats 4.4.0-rc1
    if (typeof y === "number") return 1;
    return String(y).localeCompare(String(x));
  }
  return 0;
}

// Does this version appear? Exact match first, then "18" matching "18.6". A match that is only ever a
// pre-release says so: npm, PyPI, GitHub releases and NuGet all list them, so a bare YES would mislead.
export function hasVersion(versions, want) {
  const list = [...new Set(versions.filter(Boolean).map(String))];
  const w = clean(want);
  const exact = list.find((v) => clean(v) === w);
  if (exact) {
    return isPreRelease(exact)
      ? { yes: true, how: "exact match, but it is a PRE-RELEASE (not a stable release)", match: exact, preRelease: true }
      : { yes: true, how: "exact match", match: exact };
  }
  const family = list.filter((v) => clean(v).startsWith(`${w}.`)).sort(byVersionDesc);
  if (!family.length) return { yes: false, how: "", match: "" };
  const stable = family.filter((v) => !isPreRelease(v));
  if (!stable.length) {
    return {
      yes: true, preRelease: true,
      how: `only as a PRE-RELEASE - there is no stable ${w} release in this list`,
      match: family.slice(0, 6).join(", "),
    };
  }
  return { yes: true, how: `the ${w} series is there`, match: stable.slice(0, 6).join(", ") };
}

async function main(args) {
  SHOW_ALL = args.includes("--all");
  if (args.includes("--list")) {
    console.log(`Target forms: ${Object.keys(SOURCES).join(", ")} (as prefix:value), or a bare name ` +
      `(tried against ${BARE_ORDER.join(", then ")}).`);
    return 0;
  }
  let want = null;
  const rest = [...args];
  const hasAt = rest.indexOf("--has");
  if (hasAt !== -1) {
    want = rest[hasAt + 1];
    if (!want || want.startsWith("--")) { console.error("[versions] --has needs a version number"); return 2; }
    rest.splice(hasAt, 2);
  }
  const targets = rest.filter((a) => !a.startsWith("--"));
  if (!targets.length) {
    console.error(`[versions] give at least one target. Usage: versions.mjs <target>... [--has <version>]\n` +
      `  e.g. versions.mjs postgresql --has 18   |   versions.mjs gh:sqlfluff/sqlfluff npm:sql-formatter`);
    return 2;
  }
  if (want && targets.length > 1) { console.error("[versions] --has takes one target at a time"); return 2; }

  let worst = 0;
  for (const target of targets) {
    let answer;
    try {
      answer = await resolve(target);
    } catch (e) {
      console.error(`\n[versions] ${target}: ${e.message}`);
      worst = Math.max(worst, 4);
      continue;
    }
    console.log(`\n${answer.label}`);
    for (const l of answer.lines) console.log(l);
    console.log(`  source: ${answer.source}   checked ${new Date().toISOString().slice(0, 10)}`);
    if (want) {
      const v = hasVersion(answer.versions, want);
      if (v.yes) {
        console.log(`\n  Is ${want} available? YES - ${v.how}: ${v.match}`);
      } else {
        console.log(`\n  Is ${want} available? NO - ${want} is not in this list.` +
          `\n  This does NOT mean it does not exist. This list may not carry betas and release candidates` +
          `\n  (endoflife.date never does), a release from the last few hours, or a build published elsewhere.` +
          `\n  Before saying it is unavailable, read ${answer.source} or the project's own download page.`);
        worst = Math.max(worst, 5);
      }
    }
  }
  return worst;
}

// Only when run as the command, so a test can import hasVersion without the CLI firing
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  // exit() while fetch's handles are still closing crashes libuv on Windows; exitCode lets Node end cleanly
  process.exitCode = await main(argv.slice(2));
}
