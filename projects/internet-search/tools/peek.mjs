#!/usr/bin/env node
// peek.mjs: open pages in the hunt's browser session, one after another, and print each one's
// address, title and the start of its text. Give every page in one command: about 2 to 6 seconds a page.
//   node tools/peek.mjs <url>... [chars, default 600] [--find "words"]   (--find prints the text around a match)
// Every page it opens is printed as "OPENED <url>"; the link gate counts those lines.
import { connect } from "./browser.mjs";

const args = process.argv.slice(2);
const fi = args.indexOf("--find");
const find = fi >= 0 ? args.splice(fi, 2)[1] : "";
const urls = args.filter((a) => /^https?:\/\//i.test(a));
const chars = Number(args.find((a) => /^\d+$/.test(a))) || 600;
if (!urls.length) { console.log('Usage: node tools/peek.mjs <url>... [chars] [--find "words"]'); process.exit(2); }

let browser;
try { browser = await connect(); } catch (e) { console.log(e.message); process.exit(2); }
try {
  for (const url of urls) {
    if (url !== urls[0]) console.log("");
    try {
      const err = await browser.go(url);
      if (err) { console.log(`DEAD ${url} (${err})`); continue; }
      const v = await browser.run(async ({ find, chars }) => {
        // Wait until the text stops growing (pages that fill in by script), at most 5 seconds
        let last = -1, same = 0;
        for (let i = 0; i < 10 && same < 2; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const n = (document.body?.innerText || "").length;
          same = n && n === last ? same + 1 : 0;
          last = n;
        }
        const b = document.body?.innerText || "";
        const i = find ? b.toLowerCase().indexOf(find.toLowerCase()) : 0;
        const from = Math.max(0, i - 150);
        return { url: location.href, title: document.title, found: i >= 0, text: b.slice(from, from + chars).replace(/\n+/g, " | ") };
      }, { find, chars });
      console.log(`OPENED ${url}\nnow at: ${v.url}\ntitle: ${v.title}${find ? `\nfound "${find}": ${v.found}` : ""}\ntext: ${v.text}`);
    } catch (e) {
      console.log(`UNREAD ${url} (${e.message})`);
      process.exitCode = 1;
    }
  }
} finally {
  browser.close();
}
