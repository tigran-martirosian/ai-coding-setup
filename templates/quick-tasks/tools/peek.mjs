#!/usr/bin/env node
// peek.mjs: open pages in the hunt's browser session, one after another, and print each one's
// address, title and the start of its text. Give every page in one command: about 2 to 6 seconds a page.
//   node tools/peek.mjs <url>... [chars, default 600] [--find "words"] [--save <file>]
//   --find prints the text around a match. --save writes each page's whole text to <file> (several pages:
//   <file> with -1, -2 ... before its extension) and prints the path and its length, not the text.
//   It reads only through Nimbalyst's browser. When that can't be reached it stops and names
//   node ~/.claude/workers/read-page.mjs <url>, which reads a public page without a browser.
// Every page it opens is printed as "OPENED <url>"; the link gate counts those lines.
import fs from "node:fs";
import path from "node:path";
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
const urls = args.filter((a) => /^https?:\/\//i.test(a));
const chars = Number(args.find((a) => /^\d+$/.test(a))) || 600;
const usage =
  'Usage: node tools/peek.mjs <url>... [chars] [--find "words"] [--save <file>]';
if (!urls.length) {
  console.log(usage);
  process.exit(2);
}
if (process.argv.includes("--save") && (!save || /^https?:\/\//i.test(save))) {
  console.log(`--save needs a file. ${usage}`);
  process.exit(2);
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

let browser;
try {
  browser = await connect();
} catch (e) {
  console.log(
    `${e.message}\nFor a public page: node ~/.claude/workers/read-page.mjs <url> saves its words and prints the file.`,
  );
  process.exit(2);
}

try {
  for (const [n, url] of urls.entries()) {
    if (n) console.log("");
    try {
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
          // biome-ignore lint/performance/useDomNodeTextContent: innerText is the text as shown, which is what this reads
          const n = (document.body?.innerText || "").length;
          same = n && n === last ? same + 1 : 0;
          last = n;
        }
        return {
          url: location.href,
          title: document.title,
          // biome-ignore lint/performance/useDomNodeTextContent: innerText is the text as shown, which is what this reads
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
  browser.close();
}
