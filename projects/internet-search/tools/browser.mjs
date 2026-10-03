// browser.mjs: one hidden browser session for a hunt ("finder-hunt"), driven through Nimbalyst's
// DevTools port. It shares its sign-ins with every other Nimbalyst browser tab. The scripts open
// it themselves and each page load keeps it alive (Nimbalyst closes a hidden session after 5 idle
// minutes), so a hunt needs no browser_* tool call. Used by peek.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SESSION = "finder-hunt";
const HOME = `https://example.com/?${SESSION}`;
const TARGET_FILE = path.join(ROOT, "finds", ".browser-target");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class NoBrowser extends Error {}
const fail = (why) => new NoBrowser(
  `The hunt's browser session could not be used (${why}).\n` +
  `Open it by hand and run this again: browser_open_session { url: "${HOME}", sessionId: "${SESSION}", filePath: "${path.join(ROOT, "CLAUDE.md")}" }\n` +
  `(if it answers "already exists", send that session to the same URL with browser_navigate). If that fails too, read the pages with the browser_* tools.`);

async function socket(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, no) => { ws.addEventListener("open", ok); ws.addEventListener("error", () => no(fail("no connection to the page"))); });
  let id = 0;
  const pending = new Map();
  let waiters = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) { const hit = waiters.filter((w) => w.method === m.method); waiters = waiters.filter((w) => w.method !== m.method); hit.forEach((w) => w.done()); }
  });
  // The session was closed under us: answer every open call so nothing hangs
  ws.addEventListener("close", () => { for (const r of pending.values()) r({ error: { message: "the browser session was closed" } }); pending.clear(); });
  return {
    send: (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
    // The timer is cleared when the event comes: a timer left running keeps the script alive for its
    // whole length after the work is done (25 seconds per page, measured 2026-10-02).
    event: (method, ms) => new Promise((r) => { const timer = setTimeout(r, ms); waiters.push({ method, done: () => { clearTimeout(timer); r(); } }); }),
    close: () => ws.close(),
  };
}

export async function connect() {
  let port;
  try {
    // Nimbalyst's data folder: %APPDATA% on Windows, Library/Application Support on macOS
    const data = process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : process.env.APPDATA;
    port = fs.readFileSync(path.join(data, "@nimbalyst", "electron", "DevToolsActivePort"), "utf8").split("\n")[0].trim();
  } catch { throw fail("Nimbalyst's DevTools port file is missing; is Nimbalyst running?"); }
  const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  let list = await targets();
  const appTarget = list.find((t) => t.type === "page" && t.url.includes("app.asar"));
  if (!appTarget) throw fail("the Nimbalyst window was not found");
  const app = await socket(appTarget.webSocketDebuggerUrl);
  // Nimbalyst's own browser-session calls, made from its window
  const call = async (channel, payload) => {
    const r = await app.send("Runtime.evaluate", {
      expression: `window.electronAPI.invoke(${JSON.stringify("browser-session:" + channel)}, ${JSON.stringify(payload)})`, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value || { success: false, error: r.error?.message || "no answer" };
  };

  const sessions = (await call("list-sessions", {})).sessionIds || [];
  if (!sessions.includes(SESSION)) {
    const made = await call("create", { sessionId: SESSION, url: HOME, headless: true });
    if (!made.success) { app.close(); throw fail(made.error || "the session could not be created"); }
    await sleep(2500);
    list = await targets();
  }
  let saved = "";
  try { saved = fs.readFileSync(TARGET_FILE, "utf8").trim(); } catch {}
  const isPage = (t) => t.type === "page" && !t.url.includes("app.asar");
  let target = list.find((t) => isPage(t) && t.url.includes(SESSION)) || (sessions.includes(SESSION) && list.find((t) => isPage(t) && t.id === saved));
  if (!target) { // the session exists but sits on some other page: send it home to recognise it
    await call("navigate", { sessionId: SESSION, url: HOME });
    await sleep(3000);
    target = (await targets()).find((t) => isPage(t) && t.url.includes(SESSION));
  }
  if (!target) { app.close(); throw fail("its page was not found"); }
  fs.mkdirSync(path.dirname(TARGET_FILE), { recursive: true });
  fs.writeFileSync(TARGET_FILE, target.id);
  const page = await socket(target.webSocketDebuggerUrl);
  await page.send("Page.enable");

  return {
    send: page.send,
    // Loads a page; returns an error text or null. Going through Nimbalyst's own call keeps the session alive.
    async go(url) {
      const loaded = page.event("Page.loadEventFired", 25000);
      const r = await call("navigate", { sessionId: SESSION, url });
      if (!r.success) return r.error || "navigation refused";
      await loaded;
      return null;
    },
    // Runs a function in the page. A page that redirects while the script waits (robot checks, eBay) loses it: try again.
    async run(fn, arg) {
      let why = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await page.send("Runtime.evaluate", { expression: `(${fn})(${JSON.stringify(arg ?? null)})`, awaitPromise: true, returnByValue: true });
        const ex = r.result?.exceptionDetails;
        if (!r.error && !ex && r.result?.result?.value !== undefined) return r.result.result.value;
        why = r.error?.message || ex?.exception?.description || ex?.text || "no result";
        if (/was closed/.test(why)) break;
        await sleep(3000);
      }
      throw new Error(`the page script got no result (${why.slice(0, 160)})`);
    },
    close() { page.close(); app.close(); },
  };
}
