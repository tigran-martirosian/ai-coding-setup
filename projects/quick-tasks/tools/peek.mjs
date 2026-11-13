#!/usr/bin/env node
// peek.mjs: open pages in the hunt's browser session, one after another, and print each one's
// address, title and the start of its text. Give every page in one command: about 2 to 6 seconds a page.
//   node tools/peek.mjs <url>... [chars, default 600] [--find "words"] [--save <file>] [--engine nimbalyst|obscura]
//   --find prints the text around a match. --save writes each page's whole text to <file> (several pages:
//   <file> with -1, -2 ... before its extension) and prints the path and its length, not the text.
//   --engine obscura reads with Obscura, a headless browser that needs no Nimbalyst (signed out, no shared
//   sign-ins). Without --engine it is Nimbalyst's session, and Obscura when Nimbalyst can't be reached
//   (said on stderr). Obscura is found by OBSCURA (its full path), then ~/.claude/obscura, then the PATH.
// Every page it opens is printed as "OPENED <url>"; the link gate counts those lines.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { connect } from "./browser.mjs";

const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  if (i < 0) return "";
  const v = args.splice(i, 2)[1] || "";
  if (!v || v.startsWith("--")) {
    console.log(`${flag} needs a value.`);
    process.exit(2);
  }
  return v;
};
const find = take("--find");
const save = take("--save");
const engine = take("--engine");
const urls = args.filter((a) => /^https?:\/\//i.test(a));
const chars = Number(args.find((a) => /^\d+$/.test(a))) || 600;
const usage =
  'Usage: node tools/peek.mjs <url>... [chars] [--find "words"] [--save <file>] [--engine nimbalyst|obscura]';
if (!urls.length) {
  console.log(usage);
  process.exit(2);
}
if (process.argv.includes("--save") && (!save || /^https?:\/\//i.test(save))) {
  console.log(`--save needs a file. ${usage}`);
  process.exit(2);
}
if (engine && !["nimbalyst", "obscura"].includes(engine)) {
  console.log(`--engine ${engine}: not an engine. ${usage}`);
  process.exit(2);
}

// Obscura's program: OBSCURA, then the copy the setup's install puts in ~/.claude/obscura, then the PATH
function obscuraExe() {
  const name = process.platform === "win32" ? "obscura.exe" : "obscura";
  if (process.env.OBSCURA) {
    if (fs.existsSync(process.env.OBSCURA)) return process.env.OBSCURA;
    throw new Error(
      `OBSCURA is set to ${process.env.OBSCURA}, which does not exist`,
    );
  }
  const own = path.join(os.homedir(), ".claude", "obscura", name);
  if (fs.existsSync(own)) return own;
  return (
    (process.env.PATH || "")
      .split(path.delimiter)
      .map((d) => d && path.join(d, name))
      .find((p) => p && fs.existsSync(p)) || null
  );
}

// One page through Obscura, killed at 40 seconds (its own --timeout 30 does not always end a hung page)
function obscuraPage(exe, url) {
  return new Promise((resolve) => {
    const p = spawn(
      exe,
      ["fetch", url, "--dump", "markdown", "--timeout", "30"],
      { windowsHide: true },
    );
    let out = "",
      err = "",
      killed = false;
    // Decoded as one stream, so a character split between two chunks is not broken
    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.stderr.on("data", (d) => {
      err += d;
    });
    const timer = setTimeout(() => {
      killed = true;
      p.kill();
    }, 40000);
    p.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: e.message });
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (killed)
        return resolve({ error: "Obscura did not finish in 40 seconds" });
      // Its stderr says 'Page loaded: <url> - "<title>"'
      const loaded = err.match(/Page loaded: (\S+) - "(.*)"/);
      if (!out.trim()) {
        const why =
          err
            .replace(/\x1b\[[0-9;]*m/g, "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .pop() || `exit code ${code}`;
        return resolve({ error: `Obscura got no text: ${why.slice(0, 300)}` });
      }
      resolve({ url: loaded?.[1] || url, title: loaded?.[2] || "", body: out });
    });
  });
}

// --save: one page goes to the file given; several to <name>-1<ext>, <name>-2<ext> ...
const saveFile = (n) => {
  if (urls.length === 1) return save;
  const ext = path.extname(save);
  return `${save.slice(0, save.length - ext.length)}-${n + 1}${ext}`;
};

function show(url, v, n) {
  const i = find ? v.body.toLowerCase().indexOf(find.toLowerCase()) : 0;
  const head = `OPENED ${url}\nnow at: ${v.url}\ntitle: ${v.title}${find ? `\nfound "${find}": ${i >= 0}` : ""}`;
  if (save) {
    const file = path.resolve(saveFile(n));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, v.body);
    console.log(`${head}\nsaved: ${file} (${v.body.length} chars)`);
  } else {
    const from = Math.max(0, i - 150);
    console.log(
      `${head}\ntext: ${v.body.slice(from, from + chars).replace(/\n+/g, " | ")}`,
    );
  }
}

let browser = null,
  exe = null;
const noObscura =
  "Obscura, the fallback reader, is not installed (no OBSCURA, nothing in ~/.claude/obscura, none on the PATH); the setup's install puts it in";
if (engine !== "obscura") {
  try {
    browser = await connect();
  } catch (e) {
    if (engine === "nimbalyst") {
      console.log(e.message);
      process.exit(2);
    }
    try {
      exe = obscuraExe();
    } catch (o) {
      console.log(`${e.message}\nObscura can't stand in either: ${o.message}.`);
      process.exit(2);
    }
    if (!exe) {
      console.log(`${e.message}\n${noObscura}.`);
      process.exit(2);
    }
    console.error(
      `Nimbalyst's browser can't be reached (${e.message.split("\n")[0]}), so the pages are read with Obscura: signed out, no shared sign-ins.`,
    );
  }
} else {
  try {
    exe = obscuraExe();
  } catch (o) {
    console.log(o.message);
    process.exit(2);
  }
  if (!exe) {
    console.log(
      `${noObscura}. Without --engine, peek.mjs reads through Nimbalyst.`,
    );
    process.exit(2);
  }
}

try {
  for (const [n, url] of urls.entries()) {
    if (n) console.log("");
    try {
      if (exe) {
        const v = await obscuraPage(exe, url);
        if (v.error) {
          console.log(`UNREAD ${url} (${v.error})`);
          process.exitCode = 1;
          continue;
        }
        show(url, v, n);
        continue;
      }
      const err = await browser.go(url);
      if (err) {
        console.log(`DEAD ${url} (${err})`);
        continue;
      }
      const v = await browser.run(async () => {
        // Wait until the text stops growing (pages that fill in by script), at most 5 seconds
        let last = -1,
          same = 0;
        for (let i = 0; i < 10 && same < 2; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const n = (document.body?.innerText || "").length;
          same = n && n === last ? same + 1 : 0;
          last = n;
        }
        return {
          url: location.href,
          title: document.title,
          body: document.body?.innerText || "",
        };
      }, {});
      show(url, v, n);
    } catch (e) {
      console.log(`UNREAD ${url} (${e.message})`);
      process.exitCode = 1;
    }
  }
} finally {
  browser?.close();
}
