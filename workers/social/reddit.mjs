#!/usr/bin/env node
// reddit.mjs: reads several Reddit threads at once from Arctic Shift's open archive API
// (arctic-shift.photon-reddit.com, through social.mjs's redditThread), no browser; read only. Search is
// `node ~/.claude/workers/social/social.mjs search reddit` (the signed-in Chrome: no open route searches Reddit).
//   node ~/.claude/workers/social/reddit.mjs read <id or url>... [--save <dir>] [--comments 12]
//       each thread's post and top comments, uncut, five threads at a time. --save <dir> (from the current
//       folder) also writes each thread as reddit-<id>.json there.
// Every thread it reads is printed as "OPENED <url>". A thread the archive cannot give is printed as UNREAD with
// the reason; no other route is tried.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redditThread, Stop } from "./social.mjs"; // social.mjs imports digest from here: only functions cross, so the cycle is safe
import { wall, wallMessage } from "./walls.mjs";

const AT_ONCE = 5;

const day = (utc) =>
  utc ? new Date(utc * 1000).toISOString().slice(0, 10) : "date not found";
const one = (s, n) => {
  const t = String(s || "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

// A Reddit thread's id from a link (/comments/<id>, redd.it/<id>) or a bare id; "" when there is none
export const threadId = (s) =>
  (/(?:\/comments\/|redd\.it\/)([a-z0-9]{5,10})/i.exec(s) ||
    /^([a-z0-9]{5,10})$/i.exec(s) ||
    [])[1]?.toLowerCase() || "";

// The lines printed for one thread: its post and its comments, replies indented
export function digest(
  rows,
  { title = "", sub = "", created = 0, comments = 12, chars = 20000 } = {},
) {
  const post = rows.find((r) => r.type === "POST") || {};
  const lines = [
    `${title || one(post.text, 120)} | ${sub || "Reddit"} | ${day(created)} | ${post.score ?? "?"} points`,
  ];
  const body = String(post.text || "")
    .split("\n")
    .slice(1)
    .join(" ");
  if (body.trim()) lines.push(`post: ${one(body, Infinity)}`);
  let top = 0;
  for (const r of rows) {
    const level = /^L(\d)$/.exec(r.type || "");
    if (
      !level ||
      /^\s*\[\+\d+ more repl/.test(r.text || "") ||
      !String(r.text || "").trim()
    )
      continue;
    if (level[1] === "0" && ++top > comments) break;
    lines.push(
      `${"  ".repeat(Number(level[1]))}- [${r.score === "" ? "?" : r.score}] ${one(r.text, chars)}`,
    );
  }
  if (!top) lines.push("(no comments)");
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : fallback;
  };
  const save = opt("--save", ""),
    comments = Number(opt("--comments", "12")) || 12;
  const [command, ...rest] = args;

  if (command === "read" && rest.length) {
    const ids = [...new Set(rest.map(threadId).filter(Boolean))];
    const saveDir = save ? path.resolve(process.cwd(), save) : "";
    if (saveDir) fs.mkdirSync(saveDir, { recursive: true });
    const results = new Array(ids.length);
    let next = 0;
    let walled = null; // the first rate limit or block: no further thread is fetched
    const worker = async () => {
      for (let i = next++; i < ids.length && !walled; i = next++) {
        try {
          results[i] = await redditThread(ids[i], { comments });
        } catch (e) {
          if (!(e instanceof Stop)) throw e;
          results[i] = { error: e.message };
          const w = wall(e.message);
          if (w && !walled) walled = { what: w, detail: one(e.message, 300) };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(AT_ONCE, ids.length) }, worker),
    );
    ids.forEach((id, i) => {
      const r = results[i];
      if (!r) return; // not fetched: a wall came first
      if (i) console.log("");
      if (r.error) {
        console.log(`UNREAD ${id} (${r.error})`);
        process.exitCode = 1;
        return;
      }
      console.log(`OPENED ${r.url}`);
      console.log(r.lines.join("\n"));
      if (saveDir)
        fs.writeFileSync(
          path.join(saveDir, `reddit-${id}.json`),
          JSON.stringify(
            {
              id,
              url: r.url,
              title: r.title,
              sub: r.sub,
              created: r.created,
              rows: r.rows,
            },
            null,
            1,
          ),
        );
    });
    if (walled) {
      console.log(`
FAILED: ${wallMessage("Reddit", walled.what, walled.detail)}`);
      process.exitCode = 1;
    }
    return;
  }

  console.log(
    "Usage: node ~/.claude/workers/social/reddit.mjs read <id or url>... [--save <dir>] [--comments 12]",
  );
  process.exitCode = 2;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
